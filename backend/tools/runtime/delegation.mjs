import { readRuntimeText as readFile,stateFiles,writeState } from './state-database.mjs';
// Native OpenCode child execution. No global model/agent configuration is mutated.
// SDK response fields, not a model's self-description, establish execution identity.
import { createHash,randomUUID } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { capturedDelegationPool,delegationGuidance,effectiveDelegationPreferences } from '../../../domain/delegation-policy.mjs';
import { policyInputs } from '../../../shared/strategy.mjs';
import { activityOf } from './activity.mjs';
import { answeredChoice,makeDecision } from './decision.mjs';
import { loadPreferences } from './preferences.mjs';
import { annotateWorkerContext,partialText,runtimeSignals,workerResult,workerResultInstruction } from './worker-result.mjs';
import { composeWorkerFork } from './worker-fork.mjs';

import { agentAssignmentAllowed,legacyTaskPatterns } from '../../../domain/agent-policy.mjs';
import { legacyModelAllowed } from '../../../domain/workspace.mjs';
import { executionPrompt,policyVersion } from '../../../server/execution.mjs';
import { executionContext,workerBindingFile } from './execution-context.mjs';
import { reserveWorkerSlot } from './worker-dispatch-lock.mjs';
import { isInspectAllowed } from './tool-operations.mjs';
// Preserve explicit user spending constraints even if a parent omits the tool flag.
// This is a conservative syntax guard, not a model-ranking or language classifier.
export const freeOnlyAssignment = text => /\bfreeOnly\s*[:=]?\s*true\b|\b(?:use|using|with)\s+(?:only\s+|some\s+)?free\s+models?\b|\bonly\s+free\s+(?:models|routes)\b|\b(?:use|using)\s+free[- ]only\b/i.test(text || '');
const hash = x => createHash('sha256').update(x).digest('hex');
const rule = (permission, action = 'deny', pattern = '*') => ({ permission, pattern, action });
const routeOf = info => info?.providerID && info?.modelID ? `${info.providerID}/${info.modelID}` : null;
// Infer only explicit whole-assignment restrictions. Product descriptions such
// as "add a read-only view" and scoped exclusions such as "no edits to src"
// must not turn an authorized test writer into an inspection-only worker.
// Captured/native inspectionOnly remains authoritative independently of prose.
export const noWriteAssignment = text => {
  const value = String(text || '');
  const start = '(?:^|[.!?;\\n])\\s*(?:please\\s+)?';
  return new RegExp(start + '(?:explain[ -]only|just inspect)\\b', 'i').test(value) ||
    new RegExp(start + 'read[ -]only(?:\\s+(?:assignment|task|work|review|research|inspection|orientation|analysis|validation))?(?=\\s*(?:[:;,.!\\n]|$))', 'i').test(value) ||
    new RegExp(start + 'do not (?:modify|edit|change|write)(?: any)?(?: source)? files\\b(?!\\s+(?:outside|except|in|under|within)\\b)', 'i').test(value) ||
    new RegExp(start + 'no[ -](?:(?:file|source)[ -])?(?:writes|edits)(?=\\s*(?:[.;!?,\\n]|$))', 'i').test(value);
};
export function splitModel(id) {
  if (typeof id !== 'string' || !/^[\w.-]+\/[^\s]+$/.test(id)) throw new Error('Invalid provider-qualified model');
  const at = id.indexOf('/');
  return { providerID: id.slice(0, at), modelID: id.slice(at + 1) };
}
const modelWords = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
export function userDirectedModelAssignment(assignment, selectedModel) {
  if (!assignment || !selectedModel) return false;
  const text = ` ${modelWords(assignment).join(' ')} `;
  const modelID = splitModel(selectedModel).modelID;
  const tokens = modelWords(modelID);
  const withoutPackaging = tokens.filter(t => !['contributor', 'free', 'preview', 'latest'].includes(t));
  const withoutVersion = withoutPackaging.filter(t => !/^v?\d+$/.test(t));
  const aliases = [
    modelWords(selectedModel),
    tokens,
    withoutPackaging,
    // Friendly names such as "MiMo Pro" may omit a version, but do not
    // erase version identity from ordinary families such as Muse Spark.
    ...(withoutPackaging.includes('pro') ? [withoutVersion] : []),
  ].map(parts => parts.join(' ')).filter((value, i, rows) => value.length >= 6 && rows.indexOf(value) === i);
  return aliases.some(alias => text.includes(` ${alias} `));
}
function decisionAssignment(args = {}) {
  const { decisionId, selectedModel, selectionReason, ...bounded } = args;
  return bounded;
}
export function sameDecisionAssignment(a, b) {
  return isDeepStrictEqual(decisionAssignment(a), decisionAssignment(b));
}
export function failureKind(error) {
  const data = error?.data || error || {};
  const name = error?.name || '';
  const text = `${name} ${data.message || ''}`;
  if (/binding|identity/i.test(name)) return 'binding';
  if (/abort|cancel/i.test(name)) return 'cancelled';
  if (/quota|usage.?limit|insufficient.?credit|credit.*exhaust|limit.*reached/i.test(text)) return 'quota';
  if (+data.statusCode === 401 || +data.statusCode === 403) return 'auth';
  if (+data.statusCode === 404 || /model.?not.?found/i.test(name) || /model.*not supported|not supported.*model/i.test(text)) return 'model';
  if (+data.statusCode === 429 || /rate.?limit|ProviderRetry/i.test(name)) return 'throttle';
  if (+data.statusCode >= 500) return 'provider';
  if (/timeout/i.test(name)) return 'timeout';
  return 'execution';
}
function fault(name, message, details = undefined) { return Object.assign(new Error(message), { name, ...(details ? { details } : {}) }); }
function forkTaskText(fork, task) {
  return [
    'Fresh-context fork: this is a new child assignment, not a continuation of the source worker.',
    `Source worker ${fork.source.worker}, task ${fork.source.task_id}, named agent @${fork.source.agent.name}.`,
    'Carried findings are historical and unverified. Inspect the source session and re-check claims against the current project before acting on them.',
    `Project-state comparison: ${fork.project_state.drift.join(', ') || (fork.project_state.consistent ? 'fingerprints match, claims still unverified' : 'no drift could be compared')}.`,
    ...fork.project_state.warnings.map(warning => `Project-state note: ${warning}`),
    'Bounded historical evidence:',
    ...fork.evidence.items.map(item => `- [${item.field}; ${item.status}] ${item.text}`),
    ...(fork.evidence.dropped.length ? [`${fork.evidence.dropped.reduce((sum, item) => sum + item.dropped, 0)} historical item(s) omitted by transfer bounds.`] : []),
    '', 'New assignment:', task,
  ].join('\n');
}
function attachForkWarnings(result, fork) {
  if (!fork || !result) return result;
  return { ...result, fork_context: { source_worker: fork.source.worker,
    source_task_id: fork.source.task_id, evidence_status: fork.evidence.status,
    evidence_count: fork.evidence.item_count, warnings: [...fork.project_state.warnings],
    drift: [...fork.project_state.drift], findings_preserved: fork.project_state.findings_preserved } };
}
export function publicDelegateArgs(args = {}) {
  return Object.keys(args).length ? { ...args, background: !args.worker } : args;
}
function unwrap(r) {
  if (r?.error) throw Object.assign(new Error(r.error?.data?.message || 'SDK request failed'), r.error);
  return r && Object.hasOwn(r, 'data') ? r.data : r;
}
export async function atomicJson(file, value) { writeState(file, value); }
async function readJson(file) {
  try { return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function equalRules(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  const normalized = rows => rows.map(r => [r.permission, r.pattern, r.action]);
  return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
}
function activeTool(messages) {
  return messages.some(m => (m.parts || []).some(p => p.type === 'tool' && ['pending', 'running'].includes(p.state?.status)));
}
export function observe(messages, selected, agentID) {
  if (!Array.isArray(messages)) throw fault('IdentityUnverified', 'Missing structured child messages');
  const assistants = messages.filter(m => m.info?.role === 'assistant' && !m.info.summary);
  const seen = new Set();
  const usage = { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0, provider_dollars: 0 };
  let measured = true;
  for (const m of assistants) {
    if (agentID && m.info.agent && m.info.agent !== agentID) throw fault('BindingFailure', 'Runtime child agent differs from the dispatched definition');
    if (!routeOf(m.info)) throw fault('IdentityUnverified', 'Child message lacks runtime model identity');
    if (routeOf(m.info) !== selected) throw Object.assign(fault('BindingFailure', 'Runtime child model differs from selected route'), { actual_model: routeOf(m.info) });
    if (!m.info.id || seen.has(m.info.id)) continue;
    seen.add(m.info.id);
    const t = m.info.tokens;
    if (m.info.error && (!t || !(t.input || t.output || t.reasoning || t.cache?.read || t.cache?.write))) measured = false;
    if (!t || ![t.input, t.output, t.reasoning || 0, t.cache?.read || 0, t.cache?.write || 0].every(v => Number.isFinite(v) && v >= 0)) { measured = false; continue; }
    usage.input += t.input; usage.output += t.output;
    usage.reasoning += t.reasoning || 0; usage.cache_read += t.cache?.read || 0;
    usage.cache_write += t.cache?.write || 0;
    usage.provider_dollars += Number.isFinite(m.info.cost) ? m.info.cost : 0;
  }
  const last = assistants.at(-1);
  return { assistants, observed: assistants.length ? selected : null, usage: assistants.length && measured ? usage : null,
    complete: Boolean(last?.info.time?.completed && last.info.finish && last.info.finish !== 'tool-calls' && !activeTool(messages)),
    error: last?.info.error,
    text: (last?.parts || []).filter(p => p.type === 'text').map(p => p.text).join('\n') };
}

/** Inject the plugin's authenticated v1 SDK client; never start another OpenCode server. */
export function createDelegator({ client, toolkitRoot, directory, select, record, handoff, beforeSelect = async () => {},
  now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)),
  limits = {} }) {
  const cfg = { requestMs: 10000, firstResponseMs: 60000, taskMs: 600000, stopMs: 10000, pollMs: 750, ...limits };
  const live = new Map();
  const inFlight = new Map();
  const continuing = new Set();
  // Children the parent explicitly cancelled in this process. A detached
  // monitor must stop polling instead of overwriting the durable cancelled
  // state with its own timeout or failure receipt.
  const cancellations = new Map();
  const activeByParent = new Map();
  const slotLocks = new Map();
  async function reserveSlot(rootSessionID, directory, signal, limit) {
    const previous = slotLocks.get(rootSessionID) ?? Promise.resolve();
    let unlock;
    const lock = new Promise(resolve => { unlock = resolve; });
    slotLocks.set(rootSessionID, lock);
    await previous;
    let releaseDispatch;
    try {
      const claim = await reserveWorkerSlot(toolkitRoot, rootSessionID, { limit,
        active: () => occupiedSlots(rootSessionID, directory, signal, true),
        settled: async r => {
          const statuses = await call('session', 'status', { query: query(directory) }, signal);
          if (statuses?.[r.childID]?.type === 'idle') return true;
          if (!r.messageID) return false;
          const messages = await call('session', 'messages', sessionArgs(r.childID, directory), signal);
          return messages.some(m => m.info?.parentID === r.messageID && m.info.time?.completed && (m.info.error || m.info.finish && m.info.finish !== 'tool-calls'));
        },
      });
      if (!claim) return null;
      releaseDispatch = claim.release;
      const reservation = { startedAt: now(), releaseDispatch, bind: claim.bind };
      const reservations = activeByParent.get(rootSessionID) ?? new Set();
      reservations.add(reservation);
      activeByParent.set(rootSessionID, reservations);
      return reservation;
    } catch (error) {
      await releaseDispatch?.(); throw error;
    } finally {
      unlock();
      if (slotLocks.get(rootSessionID) === lock) slotLocks.delete(rootSessionID);
    }
  }
  function dropReservation(sessionID, reservation) {
    const reservations = activeByParent.get(sessionID);
    reservations?.delete(reservation);
    if (reservation?.childID) live.delete(reservation.childID);
    if (!reservations?.size) activeByParent.delete(sessionID);
  }
  // A reservation is a live slot only while the child is starting or non-idle.
  // An idle or long-omitted child must not permanently consume maxParallel after
  // an unverified stop. The receipt still says stop_unverified, so that assignment
  // is not replayed; overlapping edits stay the parent's responsibility.
  function holdsSlot(entry, statuses) {
    if (!entry?.childID) return true;
    if (!statuses) return true;
    const type = statuses[entry.childID]?.type;
    if (type && type !== 'idle') return true;
    if (type === 'idle') return false;
    return now() - (entry.startedAt || 0) < cfg.firstResponseMs;
  }
  const stateDir = path.join(toolkitRoot, '.state', 'delegation');
  const workerFile = id => path.join(stateDir, 'workers', hash(id) + '.json');
  const stamp = () => new Date(now()).toISOString();
  async function recordedDecision(args, ctx, userMessageID) {
    const decisionDir = path.join(stateDir, 'decisions');
    let names;
    try { names = await Promise.resolve(stateFiles(decisionDir)); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    const messages = await call('session', 'messages', sessionArgs(ctx.sessionID, ctx.directory), ctx.abort);
    const matches = [];
    for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      const decision = await readJson(path.join(decisionDir, name));
      if (!decision || decision.sessionID !== ctx.sessionID || decision.userMessageID !== userMessageID ||
          !sameDecisionAssignment(decision.args, args)) continue;
      try {
        const choice = answeredChoice(decision, messages, now());
        matches.push({ decision, choice });
      } catch (e) {
        if (/expired|request changed/i.test(e.message || '')) continue;
        if (!/No matching recorded user choice/i.test(e.message || '')) throw e;
      }
    }
    matches.sort((a, b) => Date.parse(b.decision.createdAt) - Date.parse(a.decision.createdAt));
    return matches[0] || null;
  }
  async function call(group, method, args, signal, timeout = cfg.requestMs) {
    if (signal?.aborted) throw fault('AbortError', 'Parent cancelled');
    const fn = client[group]?.[method];
    if (typeof fn !== 'function') throw fault('UnsupportedRuntime', `SDK lacks ${group}.${method}`);
    const ctl = new AbortController();
    let timer;
    let abort;
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => { ctl.abort(); reject(fault('RequestTimeout', `${group}.${method} timed out`)); }, timeout);
      abort = () => { ctl.abort(); reject(fault('AbortError', 'Parent cancelled')); };
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    });
    try { return unwrap(await Promise.race([fn.call(client[group], { ...args, signal: ctl.signal }), expired])); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  const query = directory => ({ directory });
  const sessionArgs = (id, directory) => ({ path: { id }, query: query(directory) });
  async function occupiedSlots(sessionID, directory, signal, nativeOnly = false) {
    const activeIDs = new Set();
    let statuses = null;
    if (typeof client.session.children === 'function') {
      const [children, statusResult] = await Promise.all([
        call('session', 'children', sessionArgs(sessionID, directory), signal),
        call('session', 'status', { query: query(directory) }, signal),
      ]);
      if (!Array.isArray(children) || !statusResult || typeof statusResult !== 'object' || Array.isArray(statusResult))
        throw fault('UnsupportedRuntime', 'Cannot verify active native children');
      statuses = statusResult;
      const pending = [...children];
      const seen = new Set([sessionID]);
      while (pending.length) {
        const c = pending.shift();
        if (!c?.id || seen.has(c.id)) continue;
        seen.add(c.id);
        if ((c.metadata?.freelancer || c.metadata?.ai_toolkit)?.selected && statuses[c.id]?.type && statuses[c.id].type !== 'idle') activeIDs.add(c.id);
        const descendants = await call('session', 'children', sessionArgs(c.id, directory), signal);
        if (!Array.isArray(descendants)) throw fault('UnsupportedRuntime', 'Cannot verify active native children');
        pending.push(...descendants);
      }
    } else if (typeof client.session.status === 'function') {
      try {
        const statusResult = await call('session', 'status', { query: query(directory) }, signal);
        if (statusResult && typeof statusResult === 'object' && !Array.isArray(statusResult)) statuses = statusResult;
      } catch { /* Unknown status keeps existing reservations. */ }
    }
    if (nativeOnly) return activeIDs;
    const reservations = activeByParent.get(sessionID) || new Set();
    let starting = 0;
    for (const entry of [...reservations]) {
      if (holdsSlot(entry, statuses)) {
        if (entry.childID) activeIDs.add(entry.childID);
        else starting++;
      } else dropReservation(sessionID, entry);
    }
    return activeIDs.size + starting;
  }
  async function parentContext(ctx) {
    const q = query(ctx.directory);
    const parent = await call('session', 'get', sessionArgs(ctx.sessionID, ctx.directory), ctx.abort);
    const message = await call('session', 'message', { path: { id: ctx.sessionID, messageID: ctx.messageID }, query: q }, ctx.abort);
    if (message?.info?.role !== 'assistant' || !routeOf(message.info)) throw fault('IdentityUnverified', 'Parent identity is unavailable');
    const config = await call('config', 'get', { query: q }, ctx.abort);
    const seen = new Set([parent.id]);
    let depth = 0, cursor = parent;
    while (cursor.parentID) {
      if (seen.has(cursor.parentID) || ++depth > 32) throw fault('DepthLimit', 'Invalid session ancestry');
      seen.add(cursor.parentID);
      cursor = await call('session', 'get', sessionArgs(cursor.parentID, ctx.directory), ctx.abort);
    }
    if (depth >= (config?.subagent_depth ?? 1)) throw fault('DepthLimit', 'Configured subagent depth reached');
    const rows = await call('session', 'messages', sessionArgs(ctx.sessionID, ctx.directory), ctx.abort);
    const user = rows.find(m => m.info?.role === 'user' && m.info.id === message.info.parentID);
    const assignment = (user?.parts || []).filter(p => p.type === 'text').map(p => p.text).join('\n');
    const previousReviewModels = [];
    for (const row of rows) for (const part of row.parts || []) {
      if (part.type !== 'tool' || !['delegate', 'task'].includes(part.tool) || part.state?.status !== 'completed') continue;
      try {
        const receipt = JSON.parse(part.state.output);
        if (receipt.parent_session !== ctx.sessionID ||
            !(receipt.independent_review === true || receipt.workflow?.mode === 'review' || receipt.role === 'review') ||
            receipt.status !== 'completed') continue;
        for (const attempt of receipt.attempts || []) {
          if (attempt.status === 'completed' && attempt.observed_model) previousReviewModels.push(attempt.observed_model);
        }
      } catch { /* Native task text is not a managed model receipt. */ }
    }
    const execution = await executionContext(toolkitRoot, ctx.directory || directory, parent, message);
    if (!execution?.catalog) throw fault('PermissionError', 'A current Freelancer request with a named agent catalog is required. Start a new request in the app; historical conversations remain readable.');
    return { parent, parentModel: routeOf(message.info), config, assignment, previousReviewModels,
      userMessageID: user?.info?.id, execution, depth };
  }
  async function stopped(id, directory) {
    // An abort acknowledgement alone is NOT proof of stop. Independently inspect
    // status and outstanding tool parts twice. Unknown/failed checks fail closed.
    try {
      await call('session', 'abort', sessionArgs(id, directory));
      const deadline = now() + cfg.stopMs;
      let idle = 0;
      while (now() < deadline) {
        const statuses = await call('session', 'status', { query: query(directory) });
        const messages = await call('session', 'messages', sessionArgs(id, directory));
        if (!statuses || !Array.isArray(messages)) return false;
        if ((!statuses[id] || statuses[id].type === 'idle') && !activeTool(messages)) {
          if (++idle === 2) return true;
        } else idle = 0;
        await sleep(cfg.pollMs);
      }
    } catch {}
    return false;
  }
  async function lookup(id, directory) {
    const visited = new Set();
    while (id && !visited.has(id) && visited.size < 32) {
      if (live.has(id)) return live.get(id);
      visited.add(id);
      const session = await call('session', 'get', sessionArgs(id, directory));
      const saved = session?.metadata?.freelancer || session?.metadata?.ai_toolkit;
      if (saved?.selected && typeof saved.readOnly === 'boolean') return { ...saved, directory };
      id = session?.parentID;
    }
    return null;
  }
  // Scoped cancellation. A durable receipt for this parent/project is the
  // ownership proof; the native abort acknowledgement alone is not proof of
  // stop. Unknown or failed verification reports stop_unverified so no second
  // writer is started over possibly live work.
  async function cancelWorker(args, ctx) {
    const child = await call('session', 'get', sessionArgs(args.worker, ctx.directory), ctx.abort);
    const latest = await readJson(workerFile(args.worker));
    const taskID = latest?.taskID ?? child?.metadata?.freelancer?.taskID;
    if (!/^[a-f0-9]{64}$/.test(taskID ?? '')) throw fault('InvalidAssignment', 'Unknown managed worker.');
    const receiptFile = path.join(stateDir, `${taskID}.json`);
    const prior = await readJson(receiptFile);
    const attempt = prior?.attempts?.at(-1);
    if (child?.parentID !== ctx.sessionID || prior?.parent_session !== ctx.sessionID ||
        prior?.directory !== ctx.directory || attempt?.child_session !== args.worker)
      throw fault('PermissionError', 'This worker does not belong to this parent and project.');
    const attemptRow = structuredClone(attempt);
    if (prior.status === 'completed' && attemptRow.status === 'completed')
      return { ...prior, status: 'worker_not_running', cancellation: { requested_at: stamp(), child_session: args.worker, stopped: false, reason: 'already_completed' },
        result: 'This worker already completed. Nothing was stopped and its recorded result stands; start a new bounded assignment instead of cancelling it.' };
    // Read the transcript before aborting so partial output survives the stop.
    let messages = null;
    try { messages = await call('session', 'messages', sessionArgs(args.worker, ctx.directory), ctx.abort); } catch {}
    const observed = workerResult(partialText(messages), { partial: true });
    const previous = prior.worker_result;
    const kept = previous?.summary?.trim()
      ? { ...previous, summary: previous.summary, resultSource: 'partial' }
      : observed;
    const verified = await stopped(args.worker, ctx.directory);
    const statuses = await call('session', 'status', { query: query(ctx.directory) }).catch(() => null);
    live.delete(args.worker);
    const receipt = { ...prior, status: verified ? 'cancelled' : 'stop_unverified',
      cancellation: { requested_at: stamp(), child_session: args.worker, agent: prior.agent?.id,
         selected_model: attemptRow.selected_model, native_status: statuses?.[args.worker]?.type || (verified ? 'idle' : 'unknown'),
        stop_verified: verified, method: 'native_session_abort' },
      worker_result: kept, ...(verified ? {} : { failure_class: 'uncertain_execution' }),
      activity: { ...(prior.activity || {}), schema_version: 1, phase: verified ? 'cancelled' : 'stop_unverified',
        label: verified ? 'Cancelled by parent' : `Stop unverified${attemptRow.failure ? ` · ${attemptRow.failure}` : ''}`,
        child_session: args.worker, selected_model: attemptRow.selected_model,
        abort_verified: verified, updated_at: stamp() },
       attempts: [...(prior.attempts || []).slice(0, -1), { ...attemptRow, status: verified ? 'cancelled' : 'failed', failure: verified ? 'cancelled' : attemptRow.failure ?? 'stop_unverified',
         abort_verified: verified, cancelled_at: stamp() }] };
    // Observers await this same persistence claim and retain the distinction
    // between a verified cancellation and an uncertain stop.
    const saved = atomicJson(receiptFile, receipt).then(() => receipt);
    cancellations.set(prior.task_id, saved);
    await saved;
    await emit(receipt);
    await ctx.metadata?.({ title: `@${prior.agent?.name ?? 'Agent'} · ${receipt.activity.label}`,
      metadata: { sessionId: args.worker, parentSessionId: ctx.sessionID, agentID: prior.agent?.id,
        agentName: prior.agent?.name, selected_model: attemptRow.selected_model, task_id: prior.task_id,
        freelancer_activity: receipt.activity, freelancer_status: receipt.status } });
    return { ...receipt, result: verified
      ? `Stop verified for child ${args.worker}. The partial result above is preserved for inspection. Cancellation is scoped to this worker: other workers, the parent chat and unrelated work are untouched.`
      : `Cancellation of child ${args.worker} could not be verified as stopped. Treat the outcome as uncertain: inspect the child session and its partial edits before starting overlapping work. No replacement worker was started.` };
  }
  async function emit(receipt) {
    try { await record?.(receipt); }
    catch { receipt.recording_error = 'Outcome hook failed; durable execution receipt retained'; }
  }
  async function workerReceipts(ctx) {
    const names = await Promise.resolve(stateFiles(stateDir)).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const rows = [];
    for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      const receipt = await readJson(path.join(stateDir, name));
      if (receipt?.parent_session === ctx.sessionID &&
          path.resolve(receipt.directory || '') === path.resolve(ctx.directory || directory)) rows.push(receipt);
    }
    return rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }
  async function reconcileWorker(receipt, child, ctx, statuses) {
    const attempt = receipt.attempts?.at(-1);
    if (!attempt || child.parentID !== ctx.sessionID || receipt.parent_session !== ctx.sessionID ||
        receipt.directory !== ctx.directory || attempt.child_session !== child.id ||
        !statuses || statuses[child.id]?.type && statuses[child.id].type !== 'idle') return receipt;
    if (!['running','stop_unverified','failed'].includes(receipt.status) || receipt.status === 'failed' && attempt.abort_verified) return receipt;
    const messages = await call('session', 'messages', sessionArgs(child.id, ctx.directory), ctx.abort);
    if (!Array.isArray(messages)) return receipt;
    const latestUser = messages.findLast(m => m.info?.role === 'user' && !m.parts?.some(p => p.type === 'compaction'));
    const reply = messages.findLast(m => m.info?.role === 'assistant' && !m.info.summary &&
      m.info.parentID === (latestUser?.info.id ?? attempt.user_message_id));
    if (activeTool(messages.filter(m => m.info?.parentID === (latestUser?.info.id ?? attempt.user_message_id)))) return receipt;
    if (!reply?.info.time?.completed || !(reply.info.error || reply.info.finish && reply.info.finish !== 'tool-calls')) return receipt;
    if (routeOf(reply.info) !== attempt.selected_model || reply.info.agent !== receipt.agent?.id) return receipt;
    const failed = !!reply.info.error;
    const repaired = { ...receipt, status: failed ? 'failed' : 'completed',
      reconciliation: { at: stamp(), source: 'native_idle_terminal', assistant_id: reply.info.id },
      worker_result: workerResult(partialText(messages), { partial: failed }),
      attempts: [...receipt.attempts.slice(0, -1), { ...attempt, status: failed ? 'failed' : 'completed', abort_verified: true }] };
    await atomicJson(path.join(stateDir, `${receipt.task_id}.json`), repaired);
    return repaired;
  }
  async function inspectWorkers(args, ctx) {
    let receipts = await workerReceipts(ctx);
    const nativeStatuses = await call('session', 'status', { query: query(ctx.directory) }, ctx.abort);
    receipts = await Promise.all(receipts.map(async receipt => {
      const id = receipt.attempts?.at(-1)?.child_session;
      if (!id || !['running','stop_unverified','failed'].includes(receipt.status) || receipt.status === 'failed' && receipt.attempts.at(-1).abort_verified) return receipt;
      const child = await call('session', 'get', sessionArgs(id, ctx.directory), ctx.abort);
      return child ? reconcileWorker(receipt, child, ctx, nativeStatuses) : receipt;
    }));
    const outbox = await readJson(path.join(toolkitRoot, '.state/webpage/sender-outbox.json'));
    const deliveries = worker => (outbox?.rows ?? []).filter(r => r.session === worker && r.execution?.worker?.parent === ctx.sessionID)
      .map(({ id, kind, status, includedAt, actedOn, error, notice }) => ({ id, kind, status, includedAt, actedOn, error, notice }));
    if (!args.worker) {
      const statuses = nativeStatuses;
      return { status: 'workers', workers: receipts.flatMap(receipt =>
      (receipt.attempts || []).filter(attempt => attempt.child_session).map(attempt => ({
        task_id: receipt.task_id, child_session: attempt.child_session,
        agent: receipt.agent?.name, assignment: receipt.activity?.assignment || null,
        receipt_status: receipt.status, native_status: statuses?.[attempt.child_session]?.type || 'idle',
         attempt_status: attempt.status,
         created_at: receipt.created_at, activity: receipt.activity || null,
         worker_result: annotateWorkerContext(receipt.worker_result, receipt), deliveries: deliveries(attempt.child_session),
      }))) };
    }
    const current = await readJson(workerFile(args.worker));
    const matching = receipts.filter(row => row.attempts?.some(attempt => attempt.child_session === args.worker));
    const receipt = matching.find(row => row.task_id === current?.taskID) ?? matching.at(-1);
    if (!receipt) throw fault('PermissionError', 'This worker does not belong to this parent and project.');
    const child = await call('session', 'get', sessionArgs(args.worker, ctx.directory), ctx.abort);
    if (child?.parentID !== ctx.sessionID) throw fault('BindingFailure', 'Native child session does not match the recorded parent.');
    const [messages, statuses] = await Promise.all([
      call('session', 'messages', sessionArgs(args.worker, ctx.directory), ctx.abort),
      call('session', 'status', { query: query(ctx.directory) }, ctx.abort),
    ]);
    if (!Array.isArray(messages)) throw fault('UnsupportedRuntime', 'Native worker messages are unavailable.');
    const limit = Math.min(20, Math.max(1, Number.isInteger(args.limit) ? args.limit : 8));
    const from = Number.isInteger(args.from) && args.from >= 0 ? Math.min(args.from, messages.length) : Math.max(0, messages.length - limit);
    const selected = messages.slice(from, from + limit);
    const parts = row => (row.parts || []).filter(part => ['text', 'reasoning', 'tool'].includes(part.type)).map(part => {
      if (part.type === 'tool') return { type: 'tool', tool: part.tool, status: part.state?.status,
        title: part.state?.title, input: part.state?.input,
        output: typeof part.state?.output === 'string' ? part.state.output.slice(0, 4000) : part.state?.output,
        output_truncated: typeof part.state?.output === 'string' && part.state.output.length > 4000,
        error: part.state?.error };
      return { type: part.type, text: String(part.text || '') };
    });
    return { status: 'worker_transcript', task_id: receipt.task_id, child_session: args.worker, deliveries: deliveries(args.worker),
      parent_session: ctx.sessionID, agent: receipt.agent?.name, assignment: receipt.activity?.assignment || null,
      receipt_status: receipt.status, native_status: statuses?.[args.worker]?.type || 'idle',
       activity: receipt.activity || null, worker_result: annotateWorkerContext(receipt.worker_result, receipt) || null,
      total_messages: messages.length, from, next_from: from + selected.length < messages.length ? from + selected.length : null,
      messages: selected.map(row => ({ id: row.info?.id, role: row.info?.role, agent: row.info?.agent,
        created_at: row.info?.time?.created, completed_at: row.info?.time?.completed,
        error: row.info?.error, parts: parts(row) })) };
  }
  async function run(args, ctx, resolvedParent) {
    if (args.role !== undefined) throw fault('InvalidAssignment', 'Use delegate({agent, task}) with a named agent and bounded task.');
    const { parent, parentModel, config, assignment, userMessageID, execution, previousReviewModels } = resolvedParent;
    const legacyContract = execution.policyVersion < 5;
    const legacyWorkflowID = args.workflowID ?? execution.workflow?.id;
    const legacyWorkflow = legacyContract
      ? execution.catalog?.workflows?.find((item) => item.id === legacyWorkflowID) ??
        (execution.workflow?.id === legacyWorkflowID ? execution.workflow : null)
      : null;
    if (legacyContract && !legacyWorkflow) throw fault('PermissionError', 'Legacy execution metadata is incomplete.');
    const mode = legacyWorkflow?.mode ?? 'build';
    if (legacyContract && parent.parentID) throw fault('PermissionError', 'Nested delegation is disabled for this already-captured legacy request.');
    if (legacyContract && legacyWorkflow?.id === 'sync') throw fault('PermissionError', 'Legacy Git/Sync requests use the managed Git tool directly.');
    const loaded = await loadPreferences(toolkitRoot, ctx.directory || directory, ctx.sessionID);
    const current = loaded.defaults;
    const captured = execution.preferences ?? current;
    // A newer turn may replace the session's execution overlay. This assignment
    // keeps its own parent snapshot, intersected with any current user limits.
    const savedPreferences = effectiveDelegationPreferences(current, captured);
    if (resolvedParent.depth >= savedPreferences.maxDepth) throw fault('DepthLimit', 'Configured delegation depth reached. Complete this concern directly.');
    const catalog = execution.catalog;
    const pool = variant => capturedDelegationPool(execution, current, savedPreferences, variant);
    if (!Object.keys(args).length) return {
      status: 'catalog',
      agents: catalog.agents.map(({ id, name, model, prompt }) => ({ id, name, defaultModel: model, expertise: prompt.slice(0, 400),
        ...(legacyContract ? { allowed: agentAssignmentAllowed(current, id, mode) && agentAssignmentAllowed(captured, id, mode) } : {}) })),
      budget: { delegation: savedPreferences.delegation, subscriptionDelegation: savedPreferences.subscriptionDelegation, maxParallel: savedPreferences.maxParallel, freeOnly: savedPreferences.costPreference === 'free-only',
        modelPool: pool(savedPreferences.childVariant) },
      note: delegationGuidance(savedPreferences, pool(savedPreferences.childVariant)) + ' Edits apply to the next main request, not work already in progress.',
    };
    let continued, forkContext = null, forkSourceWorker = null;
    if (args.delivery && (!args.worker || !['steer', 'queue'].includes(args.delivery))) throw fault('InvalidAssignment', 'Steer or Queue requires an existing worker and a task.');
    // Scoped cancellation is one compact delegate surface, not a second tool.
    // It owns a worker identity and never starts a replacement child.
    if (args.cancel !== undefined) {
      if (args.cancel !== true) throw fault('InvalidAssignment', 'cancel:true stops one worker. Omit cancel to inspect, continue, steer or queue.');
      if (!args.worker) throw fault('InvalidAssignment', 'cancel requires worker: the child session ID from workers:true or a worker receipt.');
      if (args.task?.trim()) throw fault('InvalidAssignment', 'Cancel stops a worker and takes no task. Continue or correct it with worker and task instead.');
      if (args.agentID || args.selectedModel || args.delivery || args.workers === true)
        throw fault('InvalidAssignment', 'Cancel accepts only worker and cancel; it cannot also assign, deliver or list.');
      return cancelWorker(args, ctx);
    }
    if (args.worker) {
      const child = await call('session', 'get', sessionArgs(args.worker, ctx.directory), ctx.abort);
      const latest = await readJson(workerFile(args.worker));
      const taskID = latest?.taskID ?? child?.metadata?.freelancer?.taskID;
      if (!/^[a-f0-9]{64}$/.test(taskID ?? '')) throw fault('InvalidAssignment', 'Unknown managed worker.');
      let prior = await readJson(path.join(stateDir, `${taskID}.json`));
      const attempt = prior?.attempts?.at(-1);
      if (child?.parentID !== ctx.sessionID || prior?.parent_session !== ctx.sessionID || prior?.directory !== ctx.directory || attempt?.child_session !== args.worker)
        throw fault('PermissionError', 'This worker does not belong to this parent and project.');
      prior = await reconcileWorker(prior, child, ctx, await call('session', 'status', { query: query(ctx.directory) }, ctx.abort));
      if (args.fork === true) {
        const parentConstraint = await lookup(ctx.sessionID, ctx.directory);
        forkContext = composeWorkerFork({ worker: args.worker, task: args.task,
          model: args.selectedModel, sourceReceipt: prior, sourceChild: child,
          parent: { sessionID: ctx.sessionID, directory: ctx.directory,
            readOnly: parentConstraint?.readOnly === true, freeOnly: parentConstraint?.freeOnly === true },
          needsWrites: args.needsWrites, inspectionOnly: args.needsWrites === false,
          freeOnly: args.freeOnly, now: now() });
        forkSourceWorker = forkContext.source.worker;
        args = { ...args, agentID: forkContext.dispatch.agentID,
          needsWrites: forkContext.dispatch.needsWrites, freeOnly: forkContext.dispatch.free_only };
        // Use the ordinary selector and create path below. Never continue or
        // model-pin the source worker's native session.
        delete args.worker; delete args.fork; delete args.selectedModel;
      } else if (args.delivery) {
        if (!handoff) throw fault('UnsupportedRuntime', 'Worker delivery requires the Freelancer sender.');
        if (!args.task?.trim()) throw fault('InvalidTask', 'A worker handoff needs a bounded task or correction.');
        if (savedPreferences.delegation === 'manual' || /\b(?:do not delegate|don.t delegate|handle (?:it|this) yourself|no (?:workers|delegation))\b/i.test(assignment)) throw fault('PreferenceConstraint', 'Delegation is disabled by the user.');
        if (args.agentID && args.agentID !== prior.agent.id || args.selectedModel && args.selectedModel !== attempt.selected_model) throw fault('BindingFailure', 'Steer and Queue preserve the worker agent and model.');
        if (!pool(attempt.variant ?? '').includes(attempt.selected_model)) throw fault('PreferenceConstraint', 'The worker model is outside the captured delegation budget.');
        const selected = execution.catalogModels.find(m => m.id === attempt.selected_model);
        const inherited = await lookup(ctx.sessionID, ctx.directory);
        const freeOnly = !!(args.freeOnly || prior.free_only || inherited?.freeOnly || freeOnlyAssignment(assignment));
        if (freeOnly && selected?.costClass !== 'free') throw fault('PreferenceConstraint', 'This worker is not eligible free capacity.');
        if (selected?.costClass !== 'free') {
          if (!ctx.ask) throw fault('PermissionError', 'Native paid_delegate permission is required.');
          await ctx.ask({ permission: 'paid_delegate', patterns: [attempt.selected_model], always: [attempt.selected_model], metadata: { model: attempt.selected_model, agentID: prior.agent.id, worker: args.worker, delivery: args.delivery } });
        }
        const delivery = await handoff({ worker: args.worker, task: args.task, delivery: args.delivery,
          inspectionOnly: args.needsWrites === false || inherited?.readOnly === true, freeOnly,
          directory: ctx.directory, sessionID: ctx.sessionID, messageID: ctx.messageID, callID: ctx.callID }, ctx.abort);
        return { ...delivery, parent_session: ctx.sessionID, agent: prior.agent, selected_model: attempt.selected_model, task_id: prior.task_id };
      }
      if (!forkSourceWorker) {
        const savedDeliveries = await readJson(path.join(toolkitRoot, '.state/webpage/sender-outbox.json'));
        if (savedDeliveries?.rows?.some(r => r.session === args.worker && ['waiting','sending','submitted','uncertain','failed'].includes(r.status))) throw fault('WorkerBusy', 'This worker has pending or uncertain deliveries. Inspect it; use Steer or Queue without bypassing those deliveries.');
        if (!(prior.status === 'completed' || ['failed','cancelled'].includes(prior.status) && prior.attempts.at(-1).abort_verified === true))
          throw fault('WorkerBusy', 'Worker is active or its delivery/stop is uncertain. Inspect it before continuing.');
        const statuses = await call('session', 'status', { query: query(ctx.directory) }, ctx.abort);
        if (!statuses || statuses[args.worker]?.type && statuses[args.worker].type !== 'idle') throw fault('WorkerBusy', 'Worker has not reached an idle boundary.');
        if (args.agentID && args.agentID !== prior.agent.id || args.selectedModel && args.selectedModel !== attempt.selected_model)
          throw fault('BindingFailure', 'Continuation preserves the worker agent and model.');
        args = { ...args, agentID: prior.agent.id, selectedModel: attempt.selected_model,
          independentReview: args.independentReview ?? prior.independent_review,
          ...(prior.read_only ? { needsWrites: false } : {}), ...(prior.free_only ? { freeOnly: true } : {}) };
        continued = child;
      }
    }
    const agent = catalog.agents.find(agent => agent.id === args.agentID);
    if (!args.agentID) throw fault('InvalidAgent', 'Missing agent. Call delegate() to inspect the current catalog, then pass agent with one listed ID.', { valid_agents: catalog.agents.map(item => item.id) });
    if (!agent) throw fault('InvalidAgent', `Unknown agent "${args.agentID}". Call delegate() to refresh the catalog and use one of the returned IDs.`, { supplied_agent: args.agentID, valid_agents: catalog.agents.map(item => item.id) });
    if (typeof args.task !== 'string' || !args.task.trim()) throw fault('InvalidTask', 'Missing task. Pass a non-empty bounded assignment in task; the assignment text does not choose an agent.', { agent: agent.id });
    if (savedPreferences.delegation === 'manual' || /\b(?:do not delegate|don.t delegate|handle (?:it|this) yourself|no (?:workers|delegation))\b/i.test(assignment)) throw fault('PreferenceConstraint', 'Delegation is disabled by the user. Work directly with permitted tools.');
    if (legacyContract && (!agentAssignmentAllowed(savedPreferences, agent.id, mode) || !agentAssignmentAllowed(captured, agent.id, mode))) throw fault('PreferenceConstraint', 'This named agent assignment is disabled by the captured legacy policy.');
    const inherited = await lookup(ctx.sessionID, ctx.directory);
    // Preserve captured legacy mode semantics. New policy-v6 requests are fixed Build.
    const writesNotAuthorized = execution.policyVersion === 3 ? args.needsWrites !== true : args.needsWrites === false;
    const readOnly = inherited?.readOnly || execution.readOnly || (legacyContract && mode !== 'build') || writesNotAuthorized || noWriteAssignment(args.task) || noWriteAssignment(assignment);
    if ((inherited?.readOnly || execution.readOnly) && args.needsWrites) throw fault('PermissionError', 'Read-only parent cannot create a writer');
    const explicitModel = Boolean(args.selectedModel);
    const variant = args.variant ?? (agent.variant && agent.variant !== 'inherit' ? agent.variant : legacyContract && legacyWorkflow.variant && legacyWorkflow.variant !== 'inherit' ? legacyWorkflow.variant : savedPreferences.childVariant);
    if (variant && !/^[\w-]{1,80}$/.test(variant)) throw fault('InvalidAssignment', 'Choose a reported child intelligence level');
    // Workflow model restrictions belong only to legacy captured requests.
    const allowedModels = pool(variant).filter(id => !legacyContract || legacyModelAllowed(legacyWorkflow, execution.catalogModels.find(m => m.id === id), execution.catalogConnected ?? []));
    if (args.selectedModel) {
      try { splitModel(args.selectedModel); }
      catch { throw fault('InvalidModel', 'model must be an exact provider/model ID. Call delegate() to inspect budget.modelPool, or omit model for automatic eligible routing.', { supplied_model: args.selectedModel, eligible_models: allowedModels }); }
      const knownModel = execution.catalogModels.some(model => model.id === args.selectedModel);
      if (!knownModel) throw fault('InvalidModel', `Unknown model "${args.selectedModel}". Use an exact ID from delegate() budget.modelPool, or omit model for automatic eligible routing.`, { supplied_model: args.selectedModel, eligible_models: allowedModels });
      if (!allowedModels.includes(args.selectedModel))
        throw fault('PreferenceConstraint', `Model "${args.selectedModel}" is known but not eligible for this request under the captured/current budget, provider, variant or exclusion rules. No child started.`, { supplied_model: args.selectedModel, eligible_models: allowedModels });
    }
    if (!allowedModels.length) return { status: 'delegation_unavailable', failure_class: 'unavailable',
      agent: { id: agent.id, name: agent.name }, model_selection: null, attempts: [],
      routing_diagnostics: { eligible_model_count: 0, free_only: inherited?.freeOnly === true || args.freeOnly === true || savedPreferences.costPreference === 'free-only' || freeOnlyAssignment(assignment),
        cost_preference: savedPreferences.costPreference, requested_variant: variant || null },
      result: 'No agent started. No model satisfies the current delegation budget and provider rules. Continue directly in the parent chat when allowed, or report this as unresolved if the user required a separate worker or independent review. Do not relax the user limits or retry unchanged.' };
    const preferences = { ...savedPreferences, allowedModels,
      maxParallel: legacyContract && legacyWorkflow.parallel === false ? 1 : savedPreferences.maxParallel };
    const defaultModel = agent.model && agent.model !== 'auto' ? agent.model : null;
    // Agent defaults are preferences, not an extra lock. Unavailable defaults
    // return to normal candidate assessment; explicit assignment choices do not.
    const requiresFree = inherited?.freeOnly === true || args.freeOnly === true || preferences.costPreference === 'free-only' || freeOnlyAssignment(assignment);
    const defaultEligible = defaultModel && allowedModels.includes(defaultModel) &&
      (!requiresFree || execution.catalogModels.find(m => m.id === defaultModel)?.costClass === 'free');
    args = { ...args, ...(args.selectedModel || !defaultEligible ? {} : { selectedModel: defaultModel }) };
    const effectiveArgs = policyInputs(preferences, { ...args, mode });
    const userDirectedModel = Boolean(explicitModel && userDirectedModelAssignment(assignment, args.selectedModel));
    const nativeAgents = await call('app', 'agents', { query: query(ctx.directory) }, ctx.abort);
    const nativeAgent = nativeAgents?.find(a => a.name === agent.id);
    if (!nativeAgent || !Array.isArray(nativeAgent.permission)) throw fault('UnsupportedRuntime', 'Named agent execution profile unavailable. Start a new request after the current work finishes.');
    if (nativeAgent.model) throw fault('PinnedAgent', 'Native model pins are not supported; choose the agent default in Freelancer.');
    const freeOnly = inherited?.freeOnly === true || effectiveArgs.freeOnly === true || freeOnlyAssignment(assignment);
    const needsModelDiversity = args.independentReview === true || args.needsModelDiversity === true;
    const excludeModels = [...new Set([...(effectiveArgs.excludeModels || []),
      ...(args.independentReview === true && needsModelDiversity ? previousReviewModels : [])])];
    const policy = await readJson(path.join(toolkitRoot, 'routing', 'policy.json'));
    const allowed = new Set(policy?.allowed_surfaces || []);
    const { decisionId: suppliedDecisionId, ...assignmentArgs } = args;
    if (forkSourceWorker) assignmentArgs.forkSourceWorker = forkSourceWorker;
    let decisionId = suppliedDecisionId;
    let choice;
    if (decisionId) {
      if (!/^[a-f0-9]{64}$/.test(decisionId)) throw fault('PermissionError', 'Invalid model choice reference');
      const decision = await readJson(path.join(stateDir, 'decisions', `${decisionId}.json`));
      if (!decision || decision.sessionID !== ctx.sessionID || !sameDecisionAssignment(decision.args, assignmentArgs)) {
        throw fault('PermissionError', 'Model choice does not match this assignment and session');
      }
      choice = answeredChoice(decision, await call('session', 'messages', sessionArgs(ctx.sessionID, ctx.directory), ctx.abort), now());
    } else {
      const recorded = await recordedDecision(assignmentArgs, ctx, userMessageID);
      if (recorded) {
        decisionId = recorded.decision.id;
        choice = recorded.choice;
      }
    }
    if (choice?.model && explicitModel && args.selectedModel !== choice.model)
      throw fault('PermissionError', 'Selected model conflicts with the recorded user choice');
    // One recorded answer authorizes one execution. Explicit and automatic
    // resumes converge on the same decision-backed receipt.
    const id = hash(JSON.stringify(decisionId ? [ctx.sessionID, decisionId, ...(forkSourceWorker ? [forkSourceWorker] : [])] : [ctx.sessionID, ctx.messageID, assignmentArgs]));
    const receiptFile = path.join(stateDir, `${id}.json`);
    const previous = await readJson(receiptFile);
    // Capacity refusal is not an execution attempt. Retry the same assignment
    // after a slot frees, with all current permissions/budget checks repeated.
    // Submitted, failed, uncertain or completed children are never auto-replayed.
    if (previous && !(previous.status === 'parallel_limit' && Array.isArray(previous.attempts) && previous.attempts.length === 0)) {
      const a = previous.attempts?.at(-1);
      if (previous.status === 'completed' && a?.child_session) {
        const rows = await call('session', 'messages', sessionArgs(a.child_session, ctx.directory), ctx.abort);
        const saved = observe(rows.filter(m => m.info?.parentID === a.user_message_id), a.selected_model, previous.agent?.id ?? previous.role);
        if (saved.complete) return { ...previous, replay: true, result: saved.text };
      }
      return { ...previous, replay: true, result: 'Existing attempt not replayed. Inspect the listed child session before retrying.' };
    }
    // OpenCode runs independent tool calls concurrently. A worktree-wide lock
    // prevented even disjoint assignments from using that native scheduling.
    // Build owns file/task boundaries; receipts and cancellation stay per child.
    const receipt = { task_id: id, user_task_id: args.userTaskId || `${ctx.sessionID}/${ctx.messageID}`, parent_session: ctx.sessionID, root_session: execution.rootSessionID ?? ctx.sessionID, parent_model: parentModel,
      agent: structuredClone(agent), agent_id: agent.id, mode,
      ...(forkContext ? { fork: { source_worker: forkContext.source.worker, source_task_id: forkContext.source.task_id,
        evidence: forkContext.evidence, project_state: forkContext.project_state, requirements: forkContext.requirements } } : {}),
      ...(args.independentReview === true || args.needsModelDiversity === true ? { independent_review: true } : {}),
      ...(legacyContract && legacyWorkflow ? { workflow: structuredClone(legacyWorkflow) } : {}),
      project_id: execution.projectID, parent_message_id: execution.id, parent_assistant_id: ctx.messageID, delegate_call_id: ctx.callID,
      read_only: readOnly, policy_version: execution.policyVersion,
      root_request_id: execution.rootRequestID ?? execution.id,
      task_hash: hash(args.task), task_types: args.taskTypes || [], directory: ctx.directory, free_only: freeOnly,
      created_at: stamp(), status: 'running', validation: 'pending', attempts: [] };
    receipt.runtime_policy = { strategy: preferences.strategy, delegation: preferences.delegation,
      cost_preference: preferences.costPreference, subscription_delegation: preferences.subscriptionDelegation, minimum_context: effectiveArgs.minimumContext,
      max_parallel: preferences.maxParallel, timeout_seconds: preferences.childTimeoutSeconds };
    if (args.selectedModel) receipt.model_selection = { source: userDirectedModel ? 'user' : explicitModel ? 'host' : 'agent_default', model: args.selectedModel };
    if (choice) receipt.user_choice = choice;
    const propose = async (selection, allowParent = true) => {
      const last = receipt.attempts.at(-1);
      const failureDetail = last?.status === 'failed'
        ? `${last.failure || 'unknown'} (${last.error_type || 'Error'}, abort_verified=${last.abort_verified ?? 'unknown'}${last.error ? `, ${last.error.slice(0, 160)}` : ''})`
        : last?.failure;
      const decision = makeDecision({ id, args: assignmentArgs, agentName: agent.name, workMode: mode, selection, parentModel, sessionID: ctx.sessionID, userMessageID, createdAt: stamp(), allowParent, failure: failureDetail });
      await atomicJson(path.join(stateDir, 'decisions', `${id}.json`), decision);
      receipt.execution_status = receipt.status;
      receipt.status = 'decision_required';
      receipt.decision = { id, questions: [decision.question] };
      const abortNote = last?.status === 'failed'
        ? `Handoff stopped before completion: failure=${last.failure || 'unknown'}, error_type=${last.error_type || 'Error'}${last.error ? `, error=${last.error.slice(0, 200)}` : ''}, abort_verified=${last.abort_verified ?? 'unknown'}, child_session=${last.child_session || 'none'}, selected=${last.selected_model || 'none'}, observed=${last.observed_model || 'none'}. Report this to the user; do not leave it silent. Inspect the child session and partial edits before retrying overlapping work. `
        : '';
      receipt.result = `${abortNote}Ask the user with the native question tool using decision.questions unchanged. Do not infer an answer, execute a child, or continue the overlapping assignment yourself. Disjoint independent parent work may continue. After the answer, call delegate again with the same bounded assignment. decisionId may be supplied, but is not required: the backend can match the recorded native answer for this request. Custom answers need clarification. Native execution permissions remain authoritative.`;
      await atomicJson(receiptFile, receipt);
      return receipt;
    };
    if (choice && choice.action !== 'child') {
      receipt.status = choice.action;
      receipt.result = choice.action === 'continue_parent'
        ? 'The user chose the current model. Continue directly within the original task boundaries; no child ran and this is not independent verification.'
        : 'The user chose to stop here. Do not continue, retry, schedule work, or launch a child.';
      await atomicJson(receiptFile, receipt);
      return receipt;
    }
    // Durable equivalent-failure guard across tool calls and runtime restarts.
    if (!legacyContract) {
      const names = await Promise.resolve(stateFiles(stateDir)).catch(() => []);
      let failures = 0;
      for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
        const prior = await readJson(path.join(stateDir, name));
        if (prior?.root_request_id === receipt.root_request_id && prior?.task_hash === receipt.task_hash && prior.attempts?.some(a => a.status === 'failed')) failures++;
      }
      if (failures >= 3) return { ...receipt, status: 'diagnosis_required', failure_class: 'recoverable_provider_issue', result: 'This assignment failed three times. Inspect its partial results, change the diagnosis or scope, and report the unresolved cause before trying again.' };
    }
    let release = true;
    {
      await atomicJson(receiptFile, receipt);
      const rejected = [];
      // One host-selected execution; recovery is a fresh explicit decision.
      for (let n = 0; n < 1; n++) {
        if (ctx.abort?.aborted) throw fault('AbortError', 'Parent cancelled');
        await beforeSelect({ signal: ctx.abort });
        const roster = await readJson(path.join(toolkitRoot, 'routing', 'model-roster.json'));
        const excludedByProvider = (roster?.eligible_models || []).filter(m => preferences.excludedProviders.includes(m.id.split('/')[0]) || (preferences.allowedModels.length && !preferences.allowedModels.includes(m.id))).map(m => m.id);
        const selection = await select({ ...effectiveArgs, runtimeModels: allowedModels, costPreference: preferences.costPreference,
          selectedModel: choice?.model || args.selectedModel,
          hostAssessment: true, excludeModels, freeOnly, needsModelDiversity, needsWrites: !readOnly, currentModel: parentModel,
          rejected: [...rejected, ...preferences.excludedModels, ...excludedByProvider] }, ctx);
        const selected = selection?.selected_model;
        if (selected && (preferences.excludedModels.includes(selected) || preferences.excludedProviders.includes(selected.split('/')[0]) || (preferences.allowedModels.length && !preferences.allowedModels.includes(selected)))) throw fault('PreferenceConstraint', 'Selected route is excluded by user preferences.');
        const eligible = selected && allowed.has(selection.surface) && ['adequate', 'strong', 'host_assessment_required'].includes(selection.adequacy);
        if (legacyContract && !choice && !args.selectedModel && eligible) {
          receipt.status = 'selection_required';
          receipt.candidates = selection.candidates || [];
          receipt.previous_review_models = previousReviewModels;
          receipt.excluded_models = excludeModels;
          receipt.routing_diagnostics = { filtered_out: selection.filtered_out || [], evidence_freshness: selection.evidence_freshness, quota_state: selection.quota_state };
          receipt.skipped_default_model = defaultModel && !defaultEligible ? defaultModel : null;
          receipt.result = 'Candidates inspected; no child started. Compare task fit, context, capacity and uncertainty rather than choosing the first score blindly. When delegation helps, re-call this bounded assignment with selectedModel and an optional honest selectionReason. You may instead work directly when the user did not require delegation or independent verification. This is not a user model-choice question or completed work. Preserve free-only, exclusions and review independence; never alter evidence to force a route.';
          await atomicJson(receiptFile, receipt);
          return receipt;
        }
        if (eligible && !args.selectedModel) receipt.model_selection = { source: 'runtime', model: selected, reasons: selection.reason_codes || [], evidence: selection.adequacy };
        if (!eligible) {
          receipt.status = 'no_qualified_route';
          receipt.routing_diagnostics = { free_only: freeOnly, review_basis: selection?.review_basis,
            reasons: selection?.reason_codes || [], filtered_out: selection?.filtered_out || [] };
          if (legacyContract) return propose(selection?.choice_unavailable ? selection : { ...selection, selected_model: null, choices: null });
          receipt.failure_class = 'unavailable';
          receipt.result = `No agent started. No eligible route met the current budget, provider availability and task-fit requirements${receipt.routing_diagnostics.reasons.length ? ` (routing reasons: ${receipt.routing_diagnostics.reasons.join(', ')})` : ''}. Continue directly in the parent chat when allowed, or report this as unresolved if the user required a separate worker or independent review. Do not relax the budget or retry unchanged.`;
          await atomicJson(receiptFile, receipt);
          return receipt;
        }
        if (freeOnly && selection.surface !== 'opencode-free') { receipt.status = 'free_only_violation'; break; }
        if (selection.quota_state?.overage && policy?.allow_overage !== true) { receipt.status = 'overage_not_authorized'; break; }
        if (rejected.includes(selected)) { receipt.status = 'no_alternative'; break; }
        if (choice?.model && selected !== choice.model) throw fault('BindingFailure', 'Selector did not preserve the user-selected qualified route');
        if (!choice && args.selectedModel && selected !== args.selectedModel) throw fault('BindingFailure', 'Selector did not preserve the host-selected route');
        selection.host_reason = args.selectionReason;
        // If the user's current request explicitly names this route, do not ask
        // them to choose the same model again. Eligibility, quota/surface policy,
        // native task permission and paid_delegate permission still apply.
        if (legacyContract && !choice && (preferences.delegation === 'ask' || (!userDirectedModel && selection.surface !== 'opencode-free' && preferences.subscriptionDelegation !== 'automatic'))) return propose(selection);
        // Legacy requests retain the old task-permission ceremony. New requests
        // requests rely on the delegate tool call itself and stop only for paid use.
        if (legacyContract) {
          if (typeof ctx.ask !== 'function') throw fault('UnsupportedRuntime', 'Native task permission check unavailable');
          await ctx.ask({ permission: 'task', patterns: legacyTaskPatterns(agent.id, mode), always: ['*'], metadata: { agentID: agent.id } });
        }
        if (selection.surface !== 'opencode-free') {
          receipt.status = 'awaiting_paid_permission';
          receipt.subscription_request = { selected_model: selected, surface: selection.surface,
            requested_at: stamp(), status: 'pending' };
          await atomicJson(receiptFile, receipt);
          try {
            if (typeof ctx.ask !== 'function') throw fault('UnsupportedRuntime', 'Paid-model permission check unavailable');
            await ctx.ask({ permission: 'paid_delegate', patterns: [selected], always: [selected],
              metadata: { model: selected, surface: selection.surface, agentID: agent.id,
                reason: (selection.reason_codes || []).join('; '),
                consumption_estimate: selection.consumption_estimate || null,
                note: 'Uses subscription capacity. Provider price proxies are not a cash charge estimate.' } });
          } catch {
            receipt.status = ctx.abort?.aborted ? 'cancelled' : 'paid_permission_declined';
            receipt.subscription_request.status = 'not_granted'; break;
          }
          receipt.subscription_request.status = 'allowed_by_native_permission';
          receipt.status = 'running';
        }
        const model = splitModel(selected);
        const attempt = { selected_model: selected, dispatched_model: null, observed_model: null,
          surface: selection.surface, selection_reasons: selection.reason_codes || [], adequacy: selection.adequacy,
          review_basis: selection.review_basis || null,
          host_selection_reason: args.selectionReason || null,
          evidence_assessment: selection.adequacy,
          started_at: stamp(), status: 'starting', abort_verified: null };
        receipt.attempts.push(attempt);
        const permissions = [
          ...(parent.permission || []),
          ...((config.experimental?.primary_tools || []).map(p => rule(p))),
          ...(legacyContract ? [rule('delegate')] : []),
          rule('task'),
          // Native shell permissions remain authoritative. Read-only is a job
          // contract, not a shell sandbox; keep direct source edits disabled
          // while allowing content-index rebuild (edit permission scoped to
          // the content-index database pattern).
          // OpenCode evaluate() is last-match. Deny * must precede the rebuild allow,
          // or the wildcard deny also blocks "content-index database". checkTool
          // still rejects the edit/write/apply_patch tools for read-only work.
          ...(readOnly ? [rule('write'), rule('apply_patch'), rule('edit'), rule('edit', 'allow', 'content-index database')] : []),
        ];
        let child;
        let acknowledged = false;
        let submitted = false;
        let reservation;
        try {
          // Account for native children that survived a backend restart. The
          // local reservation covers the gap before session.create completes.
          const rootSessionID = execution.rootSessionID ?? ctx.sessionID;
          reservation = await reserveSlot(rootSessionID, ctx.directory, ctx.abort, preferences.maxParallel);
          if (!reservation) {
            receipt.status = 'parallel_limit';
            receipt.attempts.pop();
            receipt.result = 'User child concurrency limit reached. Keep this assignment in the parent or wait for an existing child; no child started.';
            await atomicJson(receiptFile, receipt);
            return receipt;
          }
          child = continued ?? await call('session', 'create', { query: query(ctx.directory), body: {
            parentID: ctx.sessionID, title: `${agent.name} · ${args.task.trim().replace(/\s+/g, ' ').slice(0, 80)}`, agent: agent.id, permission: permissions,
            metadata: { freelancer: { selected, readOnly, freeOnly, agentID: agent.id, mode, taskID: id } },
          } }, ctx.abort);
          if (!child?.id || child.id === ctx.sessionID) throw fault('UnsupportedRuntime', 'Child session was not created');
          reservation.childID = child.id;
          attempt.child_session = child.id;
          attempt.user_message_id = `msg_${Date.now().toString(16).padStart(12, '0')}${randomUUID().replaceAll('-', '').slice(0, 14)}`;
          attempt.variant = variant;
          await reservation.bind(child.id, attempt.user_message_id);
          await atomicJson(receiptFile, receipt);
          const verify = await call('session', 'get', sessionArgs(child.id, ctx.directory), ctx.abort);
          if (verify.parentID !== ctx.sessionID || !equalRules(verify.permission, permissions)) {
            throw fault('UnsupportedRuntime', 'Server did not preserve child linkage/permissions; no inference sent');
          }
          await atomicJson(workerFile(child.id), { taskID: id });
          await atomicJson(workerBindingFile(toolkitRoot, child.id, attempt.user_message_id), { taskID: id });
          live.set(child.id, { selected, readOnly, freeOnly, directory: ctx.directory });
          const displayMetadata = { sessionId: child.id, parentSessionId: ctx.sessionID, agentID: agent.id, agentName: agent.name, mode, selected_model: selected, model, task_id: id };
          await ctx.metadata?.({ title: `@${agent.name} · ${selected}`, metadata: displayMetadata });
          submitted = true;
          attempt.dispatched_model = selected;
          await call('session', 'promptAsync', { ...sessionArgs(child.id, ctx.directory), body: {
            agent: agent.id, model, messageID: attempt.user_message_id, ...(variant ? { variant } : {}),
            system: executionPrompt(agent, { policyVersion, agentID: agent.id, mode: 'build', delegated: true }, catalog) + '\n\n' + workerResultInstruction,
            parts: [{ type: 'text', text: `${forkContext ? forkTaskText(forkContext, args.task) : args.task}\n\nWorking directory: ${ctx.directory || directory}. Resolve assignment paths from this root; use glob to locate a missing path before retrying.\nWork directly unless an independent specialist materially helps. Nested delegation shares the configured depth and concurrency ceilings.\nUse content_index status/search for project documentation, plans and mixed data when useful; verify decisive hits against originals. Use grep/glob/read or native code search for code. Missing/stale index coverage never blocks source search.\n${readOnly ? 'READ-ONLY: do not change source files. content_index status/search/rebuild and git_project inspect/preview are permitted retrieval maintenance; use them when useful. Native shell checks are available subject to inherited OpenCode permissions: use inspection commands only, never writes, installs, redirects or tests that create artifacts. Return mutating validation and source writes to the main conversation. Direct edit tools remain unavailable. This is a task contract, not a shell sandbox.' : 'Preserve unrelated work. Validate changes; report unverified checks honestly.'}\nIf any tool is denied or unavailable, do not retry variants to bypass it. Continue with permitted tools and return the exact unresolved check. Prioritize targeted reads and concrete probes over whole-file surveys; stop with supported findings and explicit coverage gaps.` }],
          } }, ctx.abort);
          acknowledged = true;
          attempt.dispatched_model = selected;
          if (args.background) {
            // Returning the dispatch promptly lets the parent continue its
            // independent work. A detached monitor owns only observation and
            // presentation; it never replays the child or invents a parent
            // response when the worker completes.
            receipt.status = 'running';
            receipt.activity = { schema_version: 1, phase: 'running', label: 'Worker started',
              child_session: child.id, selected_model: selected, last_meaningful_at: stamp(),
              assignment: args.task.slice(0, 240), requested_by: ctx.sessionID,
              dispatched_model: attempt.dispatched_model, observed_model: null,
              agentID: agent.id, agentName: agent.name, mode };
            await atomicJson(receiptFile, receipt);
            await ctx.metadata?.({ title: `@${agent.name} · Worker started`,
              metadata: { ...displayMetadata, freelancer_activity: receipt.activity, freelancer_status: 'running' } });
            const releaseDetached = async () => {
              if (receipt.status !== 'stop_unverified') await reservation.releaseDispatch();
              live.delete(child.id);
              const rootSessionID = execution.rootSessionID ?? ctx.sessionID;
              const reservations = activeByParent.get(rootSessionID);
              reservations?.delete(reservation);
              if (!reservations?.size) activeByParent.delete(rootSessionID);
            };
            void (async () => {
              const start = now();
              let activityKey = '', activityAt = -Infinity, meaningfulAt = stamp();
              try {
                while (now() - start < (limits.taskMs ?? preferences.childTimeoutSeconds * 1000)) {
                  // A parent cancellation owns the durable final state; this
                  // monitor stops observing instead of reporting its own end.
                  if (cancellations.has(receipt.task_id)) return;
                  const [messages, statuses] = await Promise.all([
                    call('session', 'messages', sessionArgs(child.id, ctx.directory)),
                    call('session', 'status', { query: query(ctx.directory) }),
                  ]);
                  if (messages.some(m => m.info?.role === 'assistant' && !m.info.summary && !m.info.agent))
                    throw fault('IdentityUnverified', 'Child message lacks runtime agent identity');
                  const turnMessages = messages.slice(Math.max(0, messages.findIndex(m => m.info?.id === attempt.user_message_id)));
                  const observation = observe(turnMessages, selected, agent.id);
                  receipt.worker_result = attachForkWarnings(workerResult(observation.text, { partial: !observation.complete || !!observation.error }), forkContext);
                  receipt.runtime_signals = runtimeSignals(turnMessages);
                  if (receipt.runtime_signals.needsDiagnosis)
                    throw fault('RepeatedFailure', 'Equivalent tool failures repeated three times. Stop and re-diagnose before continuing this worker.');
                  const activity = activityOf(turnMessages, now() - start);
                  const retrying = statuses?.[child.id]?.type === 'retry';
                  if (retrying) Object.assign(activity, { phase: 'waiting', label: 'Provider retry in progress' });
                  const nextKey = JSON.stringify([activity.phase, activity.label, activity.completed_tools]);
                  if (nextKey !== activityKey) meaningfulAt = stamp();
                  if (nextKey !== activityKey || now() - activityAt >= 5000) {
                    activityKey = nextKey; activityAt = now();
                    receipt.activity = { ...activity, child_session: child.id, selected_model: selected,
                      last_meaningful_at: meaningfulAt, assignment: args.task.slice(0, 240), requested_by: ctx.sessionID,
                      dispatched_model: attempt.dispatched_model, observed_model: observation.observed,
                       agentID: agent.id, agentName: agent.name, mode };
                    await atomicJson(receiptFile, receipt);
                    await ctx.metadata?.({ title: `@${agent.name} · ${activity.label}`,
                      metadata: { ...displayMetadata, freelancer_activity: receipt.activity, freelancer_status: 'running' } });
                  }
                  attempt.observed_model = observation.observed;
                  attempt.usage = observation.usage;
                  attempt.usage_source = observation.usage ? 'session_messages' : 'unavailable';
                  if (observation.error) throw Object.assign(new Error('Child failed'), observation.error);
                  if (!statuses || typeof statuses !== 'object' || Array.isArray(statuses))
                    throw fault('UnsupportedRuntime', 'Missing runtime session status');
                  if (retrying) {
                    await sleep(cfg.pollMs);
                    continue;
                  }
                  if (observation.complete && (!statuses?.[child.id] || statuses[child.id].type === 'idle')) {
                    await reservation.releaseDispatch();
                    attempt.status = 'completed'; attempt.completed_at = stamp(); attempt.elapsed_ms = now() - start;
                    receipt.status = 'completed';
                    await atomicJson(receiptFile, receipt);
                    await emit(receipt);
                    await ctx.metadata?.({ title: `@${agent.name} · Finished`,
                      metadata: { ...displayMetadata, freelancer_activity: receipt.activity, freelancer_status: 'completed' } });
                    return;
                  }
                  if (!observation.observed && now() - start > cfg.firstResponseMs)
                    throw fault('StartupTimeout', 'No observable child response within startup bound');
                  await sleep(cfg.pollMs);
                }
                throw fault('TaskTimeout', 'Bounded child execution time reached');
              } catch (e) {
                if (e.actual_model) attempt.observed_model = e.actual_model;
                attempt.status = 'failed'; attempt.failure = failureKind(e); attempt.error_type = e.name || 'Error';
                attempt.error = String(e?.data?.message || e?.message || '').slice(0, 500) || null;
                attempt.completed_at = stamp(); attempt.elapsed_ms = now() - Date.parse(attempt.started_at);
                attempt.abort_verified = await stopped(child.id, ctx.directory);
                receipt.status = attempt.abort_verified ? 'failed' : 'stop_unverified';
                receipt.failure_class = attempt.abort_verified ? 'recoverable_provider_issue' : 'uncertain_execution';
                receipt.failure_summary = { failure: attempt.failure, error_type: attempt.error_type, error: attempt.error,
                  abort_verified: attempt.abort_verified, child_session: child.id, selected_model: selected,
                  observed_model: attempt.observed_model || null };
                receipt.activity = { ...receipt.activity, schema_version: 1, phase: 'failed', label: `Stopped · ${attempt.failure}${attempt.error ? ` · ${attempt.error.slice(0, 120)}` : ''}`,
                  child_session: child.id, selected_model: selected, failure: attempt.failure, error_type: attempt.error_type, updated_at: stamp() };
                await atomicJson(receiptFile, receipt);
                await emit(receipt);
                await ctx.metadata?.({ title: `@${agent.name} · ${receipt.activity.label}`,
                  metadata: { ...displayMetadata, freelancer_activity: receipt.activity, freelancer_status: receipt.status } });
              } finally {
                await releaseDetached();
              }
            })();
            release = false;
            return { ...receipt, result: 'Worker started. Continue independent parent work now; inspect or continue this worker later if its result is needed.',
              note: 'Worker execution is still in progress; task correctness remains unverified.' };
          }
          const start = now();
          let activityKey = '', activityAt = -Infinity, meaningfulAt = stamp();
          while (now() - start < (limits.taskMs ?? preferences.childTimeoutSeconds * 1000)) {
            if (ctx.abort?.aborted) throw fault('AbortError', 'Parent cancelled');
            // Cancellation already wrote the durable final state and the
            // verified stop; this observer must not overwrite it.
            if (cancellations.has(receipt.task_id)) {
              const cancelled = await cancellations.get(receipt.task_id);
              return { ...cancelled, result: cancelled.status === 'cancelled'
                ? 'Cancellation verified; the durable receipt preserves partial output.'
                : 'Stop could not be verified; inspect the durable receipt before overlapping work.' };
            }
            // Independent reads: fetch concurrently so each tick costs one
            // round trip instead of two, with up to six children polling.
            const [messages, statuses] = await Promise.all([
              call('session', 'messages', sessionArgs(child.id, ctx.directory), ctx.abort),
              call('session', 'status', { query: query(ctx.directory) }, ctx.abort),
            ]);
            if (messages.some(m => m.info?.role === 'assistant' && !m.info.summary && !m.info.agent)) throw fault('IdentityUnverified', 'Child message lacks runtime agent identity');
            const turnMessages = messages.slice(Math.max(0, messages.findIndex(m => m.info?.id === attempt.user_message_id)));
            const observation = observe(turnMessages, selected, agent.id);
            receipt.worker_result = attachForkWarnings(workerResult(observation.text, { partial: !observation.complete || !!observation.error }), forkContext);
            receipt.runtime_signals = runtimeSignals(turnMessages);
            if (receipt.runtime_signals.needsDiagnosis) throw fault('RepeatedFailure', 'Equivalent tool failures repeated three times. Stop and re-diagnose before continuing this worker.');
            const activity = activityOf(turnMessages, now() - start);
            const retrying = statuses?.[child.id]?.type === 'retry';
            if (retrying) Object.assign(activity, { phase: 'waiting', label: 'Provider retry in progress' });
            const nextKey = JSON.stringify([activity.phase, activity.label, activity.completed_tools]);
            if (nextKey !== activityKey) meaningfulAt = stamp();
            if (nextKey !== activityKey || now() - activityAt >= 5000) {
              activityKey = nextKey; activityAt = now();
              receipt.activity = { ...activity, child_session: child.id, selected_model: selected,
                last_meaningful_at: meaningfulAt, assignment: args.task.slice(0, 240), requested_by: ctx.sessionID,
                dispatched_model: attempt.dispatched_model, observed_model: observation.observed, agentID: agent.id, agentName: agent.name, mode };
              await atomicJson(receiptFile, receipt);
              // OpenCode emits a native part update; the presenter updates the
              // same clickable card. Status is never a second agent transcript.
              await ctx.metadata?.({ title: `@${agent.name} · ${activity.label}`,
                metadata: { ...displayMetadata, freelancer_activity: receipt.activity } });
            }
            attempt.observed_model = observation.observed;
            attempt.usage = observation.usage;
            attempt.usage_source = observation.usage ? 'session_messages' : 'unavailable';
            if (observation.error) throw Object.assign(new Error('Child failed'), observation.error);
            if (!statuses || typeof statuses !== 'object' || Array.isArray(statuses)) throw fault('UnsupportedRuntime', 'Missing runtime session status');
            if (retrying) {
              await sleep(cfg.pollMs);
              continue;
            }
            if (observation.complete && (!statuses?.[child.id] || statuses[child.id].type === 'idle')) {
              attempt.status = 'completed'; attempt.completed_at = stamp(); attempt.elapsed_ms = now() - start;
              receipt.status = 'completed';
              await atomicJson(receiptFile, receipt);
              await emit(receipt);
              return { ...receipt, result: receipt.worker_result.summary, note: 'Execution complete; task correctness still requires validation.' };
            }
            if (!observation.observed && now() - start > cfg.firstResponseMs) throw fault('StartupTimeout', 'No observable child response within startup bound');
            await sleep(cfg.pollMs);
          }
          throw fault('TaskTimeout', 'Bounded child execution time reached');
        } catch (e) {
          if (e.actual_model) attempt.observed_model = e.actual_model;
          attempt.status = 'failed'; attempt.failure = failureKind(e); attempt.error_type = e.name || 'Error';
          attempt.error = String(e?.data?.message || e?.message || '').slice(0, 500) || null;
          attempt.completed_at = stamp(); attempt.elapsed_ms = now() - Date.parse(attempt.started_at);
          receipt.activity = { ...receipt.activity, schema_version: 1, phase: 'failed', label: `Stopped · ${attempt.failure}${attempt.error ? ` · ${attempt.error.slice(0, 120)}` : ''}`, child_session: child?.id, selected_model: selected, failure: attempt.failure, error_type: attempt.error_type, updated_at: stamp() };
          if (child?.id) attempt.abort_verified = await stopped(child.id, ctx.directory);
          else attempt.abort_verified = true; // No prompt was sent without a known child ID.
          // A failed/ambiguous submission is not safe to replay as another writer.
          if (!attempt.abort_verified || (!acknowledged && submitted)) release = false;
          receipt.status = release ? 'failed' : 'stop_unverified';
          receipt.failure_summary = { failure: attempt.failure, error_type: attempt.error_type, error: attempt.error || null,
            abort_verified: attempt.abort_verified, child_session: child?.id || null,
            selected_model: selected, observed_model: attempt.observed_model || null };
          receipt.activity.failure = attempt.failure;
          receipt.activity.error_type = attempt.error_type;
          receipt.activity.abort_verified = attempt.abort_verified;
          await atomicJson(receiptFile, receipt);
          await emit(receipt);
          // Return to the host; do not silently substitute a different model.
          break;
        } finally {
          if (release) await reservation?.releaseDispatch();
          if (child?.id && release) live.delete(child.id);
          if (reservation && release) {
            const rootSessionID = execution.rootSessionID ?? ctx.sessionID;
            const reservations = activeByParent.get(rootSessionID);
            reservations?.delete(reservation);
            if (!reservations?.size) activeByParent.delete(rootSessionID);
          }
        }
      }
      if (receipt.attempts.some(a => a.status === 'failed')) {
        if (legacyContract) return propose(null, release);
        receipt.failure_class = release ? 'recoverable_provider_issue' : 'uncertain_execution';
        receipt.result = 'Worker stopped before verified completion. Inspect the partial result and failure summary. Continue the same worker only after diagnosing the cause; do not blindly repeat or replace overlapping work.';
        if (receipt.worker_result) receipt.worker_result.resultSource = 'partial';
        await atomicJson(receiptFile, receipt);
        return receipt;
      }
      await atomicJson(receiptFile, receipt);
      return { ...receipt, result: receipt.attempts.length === 0
        ? 'NO CHILD RAN. No independent review or validated outcome exists. Report the status and routing diagnostics. Do not record success or present parent self-review as independent. Keep the parent model unchanged; do not retry the same request or relax free-only/quality requirements silently.'
        : 'No completed child result. Inspect the listed sessions and partial results. Do not record success or claim independent verification. Keep the parent model unchanged.' };
    }
  }
  return {
    async execute(args, ctx) {
      // A small public API; operational fields remain internal for diagnostics.
      const { agent, model, inspectionOnly, ...rest } = args;
      args = { ...rest, ...(agent ? { agentID: agent } : {}), ...(model ? { selectedModel: model } : {}), ...(inspectionOnly ? { needsWrites: false } : {}), ...(rest.independentReview ? { needsModelDiversity: true } : {}) };
      // Cancellation is a worker action, not an inspection read.
      const cancelling = args.cancel !== undefined;
      const forking = args.fork !== undefined;
      if (forking && args.fork !== true)
        throw fault('InvalidAssignment', 'fork:true starts one fresh child from an owned worker. Omit fork to continue, steer or queue that worker.');
      if (forking && (!args.worker || !args.task?.trim()))
        throw fault(!args.task?.trim() ? 'InvalidTask' : 'InvalidAssignment', 'A fresh fork requires worker and a new bounded task.');
      if (forking && (args.cancel !== undefined || args.delivery !== undefined || args.workers === true))
        throw fault('InvalidAssignment', 'fork is exclusive with cancel, worker delivery, and listing. It starts a separate fresh child.');
      if (cancelling && args.cancel !== true)
        throw fault('InvalidAssignment', 'cancel:true stops one worker. Omit cancel to inspect, continue, steer or queue.');
      if (cancelling && args.workers) throw fault('InvalidAssignment', 'Cancellation accepts only worker and cancel.');
      if (args.workers === true || args.worker && !args.task && !cancelling) {
        if (args.task || args.agentID || args.selectedModel || args.inspectionOnly || args.independentReview)
          throw fault('InvalidAssignment', 'Worker reads cannot include an assignment.');
        return inspectWorkers(args, ctx);
      }
      const resolvedParent = await parentContext(ctx);
      const coalesceArgs = {
        ...decisionAssignment(args),
        ...(args.selectedModel ? { selectedModel: args.selectedModel } : {}),
        ...(args.worker ? { worker: args.worker } : {}),
        ...(forking ? { fork: true } : {}),
        ...(cancelling ? { cancel: true } : {}),
      };
      const orderedArgs = Object.fromEntries(Object.entries(coalesceArgs).sort(([a], [b]) => a.localeCompare(b)));
      // Equivalent retries/resumes for the same bounded assignment coalesce even
      // when one carries decisionId or a different audit rationale. Distinct
      // selected models remain distinct calls.
      const key = hash(JSON.stringify([ctx.sessionID, resolvedParent.execution.id, orderedArgs]));
      if (inFlight.has(key)) return inFlight.get(key);
      if (!cancelling && !forking && args.worker && !args.delivery && continuing.has(args.worker)) throw fault('WorkerBusy', 'Another follow-up is already using this worker. Wait for its result.');
      if (!cancelling && !forking && args.worker && !args.delivery) continuing.add(args.worker);
      const promise = run(args, ctx, resolvedParent);
      inFlight.set(key, promise);
      try { return await promise; } finally { inFlight.delete(key); if (!cancelling && !forking && args.worker && !args.delivery) continuing.delete(args.worker); }
    },
    // Guard before the model request, plus independent message observation after it.
    async checkModel(input) {
      const entry = await lookup(input.sessionID, input.directory || directory);
      if (!entry) return;
      const id = `${input.model?.providerID}/${input.model?.id}`;
      if (id !== entry.selected) throw fault('BindingFailure', 'Model binding changed before inference');
    },
    async checkTool(input, output) {
      const d = input.directory || directory;
      const session = await call('session', 'get', sessionArgs(input.sessionID, d));
      const rows = await call('session', 'messages', sessionArgs(input.sessionID, d));
      const message = rows.findLast(m => input.callID && m.parts?.some(p => p.callID === input.callID)) ??
        rows.findLast(m => m.info?.role === 'assistant');
      const execution = await executionContext(toolkitRoot, d, session, message);
      if (execution?.goalID) {
        const goals = await readJson(path.join(toolkitRoot, '.state/webpage/goals.json'));
        const goal = goals?.records?.[execution.goalID];
        if (!goal || goal.stopRequested || goal.archived) throw fault('PermissionError', 'This goal was stopped or archived. No new tool work may start until the user resumes it.');
      }
      const inherited = await lookup(input.sessionID, d);
       if (input.tool === 'task') throw fault('PermissionError', 'Use delegate({agent, task}) with a named agent and bounded task; native task is not a second execution path.');
      if (input.tool === 'delegate') {
        if (!execution) throw fault('PermissionError', 'A current named-agent execution contract is required.');
        if (execution.policyVersion < 5 && session?.parentID) throw fault('PermissionError', 'Nested delegation is disabled for this already-captured legacy request.');
        if (execution.policyVersion < 5 && execution.workflow?.id === 'sync') throw fault('PermissionError', 'Legacy Git/Sync requests use the managed Git tool directly.');
        return;
      }
      if (!execution && !inherited) throw fault('PermissionError', 'Execution contract unavailable. Start a new request in Freelancer; historical conversations remain readable.');
      if (!(execution?.readOnly || inherited?.readOnly)) return;
       if (isInspectAllowed(input.tool, output.args)) return;
      throw fault('PermissionError', 'Read-only assignment cannot execute this tool. Use permitted inspection tools and return required source writes to the main conversation.');
    },
  };
}
