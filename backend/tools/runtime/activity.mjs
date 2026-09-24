// Public status fields only: never stream reasoning, shell arguments or tool output.
import path from 'node:path';
export function activityOf(messages, elapsedMs = 0) {
  const rows = (messages || []).filter(m => m.info?.role === 'assistant' && !m.info.summary);
  const parts = rows.flatMap(m => m.parts || []);
  const tools = [...new Map(parts.filter(p => p.type === 'tool').map(p => [p.id || p.callID, p])).values()];
  const active = tools.filter(p => ['pending', 'running'].includes(p.state?.status)).at(-1);
  const lastTool = active || tools.at(-1);
  const last = rows.at(-1);
  const complete = Boolean(last?.info.time?.completed && last.info.finish && last.info.finish !== 'tool-calls' && !active);
  const phase = last?.info.error ? 'failed' : complete ? 'completed' : active?.tool === 'question' ? 'waiting_input' : active ? 'tool' : 'working';
  const tool = lastTool?.tool || null;
  const file = lastTool?.state?.input?.filePath;
  const subject = typeof file === 'string' ? path.win32.basename(file.replaceAll('/', '\\')).slice(0, 70) : null;
  const completedTools = tools.filter(p => p.state?.status === 'completed').length;
  const label = phase === 'completed' ? `Finished · ${completedTools} tool calls` : phase === 'failed' ? 'Failed' :
    phase === 'waiting_input' ? 'Waiting for input' : active ? `${tool}${subject ? ` · ${subject}` : ''}` : lastTool ? `Working · ${completedTools} tool calls completed` : 'Working · waiting for first tool or result';
  return { schema_version: 1, phase, label, tool, subject, completed_tools: completedTools,
    elapsed_ms: Math.max(0, elapsedMs), updated_at: new Date().toISOString() };
}
