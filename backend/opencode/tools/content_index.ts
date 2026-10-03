import { tool } from "@opencode-ai/plugin"
import path from "path"
import fs from "fs"
import { pathToFileURL } from "node:url"
import { runProcess } from "../../tools/runtime/bridge.mjs"

type Ctx = { directory: string; worktree?: string; abort?: AbortSignal }

async function run(args: string[], cwd: string, signal?: AbortSignal) {
  const candidates: string[][] = []
  const node = process.env.FREELANCER_NODE || process.execPath
  const runtimeRoot = process.env.FREELANCER_RUNTIME_ROOT
  if (runtimeRoot) {
    const nodeIndexer = path.join(runtimeRoot, "tools", "project-content-indexer.mjs")
    if (fs.existsSync(nodeIndexer)) candidates.push([node, nodeIndexer, ...args])
  }
  let last = ""
  for (const cmd of candidates) {
    try {
      const [file, ...commandArgs] = cmd
      return await runProcess(file, commandArgs, { cwd, signal, timeoutMs: 600000, errorOutput: true })
    } catch (err) {
      last = String(err)
    }
  }
  throw new Error(`Project content indexer failed: ${last}`)
}

function freelancerDatabasePath() {
  const dataRoot = process.env.FREELANCER_DATA_HOME
  if (!dataRoot || !path.isAbsolute(dataRoot)) {
    throw new Error(
      "FREELANCER_DATA_HOME is not set to the resolved application data directory. Restart Freelancer.",
    )
  }
  return path.join(dataRoot, "freelancer.sqlite")
}

function projectKey(root: string) {
  const resolved = path.resolve(root)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

export default tool({
  description:
    "Project retrieval for files and native conversation text. Search/index docs, data, and chats. Use results as locators; verify decisive claims against original files or OpenCode messages.",
  title: (args) => `Content index · ${args.operation}`,
  args: {
    operation: tool.schema
      .enum(["status", "search", "chats", "sources", "unit", "facts", "meta", "rebuild"])
      .describe("Index operation"),
    query: tool.schema.string().optional().describe("Search text for operation=search"),
    model: tool.schema.string().optional().describe("Exact provider/model filter for operation=chats"),
    projectID: tool.schema.string().optional().describe("Registered project ID for search/chats; defaults to the current project"),
    global: tool.schema.boolean().optional().describe("Search all registered projects instead of the current project"),
    phrase: tool.schema.boolean().optional().describe("Treat search query as an exact phrase"),
    source: tool.schema.string().optional().describe("Substring source-path filter"),
    role: tool.schema.string().optional().describe("Exact inferred source role filter"),
    status: tool.schema.string().optional().describe("Exact inferred source status filter"),
    unit: tool.schema.number().int().min(0).optional().describe("Unit number for operation=unit, including zero"),
    family: tool.schema.string().optional().describe("Fact family filter"),
    kind: tool.schema
      .enum(["structured", "label_value", "markdown_table", "special_field", "special_label_value", "special_match"])
      .optional()
      .describe("Fact kind filter"),
    label: tool.schema.string().optional().describe("Fact label filter"),
    stats: tool.schema.boolean().optional().describe("Return aggregate fact statistics"),
    facts: tool.schema.enum(["none", "general", "special", "both"]).optional().describe("Fact mode for rebuild"),
    specialFacts: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Focused rebuild rules as FAMILY=REGEX"),
    ocr: tool.schema.boolean().optional().describe("Use optional OCR fallback for nearly blank PDF pages"),
    limit: tool.schema.number().int().min(1).max(200).optional().describe("Maximum returned rows"),
  },
  async execute(args, context: Ctx) {
    if (args.operation === 'rebuild') {
      await (context as any).ask({ permission: 'edit', patterns: ['content-index database'], always: [], metadata: { operation: 'rebuild' } })
    }
    const root = path.resolve(context.worktree || context.directory)

    // ── Runtime root resolution ──────────────────────────────────────
    // Uses FREELANCER_RUNTIME_ROOT (set by server/runtime-config.mjs)
    // instead of reading a global freelancer-root.txt locator file.
    const toolkitRoot = process.env.FREELANCER_RUNTIME_ROOT
    if (!toolkitRoot) {
      throw new Error(
        "FREELANCER_RUNTIME_ROOT is not set. The local backend failed to initialize. " +
        "Restart the application or check server/runtime-config.mjs.",
      )
    }
    if (!fs.existsSync(toolkitRoot)) {
      throw new Error(
        `FREELANCER_RUNTIME_ROOT points to a missing directory: ${toolkitRoot}. ` +
        "Check FREELANCER_APP_ROOT and restore the backend source directory.",
      )
    }

    if (args.operation === "search" || args.operation === "chats") {
      if (!args.query) throw new Error(`operation=${args.operation} requires query`)
      const runtime = await import(pathToFileURL(path.join(toolkitRoot, "tools/runtime/state-database.mjs")).href)
      const launch = runtime.readState(path.join(toolkitRoot, ".state/webpage/launch.json"))
      const url = new URL(launch.url)
      if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("Local knowledge service required.")
      const scope = args.global === true ? { global: true } : args.projectID ? { projectID: args.projectID, global: false }
        : { projectDirectory: root, global: false }
      if (args.global && args.projectID) throw new Error("Global search cannot also select a project.")
      const response = await fetch(new URL("/api/knowledge/agent", url), {
        method: "POST", headers: { "Content-Type": "application/json", "X-Freelancer-Git-Bridge": process.env.FREELANCER_GIT_BRIDGE || "" },
        body: JSON.stringify({ operation: "query", domain: args.operation === "search" ? "files" : "conversations",
          query: args.query, phrase: args.phrase, source: args.source, role: args.role, status: args.status, model: args.model,
          limit: args.limit ?? 20, ...scope }), signal: context.abort,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Content search failed.")
      return JSON.stringify(result, null, 2)
    }

    const script = path.join(toolkitRoot, "tools", "project-content-indexer.mjs")
    if (!fs.existsSync(script)) throw new Error(`Project content indexer missing: ${script}`)
    const db = freelancerDatabasePath()
    const key = projectKey(root)

    const cli: string[] = ["--db", db, "--project-key", key]
    switch (args.operation) {
      case "status":
        cli.push("status", "--root", root)
        break
      case "rebuild":
        cli.push("rebuild", "--root", root, "--facts", args.facts || "none")
        for (const spec of args.specialFacts || []) cli.push("--special-fact", spec)
        if (args.ocr) cli.push("--ocr")
        break
      case "sources":
        cli.push("sources")
        if (args.source) cli.push("--source", args.source)
        if (args.role) cli.push("--role", args.role)
        if (args.status) cli.push("--status", args.status)
        break
      case "unit":
        if (!args.source || args.unit === undefined) throw new Error("operation=unit requires source and unit")
        cli.push("unit", "--source", args.source, "--unit", String(args.unit))
        break
      case "facts":
        cli.push("facts")
        if (args.family) cli.push("--family", args.family)
        if (args.source) cli.push("--source", args.source)
        if (args.kind) cli.push("--kind", args.kind)
        if (args.label) cli.push("--label", args.label)
        if (args.stats) cli.push("--stats")
        cli.push("--limit", String(args.limit || 100))
        break
      case "meta":
        cli.push("meta")
        break
    }
    return await run(cli, root, context.abort)
  },
})
