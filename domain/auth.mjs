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
export function connectionMethods(methods, nativeProviders = []) {
  // Go uses a native API-key credential despite being a subscription. Unlike
  // OAuth plugins it need not register a /provider/auth method.
  const result = Object.fromEntries(Object.entries(methods ?? {})
    .filter(([id, rows]) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) && Array.isArray(rows)));
  // /provider/auth lists plugin hooks. Providers without a hook use OpenCode's
  // generic PUT /auth/{providerID} API-key contract. Explicit hooks stay intact.
  for (const provider of nativeProviders) {
    const id = provider?.id;
    if (typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)
      && !Object.hasOwn(methods ?? {}, id))
      result[id] = [{ type: "api", label: "API key" }];
  }
  if (!Object.hasOwn(methods ?? {}, "opencode-go"))
    result["opencode-go"] = [{ type: "api", label: "OpenCode Go key" }];
  return result;
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
