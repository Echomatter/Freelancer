import { readStateText } from '../../tools/runtime/state-database.mjs'
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
  const { createDelegator, publicDelegateArgs } = await import(pathToFileURL(path.join(toolkitRoot, 'tools/runtime/delegation.mjs')).href)
  const { createPresenter, restoreDelegateTools, completionMetadata } = await import(pathToFileURL(path.join(toolkitRoot, 'tools/runtime/presentation.mjs')).href)
  const delegate = createDelegator({ client, toolkitRoot, directory, ...createBridge(toolkitRoot),
    handoff: async (input: any, signal: AbortSignal) => {
      const launch = JSON.parse(await readStateText(path.join(toolkitRoot, '.state/webpage/launch.json')))
      const url = new URL(launch.url)
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw Error('Local worker sender required.')
      const response = await fetch(new URL('/api/delegates/handoff', url), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Freelancer-Git-Bridge': process.env.FREELANCER_GIT_BRIDGE || '' },
        body: JSON.stringify(input), signal,
      })
      const result = await response.json()
      if (!response.ok) throw Error(result.error || 'Worker delivery rejected.')
      return result
    },
  })
  const present = createPresenter({ client, directory })
  const { loadPreferences } = await import(pathToFileURL(path.join(toolkitRoot, 'tools/runtime/preferences.mjs')).href)
  const { strategyGuidance } = await import(pathToFileURL(path.join(toolkitRoot, '../shared/strategy.mjs')).href)

  // Required app policy: a missing source module is a startup error, not a
  // reason to silently restore the retired todo restrictions.
  const { readAgentCatalog, configureAgentProfiles } = await import(pathToFileURL(path.join(toolkitRoot, 'tools/runtime/agent-catalog.mjs')).href)
  const { enableSessionTodos } = await import(pathToFileURL(path.join(toolkitRoot, 'tools/runtime/todo-policy.mjs')).href)
  const { recordModelInput } = await import(pathToFileURL(path.join(toolkitRoot, 'tools/runtime/input-observations.mjs')).href)
  const { createCapabilityInventory } = await import(pathToFileURL(path.join(toolkitRoot, 'tools/runtime/capability-inventory.mjs')).href)
  let sharedSkills: string[] = []
  try { sharedSkills = JSON.parse(fs.readFileSync(path.join(toolkitRoot, 'opencode/catalog.json'), 'utf8')).skills ?? [] } catch { /* inventory remains optional */ }
  const inventory = createCapabilityInventory({ client, directory, skills: sharedSkills })
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
        description: 'Assign bounded work to a named agent or inspect and manage this parent\'s workers. Call with no arguments for agent IDs and eligible budget.modelPool. A new assignment without worker runs in the background; omit model for automatic routing. Worker actions inspect, continue, steer, queue, fork or cancel according to the fields below. Preserve native permissions, paid_delegate consent and captured limits. On parallel_limit, no child started: inspect workers and wait for capacity before retrying, or continue a smaller slice directly. On no_qualified_route or delegation_unavailable, do not retry unchanged. Inspect returned status, transcript and receipts before accepting results or retrying uncertain work; execution completion is not verified task success.',
        args: {
          agent: tool.schema.string().optional().describe('Named catalog ID for a new assignment. Existing workers retain their agent.'),
          task: tool.schema.string().min(1).optional().describe('Bounded objective, relevant files, constraints and acceptance criteria. Give concurrent writers disjoint paths. Required for assignment, continuation, delivery or fork.'),
          model: tool.schema.string().optional().describe('Exact provider/model ID from budget.modelPool for an explicit new choice; omit for automatic routing. Continuation and delivery retain the worker model; a fork routes afresh.'),
          freeOnly: tool.schema.boolean().optional().describe('Require eligible free capacity for this assignment and descendants; inherited free-only constraints cannot be relaxed.'),
          inspectionOnly: tool.schema.boolean().optional().describe('Forbid source edits, including through shell. This task constraint is not filesystem isolation.'),
          independentReview: tool.schema.boolean().optional().describe('Require model diversity from the parent and exclude previously completed reviewer models; no route may qualify.'),
          worker: tool.schema.string().optional().describe('Owned child session ID, not task_id. Alone inspects native transcript/status; with task and no other action continues an idle settled worker in the same agent/model/context.'),
          fork: tool.schema.boolean().optional().describe('With worker and a new task, pass true to create a fresh child. Retains source agent and read-only/free-only limits; carries bounded historical, unverified findings. Exclusive with cancel, delivery and workers.'),
          cancel: tool.schema.boolean().optional().describe('Use only worker and cancel:true. Requests scoped stop, preserves partial output and reports cancelled, stop_unverified or worker_not_running. Does not start a replacement; inspect an unverified stop.'),
          delivery: tool.schema.enum(['steer', 'queue']).optional().describe('With worker and task: steer corrects current work at its next supported boundary without aborting; queue waits for FIFO delivery after the turn. Retains agent/model/constraints. Accepted delivery is not proof of action.'),
          workers: tool.schema.boolean().optional().describe('Pass true without assignment fields to list this parent\'s saved workers.'),
          from: tool.schema.number().int().min(0).optional().describe('Worker transcript read only: zero-based native message offset; omit for latest messages.'),
          limit: tool.schema.number().int().min(1).max(20).optional().describe('Worker transcript read only: message count, default 8, maximum 20.'),
        },
        async execute(args, context) {
          try {
          const receipt = await delegate.execute(publicDelegateArgs(args), { ...context,
            metadata: async (update: any) => { await present.metadata(context, update).catch(() => false) },
          })
          const output = ['catalog', 'workers', 'worker_transcript', 'worker_handoff'].includes(receipt.status) ? receipt : {
            status: receipt.status, task_id: receipt.task_id, parent_session: receipt.parent_session,
            agent: receipt.agent && { id: receipt.agent.id, name: receipt.agent.name },
            attempts: receipt.attempts?.map((a: any) => ({ child_session: a.child_session, status: a.status,
              selected_model: a.selected_model, dispatched_model: a.dispatched_model, observed_model: a.observed_model, abort_verified: a.abort_verified })),
            worker_result: receipt.worker_result, ...(receipt.fork ? { fork: receipt.fork } : {}), result: receipt.result, note: receipt.note,
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
                ...(error?.details ? { details: error.details } : {}),
                action: boundary ? 'Honor this boundary. Do not retry through another tool. Continue permitted direct work.' : conflict ? 'Wait, narrow scope or sequence the work.' : kind === 'invalid_request' ? 'Correct the named field using the returned catalog/model details; do not guess aliases or shorten the task as a workaround.' : 'Inspect the cause before retrying; preserve any uncertain child work.' }), metadata: { freelancer_status: boundary ? 'blocked' : conflict ? 'conflict' : 'unavailable' } }
          }
        },
      }),
    },
    'chat.params': async input => { await delegate.checkModel(input) },
    'tool.execute.before': async (input, output) => { await delegate.checkTool(input, output) },
    'experimental.chat.messages.transform': async (_input, output) => { restoreDelegateTools(output.messages); await recordModelInput(toolkitRoot, output.messages) },
    'experimental.chat.system.transform': async (input, output) => {
      try { output.system.push(await inventory(input.model)) } catch { /* discovery never blocks ordinary work */ }
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
