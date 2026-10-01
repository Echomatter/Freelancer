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
  const { configureContextSettings } = await import(pathToFileURL(path.join(toolkitRoot, 'tools/runtime/context-settings.mjs')).href)
  const { recordModelInput } = await import(pathToFileURL(path.join(toolkitRoot, 'tools/runtime/input-observations.mjs')).href)
  const { createCapabilityInventory } = await import(pathToFileURL(path.join(toolkitRoot, 'tools/runtime/capability-inventory.mjs')).href)
  let sharedSkills: string[] = []
  try { sharedSkills = JSON.parse(fs.readFileSync(path.join(toolkitRoot, 'opencode/catalog.json'), 'utf8')).skills ?? [] } catch { /* inventory remains optional */ }
  const inventory = createCapabilityInventory({ client, directory, skills: sharedSkills })
  return {
    config: async config => {
      configureAgentProfiles(config, await readAgentCatalog(toolkitRoot))
      enableSessionTodos(config)
      await configureContextSettings(config, toolkitRoot, directory)
      // The pinned plugin SDK's v1 Config omits the native skills extension.
      const skillsConfig = config as typeof config & { skills?: { paths?: string[]; urls?: string[] } }
      skillsConfig.skills = { ...skillsConfig.skills, paths: [...new Set([...(skillsConfig.skills?.paths || []), path.join(toolkitRoot, 'skills')])] }
    },
    tool: {
      delegate: tool({
        description: 'Assign a bounded task to a named agent. Call delegate() with no arguments to inspect current agent IDs and the eligible model pool. Omit model for automatic eligible routing; use freeOnly:true when free capacity is required. A new worker starts in the background. Use workers:true to list assignments; worker alone to inspect one. With worker and task, delivery:"steer" adjusts current work without aborting, delivery:"queue" waits for its current turn. With worker, fork:true and a new task creates a fresh child through normal routing, carrying bounded historical evidence as unverified; it does not reuse the source session. Omitting delivery continues an idle worker. With worker and cancel:true, stop only that worker: the native stop is verified, the final state is durable, partial output is preserved, and no replacement child starts. Paid routes use native paid_delegate consent.',
        args: {
          agent: tool.schema.string().optional().describe('Named agent ID from the supplied catalog. Omit all arguments to inspect available agents and budget.'),
          task: tool.schema.string().min(1).optional().describe('A bounded assignment, relevant files and acceptance checks. Give concurrent writers disjoint areas.'),
          model: tool.schema.string().optional().describe('Exact provider/model ID from delegate() budget.modelPool when explicitly desired. Omit for automatic eligible routing; use freeOnly:true to require free capacity.'),
          freeOnly: tool.schema.boolean().optional().describe('Only eligible free capacity, including descendants.'),
          inspectionOnly: tool.schema.boolean().optional().describe('No source modifications.'),
          independentReview: tool.schema.boolean().optional().describe('Seek a different model and exclude prior reviewers.'),
          worker: tool.schema.string().optional().describe('Child session ID. Alone reads its live transcript; with task continues its same agent and model; with cancel:true stops only this worker.'),
          fork: tool.schema.boolean().optional().describe('With worker and task: start a fresh child context for a new bounded assignment. Preserves source agent/readOnly/free constraints, normal routing and native consent. Prior evidence is bounded, historical and unverified; source findings are annotated for project-state drift and never discarded. Cannot be combined with continuation, cancel, steer, queue or listing.'),
          cancel: tool.schema.boolean().optional().describe('With worker: stop that one worker. Requires a verified native idle stop, writes a durable cancelled or stop_unverified receipt, preserves partial output, and never starts a replacement child.'),
          delivery: tool.schema.enum(['steer', 'queue']).optional().describe('With worker and task: steer corrects ongoing work at the next supported boundary without aborting tools; queue appends a FIFO follow-up after its current turn. Preserves the existing assignment, model and constraints.'),
          workers: tool.schema.boolean().optional().describe('List this parent conversation’s saved worker assignments.'),
          from: tool.schema.number().int().min(0).optional().describe('Zero-based native message offset for reading a worker transcript. Omit for the latest messages.'),
          limit: tool.schema.number().int().min(1).max(20).optional().describe('Number of worker messages to read, default 8.'),
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
