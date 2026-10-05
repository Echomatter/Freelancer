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

// Keep the indexer's stored/CLI names compatible while presenting derived
// observations consistently. Source text and extracted values are untouched.
function observationOutput(output: string, operation: string) {
  let parsed: unknown
  try { parsed = JSON.parse(output) } catch { return output }
  const names: Record<string, string> = {
    facts: "observations", facts_mode: "extraction_mode", fact_count: "observation_count",
    special_fact_rules: "special_rules", special_fact_rules_json: "special_rules_json",
    fact_stat_groups: "observation_stat_groups", facts_dropped_by_budget: "observations_dropped_by_budget",
    fact_budget_sources: "observation_budget_sources",
  }
  const row = (value: unknown): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      names[key] || key,
      key === "validation" ? row(item) : operation === "meta" && key === "key" && typeof item === "string" ? names[item] || item : item,
    ]))
  }
  return JSON.stringify(Array.isArray(parsed) ? parsed.map(row) : row(parsed), null, 2)
}

export default tool({
  description:
    "Locate indexed file passages and native chat text, inspect file coverage or maintain the current project's file index. Search/chats default to the current registered project; other operations always use the working project. Observations are values extracted from indexed files. Save useful retained material with memory. Preserve returned source references and coverage; verify consequential findings in originals.",
  title: (args) => `Content index · ${args.operation}`,
  args: {
    operation: tool.schema
      .enum(["status", "search", "chats", "sources", "unit", "observations", "meta", "rebuild"])
      .describe("search/chats locate text; status checks file freshness; sources/meta inspect coverage; unit reads an extraction; observations reads derived values; rebuild refreshes file index with native edit permission."),
    query: tool.schema.string().optional().describe("Required text for search/chats, at most 200 characters. Default matches up to 12 terms with AND; phrase requests exact wording."),
    model: tool.schema.string().optional().describe("chats only: exact provider/model filter; unsupported for file search."),
    projectID: tool.schema.string().optional().describe("search/chats only: another registered project; omitted uses the working project. Do not combine with global:true."),
    global: tool.schema.boolean().optional().describe("search/chats only: true searches all registered projects and cannot select projectID."),
    phrase: tool.schema.boolean().optional().describe("Exact phrase matching for search/chats; default false."),
    source: tool.schema.string().optional().describe("Path substring for search/sources/unit/observations. For unit, use the returned path and inspect any matching sources."),
    role: tool.schema.string().optional().describe("Exact inferred file role for search/sources; unsupported for chats."),
    status: tool.schema.string().optional().describe("Exact inferred file status for search/sources; unsupported for chats."),
    unit: tool.schema.number().int().min(0).optional().describe("unit operation requires source and its returned unit number, including zero."),
    family: tool.schema.string().optional().describe("observations only: derived value family filter."),
    kind: tool.schema
      .enum(["structured", "label_value", "markdown_table", "special_field", "special_label_value", "special_match"])
      .optional()
      .describe("observations only: extraction kind filter."),
    label: tool.schema.string().optional().describe("observations only: normalized label substring."),
    stats: tool.schema.boolean().optional().describe("observations only: aggregate stored extraction statistics; only family narrows this view."),
    extraction: tool.schema.enum(["none", "general", "special", "both"]).optional().describe("rebuild extraction mode; default none. Extracted values stay in the source index; saving a memory is explicit."),
    specialRules: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("rebuild rules as FAMILY=REGEX; special requires at least one, both applies them alongside general extraction."),
    ocr: tool.schema.boolean().optional().describe("rebuild only: optional OCR for nearly blank PDF pages; requires configured OCR executables."),
    limit: tool.schema.number().int().min(1).max(200).optional().describe("Rows for search/chats (default 20) or observations (default 100); other operations ignore this field."),
    cursor: tool.schema.string().max(1024).optional().describe("search/chats only: returned nextCursor with the same query, filters, scope and limit. Moving pages can change after indexing; do not infer complete coverage from one page."),
  },
  async execute(args, context: Ctx) {
    if (args.cursor !== undefined && !['search', 'chats'].includes(args.operation))
      throw new Error('Cursor is supported only for content search and chats operations.')
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
      if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("Local memory service required.")
      const scope = args.global === true ? { global: true } : args.projectID ? { projectID: args.projectID, global: false }
        : { projectDirectory: root, global: false }
      if (args.global && args.projectID) throw new Error("Global search cannot also select a project.")
      const response = await fetch(new URL("/api/memory/agent", url), {
        method: "POST", headers: { "Content-Type": "application/json", "X-Freelancer-Git-Bridge": process.env.FREELANCER_GIT_BRIDGE || "" },
        body: JSON.stringify({ operation: "query", domain: args.operation === "search" ? "files" : "conversations",
          query: args.query, phrase: args.phrase, source: args.source, role: args.role, status: args.status, model: args.model,
          limit: args.limit ?? 20, cursor: args.cursor, ...scope }), signal: context.abort,
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
        cli.push("rebuild", "--root", root, "--facts", args.extraction || "none")
        for (const spec of args.specialRules || []) cli.push("--special-fact", spec)
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
      case "observations":
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
    return observationOutput(await run(cli, root, context.abort), args.operation)
  },
})
