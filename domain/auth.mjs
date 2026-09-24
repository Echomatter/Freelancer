export function promptVisible(prompt, values) {
  if (!prompt.when) return true;
  return prompt.when.op === "eq"
    ? values[prompt.when.key] === prompt.when.value
    : values[prompt.when.key] !== prompt.when.value;
}
export function initialInputs(method) {
  return Object.fromEntries(
    (method.prompts ?? [])
      .filter((p) => p.type === "select")
      .map((p) => [p.key, p.options[0]?.value ?? ""]),
  );
}
export function connectionMethods(methods) {
  // Go uses a native API-key credential despite being a subscription. Unlike
  // OAuth plugins it need not register a /provider/auth method.
  return {
    openai: methods.openai ?? [],
    "github-copilot": methods["github-copilot"] ?? [],
    "opencode-go": methods["opencode-go"]?.length
      ? methods["opencode-go"]
      : [{ type: "api", label: "OpenCode Go key" }],
  };
}
export function authInputs(method, values = {}) {
  const inputs = {};
  for (const prompt of method.prompts ?? []) {
    if (!promptVisible(prompt, values)) continue;
    const value = values[prompt.key];
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 2000 ||
      (prompt.type === "select" &&
        !prompt.options.some((o) => o.value === value))
    )
      throw Error(`Complete: ${prompt.message}`);
    inputs[prompt.key] = value.trim();
  }
  return inputs;
}
