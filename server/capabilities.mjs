import { readFile } from 'node:fs/promises';
import path from 'node:path';

const nativeTools = ['bash', 'read', 'glob', 'grep', 'edit', 'write', 'apply_patch',
  'webfetch', 'websearch', 'skill', 'todowrite', 'question'];
const freelancerTools = ['delegate', 'git_project', 'content_index', 'goal_checkpoint'];
const text = value => typeof value === 'string' ? value.slice(0, 300) : null;
const names = value => Array.isArray(value) ? value.filter(v => typeof v === 'string') : [];
const actions = new Set(['allow', 'ask', 'deny']);

// Native status/config payloads can contain credentials, commands and prompts.
// Project diagnostics project only allowlisted state; never forward raw bodies
// or exception messages (which may contain a server's authentication details).
function permissionFor(permission, tool) {
  if (actions.has(permission)) return permission;
  if (Array.isArray(permission)) {
    const relevant = permission.filter(row => row && (row.permission === tool || row.permission === '*'));
    if (relevant.some(row => row.pattern !== '*' && actions.has(row.action))) return 'conditional';
    const rule = relevant.findLast(row => row.pattern === '*');
    return actions.has(rule?.action) ? rule.action : 'unknown';
  }
  const value = permission?.[tool] ?? permission?.['*'];
  if (actions.has(value)) return value;
  return value && typeof value === 'object' ? 'conditional' : 'unknown';
}

export function createCapabilities({ host, backendRoot }) {
  return {
    async read({ directory, projectID, sessionID = null, agent = 'engineer', model = null, boundaries = {}, instructionContext = {} }) {
      async function probe(route) {
        try {
          const value = await host.request(route, { directory, signal: AbortSignal.timeout(15000) });
          const routePath = route.split('?')[0];
          const list = ['/experimental/tool/ids', '/experimental/tool', '/agent', '/skill', '/command'].includes(routePath);
          if (list ? !Array.isArray(value) : !value || typeof value !== 'object' || Array.isArray(value))
            return { state: 'unavailable', reason: 'Native endpoint returned an unsupported response shape.' };
          return { state: 'observed', value };
        } catch (error) {
          return { state: 'unavailable', reason: error?.status === 404 ? 'Native endpoint is unsupported.' : 'Native inspection failed or timed out.' };
        }
      }
      const slash = typeof model === 'string' ? model.indexOf('/') : -1;
      const modelRoute = slash > 0 && slash < model.length - 1
        ? `/experimental/tool?provider=${encodeURIComponent(model.slice(0, slash))}&model=${encodeURIComponent(model.slice(slash + 1))}` : null;
      const [ids, exposed, agents, config, skills, mcp, commands] = await Promise.all([
        probe('/experimental/tool/ids'), modelRoute ? probe(modelRoute) : { state: 'not-run', reason: 'Choose a model to inspect its tool exposure.' },
        probe('/agent'), probe('/config'), probe('/skill'), probe('/mcp'), probe('/command'),
      ]);
      const registered = new Set(names(ids.value));
      const modelTools = new Set(Array.isArray(exposed.value) ? exposed.value.map(row => row?.id).filter(v => typeof v === 'string') : []);
      const profile = Array.isArray(agents.value) ? agents.value.find(row => row?.name === agent) : null;
      const effectiveConfig = config.value && typeof config.value === 'object' ? config.value : {};
      const diagnostics = [];
      let manifest = {};
      try { manifest = JSON.parse(await readFile(path.join(backendRoot, 'opencode/catalog.json'), 'utf8')); }
      catch { diagnostics.push({ kind: 'manifest-unavailable', name: 'Freelancer catalog' }); }
      const tools = [...new Set([...nativeTools, ...freelancerTools, ...registered])].sort().map(id => {
        const permission = permissionFor(profile?.permission, id);
        const nativePermission = permission === 'unknown' ? permissionFor(effectiveConfig.permission, id) : permission;
        const disabled = (profile?.tools?.[id] ?? effectiveConfig.tools?.[id]) === false;
        const discovered = ids.state === 'observed' ? registered.has(id) : null;
        const exposure = exposed.state === 'observed' ? modelTools.has(id) && !disabled : null;
        const sourceWriteBlocked = ['edit', 'write', 'apply_patch'].includes(id)
          && (boundaries.inspectionOnly === true || boundaries.gitInspectOnly === true);
        const applicationAccess = id === 'task' || sourceWriteBlocked ? 'blocked'
          : ['delegate', 'git_project', 'lsp', 'content_index', 'bash'].includes(id) ? 'operation-dependent' : 'shared';
        const reason = id === 'task' ? 'Use delegate({agent, task}); native task is not a second worker dispatch path.'
          : sourceWriteBlocked ? 'Source writes are disabled by the captured inspection assignment or saved project agreement.'
          : disabled ? 'Explicit native tool configuration disables this tool.'
          : nativePermission === 'deny' ? 'Native permission denies this tool.'
          : discovered === false ? (id === 'websearch' ? 'Native websearch is not registered for this provider/configuration.'
            : 'Tool is not registered in this runtime.')
          : exposure === false ? (id === 'websearch' && discovered === false
            ? 'Native websearch requires an eligible OpenCode/OpenCode Go provider or explicit OPENCODE_ENABLE_EXA/OPENCODE_ENABLE_PARALLEL opt-in. Native permissions still apply.'
            : 'Tool is not exposed to the selected model.')
          : discovered === null ? ids.reason : exposure === null ? exposed.reason : null;
        return { id, origin: freelancerTools.includes(id) ? 'Freelancer plugin' : nativeTools.includes(id) ? 'OpenCode native' : 'OpenCode custom/plugin/MCP',
          discovered, configured: !disabled, modelExposure: exposure, nativePermission, applicationAccess,
          dependency: 'unverified', unavailableReason: reason,
          evidence: 'Native inventory/configuration; successful use not verified.' };
      });
      const nativeSkills = Array.isArray(skills.value) ? skills.value : [];
      const seen = new Set();
      const skillRows = nativeSkills.filter(row => typeof row?.name === 'string').map(row => {
        if (seen.has(row.name)) diagnostics.push({ kind: 'duplicate-skill', name: text(row.name) });
        seen.add(row.name);
        return { name: text(row.name), origin: text(row.location ?? row.path) ?? 'Native skill discovery',
          discovered: true, dependency: 'unverified', unavailableReason: 'Dependency requirements have not been verified by native discovery.' };
      });
      for (const name of names(manifest.skills)) {
        let present = true;
        try { await readFile(path.join(backendRoot, 'skills', name, 'SKILL.md'), 'utf8'); } catch { present = false; }
        if (!present) diagnostics.push({ kind: 'stale-skill-manifest', name });
        if (!seen.has(name)) skillRows.push({ name, origin: 'Freelancer shared skill', discovered: false,
          dependency: present ? 'unverified' : 'missing', unavailableReason: !present ? 'Manifest skill file is missing.'
            : skills.state === 'observed' ? 'Skill was not returned by native discovery.' : skills.reason });
      }
      for (const name of names(manifest.tools)) if (ids.state === 'observed' && !registered.has(name)) diagnostics.push({ kind: 'stale-tool-manifest', name });
      const mcpConfig = effectiveConfig.mcp && typeof effectiveConfig.mcp === 'object' ? effectiveConfig.mcp : {};
      const mcpStatus = mcp.value && typeof mcp.value === 'object' && !Array.isArray(mcp.value) ? mcp.value : {};
      const mcpRows = [...new Set([...Object.keys(mcpConfig), ...Object.keys(mcpStatus)])].sort().map(name => {
        const status = ['connected', 'disabled', 'failed', 'needs_auth', 'needs_client_registration'].includes(mcpStatus[name]?.status)
          ? mcpStatus[name].status : mcpConfig[name]?.enabled === false ? 'disabled' : 'unverified';
        return { name, origin: 'OpenCode native MCP', configured: Object.hasOwn(mcpConfig, name), status,
          tools: tools.filter(row => row.id.startsWith(`${name}_`)).map(row => row.id),
          toolAssociation: 'Native tool-name prefix; unverified association.',
          unavailableReason: status === 'connected' ? null : status === 'disabled' ? 'Disabled by native configuration.'
            : status === 'needs_auth' ? 'Native MCP authentication is required.'
            : status === 'needs_client_registration' ? 'Native MCP client registration is required.'
            : status === 'failed' ? 'Native MCP connection failed; inspect the native integration.' : mcp.reason ?? 'Connection has not been observed.' };
      });
      const referenceRows = effectiveConfig.references && typeof effectiveConfig.references === 'object'
        ? Object.entries(effectiveConfig.references).map(([name, row]) => ({ name, origin: 'OpenCode native reference',
          configured: true, advertised: typeof row?.description === 'string', dependency: 'unverified' })) : [];
      return { version: 1, observedAt: Date.now(), context: { projectID, sessionID, agent, model },
        boundaries: { inspectionOnly: boundaries.inspectionOnly ?? null, gitInspectOnly: boundaries.gitInspectOnly ?? null,
          fileAccessScope: ['project', 'projects', 'computer'].includes(boundaries.fileAccessScope) ? boundaries.fileAccessScope : 'computer' },
        evidence: 'Read-only native inventory; registration is not proof of successful use.',
        tools, skills: skillRows, mcp: mcpRows,
        // Additive, stable summary for clients that need websearch status
        // without depending on the ordering or full shape of `tools`.
        toolStatus: { websearch: (() => {
          const row = tools.find(tool => tool.id === 'websearch');
          return { discovered: row.discovered, modelExposure: row.modelExposure,
            nativePermission: row.nativePermission, unavailableReason: row.unavailableReason };
        })() },
        references: referenceRows,
        commands: Array.isArray(commands.value) ? commands.value.filter(row => typeof row?.name === 'string').map(row => ({ name: text(row.name), origin: 'OpenCode native command', invocation: 'optional' })) : [],
        experimental: { codeMode: { state: 'deferred', reason: 'No connected-tool-volume need has been demonstrated.' } },
        instructions: {
          requestID: instructionContext.requestID ?? null,
          composition: instructionContext.requestID ? 'Captured Freelancer request plus current native discovery.' : 'Current configuration; no captured request resolved.',
          sources: [
            { id: 'provider', origin: 'OpenCode provider prompt', state: 'native-internal', note: 'Full provider prompt is not returned by the native inventory API.' },
            { id: 'project-global', origin: 'OpenCode instruction discovery (AGENTS.md and native configuration)', state: 'native-managed', note: 'Project/global resolution is owned by OpenCode.' },
            { id: 'workstyle', origin: 'backend/global/WORKSTYLE.md', state: names(effectiveConfig.instructions).some(value => /(?:^|[/\\])WORKSTYLE\.md$/i.test(value)) ? 'configured' : 'unverified', note: 'Native instructions configuration; changes require runtime reload.' },
            { id: 'global', origin: 'backend/opencode/global-instructions.md', state: names(effectiveConfig.instructions).some(value => /(?:^|[/\\])global-instructions\.md$/i.test(value)) ? 'configured' : 'unverified', note: 'Shared Freelancer guidance loaded by OpenCode.' },
            { id: 'execution', origin: 'server/execution.mjs', state: instructionContext.requestID ? 'captured' : 'future-request', note: `Execution policy ${instructionContext.policyVersion ?? 'not resolved'}.` },
            { id: 'persona', origin: 'domain/workspace.mjs + saved named-agent catalog', state: instructionContext.requestID ? 'captured' : 'current-catalog', note: instructionContext.agentName ?? agent },
            { id: 'strategy', origin: 'domain/delegation-policy.mjs + shared/strategy.mjs', state: instructionContext.requestID ? 'captured-and-native-guidance' : 'current-preferences', note: 'Routing preferences guide assignments; they do not grant permissions.' },
            { id: 'git', origin: 'domain/git-project.mjs + saved project agreement', state: 'durable-agreement', note: 'Managed Git authority is resolved separately from persona.' },
            { id: 'skills', origin: 'OpenCode native skill loader', state: 'on-demand', note: `Observed loaded skills: ${(instructionContext.loadedSkills ?? []).join(', ') || 'none in the inspected transcript'}.` },
            { id: 'mcp', origin: 'Native MCP server instructions', state: 'native-managed', note: 'Connection status is visible; server instruction bodies are not copied.' },
            { id: 'worker-result', origin: 'backend/tools/runtime/worker-result.mjs', state: instructionContext.worker ? 'worker-contract' : 'on-delegation', note: 'Completion remains distinct from verification.' },
            { id: 'sender', origin: 'server/sender.mjs + domain/sender.mjs', state: 'delivery-specific', note: 'Queued and steered text is attached to native delivery; not an editable master prompt.' },
            { id: 'orientation', origin: 'server/chatgpt-import.mjs', state: instructionContext.orienting ? 'captured' : 'not-observed', note: 'Imported-history orientation is supplied when needed.' },
            { id: 'configuration', origin: 'server/model-ratings.mjs + domain/model-ratings.mjs', state: 'configuration-task-only', note: 'Background configuration prompts do not replace ordinary chat instructions.' },
          ],
        },
        probes: Object.fromEntries(Object.entries({ ids, exposed, agents, config, skills, mcp, commands }).map(([key, row]) => [key, { state: row.state, reason: row.reason ?? null }])),
        diagnostics,
      };
    },
  };
}
