import { tool } from "@opencode-ai/plugin"
import path from "path"
import fs from "fs"
import { spawn } from "node:child_process"

type Ctx = { directory: string; worktree?: string }

function runCommand(cmd: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const [file, ...args] = cmd
    const child = spawn(file, args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    if (child.stdout) child.stdout.on("data", (d) => { stdout += d.toString() })
    if (child.stderr) child.stderr.on("data", (d) => { stderr += d.toString() })
    child.on("error", (err) => reject(err))
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }))
  })
}

async function run(args: string[], cwd: string) {
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
      const { stdout, stderr, code } = await runCommand(cmd, cwd)
      if (code === 0) return stdout.trim()
      last = stderr.trim() || stdout.trim() || `exit ${code}`
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
    phrase: tool.schema.boolean().optional().describe("Treat search query as an exact phrase"),
    source: tool.schema.string().optional().describe("Substring source-path filter"),
    role: tool.schema.string().optional().describe("Exact inferred source role filter"),
    status: tool.schema.string().optional().describe("Exact inferred source status filter"),
    unit: tool.schema.number().int().positive().optional().describe("Unit number for operation=unit"),
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
      case "search":
        if (!args.query) throw new Error("operation=search requires query")
        cli.push("search", args.query)
        if (args.phrase) cli.push("--phrase")
        if (args.source) cli.push("--source", args.source)
        if (args.role) cli.push("--role", args.role)
        if (args.status) cli.push("--status", args.status)
        cli.push("--limit", String(args.limit || 20))
        break
      case "chats":
        if (!args.query) throw new Error("operation=chats requires query")
        cli.push("chats", args.query)
        if (args.model) cli.push("--model", args.model)
        cli.push("--limit", String(args.limit || 20))
        break
      case "sources":
        cli.push("sources")
        if (args.source) cli.push("--source", args.source)
        if (args.role) cli.push("--role", args.role)
        if (args.status) cli.push("--status", args.status)
        break
      case "unit":
        if (!args.source || !args.unit) throw new Error("operation=unit requires source and unit")
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
    return await run(cli, root)
  },
})
