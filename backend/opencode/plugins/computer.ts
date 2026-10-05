import { tool, type Plugin } from '@opencode-ai/plugin';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const Computer: Plugin = async ({ client, directory }) => {
  const root = process.env.FREELANCER_RUNTIME_ROOT;
  if (!root) throw Error('Start this plugin through Freelancer.');
  const [{ createComputerProviderManager }, { createComputerUse, COMPUTER_OPERATIONS, COMPUTER_TARGETS, COMPUTER_ACTIONS }] = await Promise.all([
    import(pathToFileURL(path.join(root, 'tools/runtime/computer-provider.mjs')).href),
    import(pathToFileURL(path.join(root, 'tools/runtime/computer-use.mjs')).href),
  ]);
  const manager = createComputerProviderManager({ client, directory });
  const computer = createComputerUse({
    listProviders: manager.listProviders,
    authorizeProvider: async (provider: { toolName: string; targetID?: string; targetType: string; operation: string }, context: any) => {
      await context.ask({ permission: provider.toolName, patterns: [provider.targetID ?? '*'], always: [],
        metadata: { description: 'Authorize the selected computer provider operation', targetType: provider.targetType, operation: provider.operation } });
    },
    captureImage: async (image: { mimeType: string; data: string }, context: { sessionID: string }) => {
      const bytes = Buffer.from(image.data, 'base64');
      if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw Error('Computer screenshot was empty or exceeded the 8 MB capture limit.');
      const mime = /^image\/(?:png|jpeg|webp)$/.test(image.mimeType) ? image.mimeType : 'image/png';
      const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
      const folder = path.join(root, '.state', 'computer-use', 'captures');
      await mkdir(folder, { recursive: true });
      const filename = `${randomUUID()}.${extension}`;
      const file = path.join(folder, filename);
      await writeFile(file, bytes, { flag: 'wx' });
      return { filename, mime, url: pathToFileURL(file).href };
    },
  });
  return {
    tool: {
      computer: tool({
        description: 'Use the shared browser and desktop capability. Start with status or observe; pass the returned computer sessionID for later operations. The provider is selected from currently configured native MCP services by observed capability. execute accepts a normalized action and parametersJson; browser javascript code runs in the observed page only, never in the host shell. A completed action is not proof of the intended result: observe or verify the resulting state. Native permission decisions still apply, including the computer permission for all observations and actions.',
        args: {
          operation: tool.schema.enum(COMPUTER_OPERATIONS).describe('status inspects configured provider availability; observe reads the current browser/window state and starts or refreshes a session. CUA inventory reads do not bind an arbitrary window: observe the selected window/tab again with its returned IDs before acting. execute performs one action; capture takes a screenshot; wait waits briefly then observes; end_session closes this conversation’s provider session.'),
          targetType: tool.schema.enum(COMPUTER_TARGETS).optional().describe('Required for observe, execute, capture and wait. Select browser or desktop; this does not select a provider.'),
          sessionID: tool.schema.string().max(128).optional().describe('Exact computer sessionID returned by observe. Required for execute, capture, wait and end_session. It is scoped to the current OpenCode conversation.'),
          targetID: tool.schema.string().max(1000).optional().describe('Observed tab/window identifier when one is available. Refresh with observe before changing target identity.'),
          processID: tool.schema.number().int().positive().optional().describe('Observed desktop process ID when required by the current target.'),
          detail: tool.schema.enum(['summary', 'controls', 'visual']).optional().describe('Observation detail. Cua summary returns bounded UIA without a screenshot; controls expands to 500 elements/depth 18; visual returns a screenshot without a UIA tree. Use capture when a screenshot is needed after structured inspection.'),
          action: tool.schema.enum(COMPUTER_ACTIONS).optional().describe('execute only: navigate, click, double_click, right_click, drag, hover, type, fill, press, scroll, launch, focus, close, select, upload, javascript or verify. Actions depend on observed provider support.'),
          url: tool.schema.string().max(4000).optional().describe('Navigation URL for navigate.'),
          code: tool.schema.string().max(100_000).optional().describe('javascript only: JavaScript evaluated in the observed browser page. It is not host-side code.'),
          parametersJson: tool.schema.string().max(32_000).optional().describe('Normalized action fields as JSON: selector or elementToken, text, key, direction, amount, deltaX/deltaY, x/y, toX/toY, destinationRef, expect, filePath/files, app/launchPath, tabID, browserTargetID, profile, strategy, allowLaunch, query, maxElements, maxDepth, durationMs. CUA browser actions need elementToken refs and the browserTargetID/tabID returned by observe. Provider-specific wire arguments are not accepted.'),
          timeoutMs: tool.schema.number().int().min(1).max(30_000).optional().describe('Bounded wait/operation timeout in milliseconds; default 15000.'),
        },
        async execute(args, context) {
          if (args.operation !== 'status') {
            await context.ask({ permission: 'computer', patterns: [args.operation, args.targetType ?? '*'], always: [],
              metadata: { description: 'Use the shared computer capability', operation: args.operation, targetType: args.targetType ?? 'unknown' } });
          }
          try {
            const result = await computer.execute(args, { sessionID: context.sessionID, abort: context.abort });
            const attachments = result.attachments ?? [];
            const { attachments: _ignored, ...output } = result;
            return { title: `Computer · ${result.operation ?? result.status}`, output: JSON.stringify(output, null, 2),
              ...(attachments.length ? { attachments } : {}), metadata: { freelancer_computer: { status: result.status, operation: result.operation ?? args.operation,
                targetType: result.targetType ?? args.targetType ?? null, provider: result.providerKind ?? null,
                verification: result.verification ?? 'not_verified',
                evidence: result.evidence ?? null,
                providerEffect: typeof result.result?.effect === 'string' ? result.result.effect : null,
                providerRoute: typeof result.result?.route === 'string' ? result.result.route : null } } };
          } catch (error: any) {
            const code = typeof error?.code === 'string' ? error.code
              : /permission|authorization|consent/i.test(error?.message ?? '') ? 'permission_denied' : 'operation_failed';
            return { title: code === 'provider_unavailable' || code === 'capability_unavailable' ? 'Computer capability unavailable' : 'Computer operation failed',
              output: JSON.stringify({ status: 'failed', operation: args.operation, failure_class: code,
                reason: error?.message ?? 'Computer operation could not be established.',
                action: code === 'permission_required' ? 'Pause and ask the user to accept the provider authorization prompt; do not retry until the user confirms.'
                  : code === 'stale_target' || code === 'stale_session' ? 'Observe the current target and use its returned session before retrying.' : 'Inspect provider status and the current target before retrying; no task success is claimed.' }),
              metadata: { freelancer_computer: { status: 'failed', operation: args.operation, failureClass: code } } };
          }
        },
      }),
    },
  };
};

export default Computer;
