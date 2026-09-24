import { tool, type Plugin } from '@opencode-ai/plugin'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Registered once as the existing `delegate` tool. Use OpenCode's own authenticated
// client, permission prompts and child sessions; no second server or global pin.
//
// The plugin resolves the runtime root from the FREELANCER_RUNTIME_ROOT env var
// (set by server/runtime-config.mjs at startup) rather than reading a global
// freelancer-root.txt locator. This keeps the local app fully self-contained
// and avoids loading retired global toolkit plugins.
//
const DelegationPlugin: Plugin = async ({ client, directory }) => {
  const toolkitRoot = process.env.FREELANCER_RUNTIME_ROOT
  if (!toolkitRoot) {
    throw new Error(
      'FREELANCER_RUNTIME_ROOT is not set. The local backend failed to initialize. ' +
      'Restart the application or check server/runtime-config.mjs.',
    )
  }
  if (!fs.existsSync(toolkitRoot)) {
    throw new Error(
      `FREELANCER_RUNTIME_ROOT points to a missing directory: ${toolkitRoot}. ` +
      'Check FREELANCER_APP_ROOT and restore the backend source directory.',
    )
  }

  const { createBridge } = await import(pathToFileURL(path.join(toolkitRoot, 'tools/runtime/bridge.mjs')).href)
  const { createDelegator } = await import(pathToFileURL(path.join(toolkitRoot, 'tools/runtime/delegation.mjs')).href)
  const { createPresenter, restoreDelegateTools, completionMetadata } = await import(pathToFileURL(path.join(toolkitRoot, 'tools/runtime/presentation.mjs')).href)
  const delegate = createDelegator({ client, toolkitRoot, directory, ...createBridge(toolkitRoot) })
  const present = createPresenter({ client, directory })
  const { loadPreferences } = await import(pathToFileURL(path.join(toolkitRoot, 'tools/runtime/preferences.mjs')).href)
  const { strategyGuidance } = await import(pathToFileURL(path.join(toolkitRoot, '../shared/strategy.mjs')).href)

  // Required app policy: a missing source module is a startup error, not a
  // reason to silently restore the retired todo restrictions.
  const { readAgentCatalog, configureAgentProfiles } = await import(pathToFileURL(path.join(toolkitRoot, 'tools/runtime/agent-catalog.mjs')).href)
  const { enableSessionTodos } = await import(pathToFileURL(path.join(toolkitRoot, 'tools/runtime/todo-policy.mjs')).href)
  return {
    config: async config => {
      configureAgentProfiles(config, await readAgentCatalog(toolkitRoot))
      enableSessionTodos(config)
      // The pinned plugin SDK's v1 Config omits the native skills extension.
      const skillsConfig = config as typeof config & { skills?: { paths?: string[]; urls?: string[] } }
      skillsConfig.skills = { ...skillsConfig.skills, paths: [...new Set([...(skillsConfig.skills?.paths || []), path.join(toolkitRoot, 'skills')])] }
    },
    tool: {
      delegate: tool({
        description: 'Assign a bounded task to a named agent. The runtime selects eligible capacity in this call; paid routes use native paid_delegate consent. A new worker starts in the background so the parent can continue independent work. Use worker and task to continue an existing child. Returns a compact result with evidence limits; the full child conversation remains available.',
        args: {
          agent: tool.schema.string().optional().describe('Named agent ID from the supplied catalog. Omit all arguments for catalog details.'),
          task: tool.schema.string().min(1).optional().describe('A bounded assignment, relevant files and acceptance checks. Give concurrent writers disjoint areas.'),
          workflow: tool.schema.string().optional().describe('Optional approach; inherits the current workflow.'),
          model: tool.schema.string().optional().describe('Exact provider/model only when explicitly desired. Otherwise the runtime routes automatically.'),
          freeOnly: tool.schema.boolean().optional().describe('Only eligible free capacity, including descendants.'),
          inspectionOnly: tool.schema.boolean().optional().describe('No source modifications.'),
          independentReview: tool.schema.boolean().optional().describe('Seek a different model and exclude prior reviewers.'),
          worker: tool.schema.string().optional().describe('Existing child session ID to continue with its same agent and model.'),
        },
        async execute(args, context) {
          try {
          const receipt = await delegate.execute({ ...args, background: !args.worker }, { ...context,
            metadata: async (update: any) => { await present.metadata(context, update).catch(() => false) },
          })
          const output = receipt.status === 'catalog' ? receipt : {
            status: receipt.status, task_id: receipt.task_id, parent_session: receipt.parent_session,
            agent: receipt.agent && { id: receipt.agent.id, name: receipt.agent.name },
            workflow: receipt.workflow && { id: receipt.workflow.id, mode: receipt.workflow.mode },
            attempts: receipt.attempts?.map((a: any) => ({ child_session: a.child_session, status: a.status,
              selected_model: a.selected_model, dispatched_model: a.dispatched_model, observed_model: a.observed_model, abort_verified: a.abort_verified })),
            worker_result: receipt.worker_result, result: receipt.result, note: receipt.note,
            failure_class: receipt.failure_class, failure_summary: receipt.failure_summary,
            ...(receipt.decision ? { decision: receipt.decision } : {}),
          }
          return { title: `${receipt.agent?.name ?? "Agent catalog"} · ${receipt.status}`, output: JSON.stringify(output, null, 2),
            metadata: completionMetadata(receipt, args) }
          } catch (error: any) {
            const boundary = /Permission|Preference|Binding|Depth|Identity/.test(error?.name);
            const conflict = /WorkerBusy/.test(error?.name);
            const kind = boundary ? 'boundary' : conflict ? 'scheduling_conflict' : /Invalid/.test(error?.name) ? 'invalid_request' : 'unavailable';
            return { title: boundary ? 'Blocked' : conflict ? 'Waiting for worker' : 'Worker unavailable',
              output: JSON.stringify({ status: boundary ? 'blocked' : conflict ? 'conflict' : 'unavailable', failure_class: kind,
                reason: error?.message || 'Worker execution could not be established.',
                action: boundary ? 'Honor this boundary. Do not retry through another tool. Continue permitted direct work.' : conflict ? 'Wait, narrow scope or sequence the work.' : 'Inspect the cause before retrying; preserve any uncertain child work.' }), metadata: {} }
          }
        },
      }),
    },
    'chat.params': async input => { await delegate.checkModel(input) },
    'tool.execute.before': async (input, output) => { await delegate.checkTool(input, output) },
    'experimental.chat.messages.transform': async (_input, output) => { restoreDelegateTools(output.messages) },
    'experimental.chat.system.transform': async (input, output) => {
      try {
        const { preferences } = await loadPreferences(toolkitRoot, directory, input.sessionID)
        output.system.push(strategyGuidance(preferences))
      } catch {
        // A damaged preference file blocks delegate (its authoritative read),
        // but must not stop ordinary OpenCode chat from working.
        output.system.push('Freelancer preferences are unavailable. Do not delegate automatically; continue on the parent and report the settings issue.')
      }
    },
    event: async ({ event }) => {
      if (event.type === 'message.part.updated') {
        // Presentation failure must never fail or replay real child execution.
        await present(event.properties.part).catch(() => {})
      }
    },
  }
}
export default DelegationPlugin
