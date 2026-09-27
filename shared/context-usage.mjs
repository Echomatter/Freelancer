const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

// Matches OpenCode's overflow accounting: provider total when nonzero,
// otherwise input + output + cached input. Reasoning is not added again.
export function contextTokens(tokens) {
  if (!tokens) return null;
  const sum = [tokens.input, tokens.output, tokens.cache?.read, tokens.cache?.write].reduce((total, value) => total + (number(value) ?? 0), 0);
  return number(tokens.total) || sum || null;
}

export function contextUsage(messages, limitFor) {
  const message = messages.findLast(info => info?.role === 'assistant' && contextTokens(info.tokens) !== null);
  const used = contextTokens(message?.tokens), limit = message ? number(limitFor(message)) || null : null;
  return { used, limit, ratio: used !== null && limit ? Math.min(1, used / limit) : null };
}
