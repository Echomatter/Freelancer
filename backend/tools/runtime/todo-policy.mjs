// Default todos on for every native work mode/helper without overriding an
// explicit user action. This config hook changes no source-writing permissions.
export function enableSessionTodos(config) {
  config.agent ??= {};
  const names = new Set(Object.keys(config.agent).filter(name => config.agent[name]?.disable !== true));
  for (const name of names) {
    const agent = config.agent[name] ??= {};
    // An explicit whole-agent action is also a user decision.
    if (typeof agent.permission === 'string') continue;
    agent.permission ??= {};
    if (agent.permission.todowrite !== undefined) continue;
    // Preserve explicit global todo policy too; agent defaults otherwise win
    // over OpenCode's built-in Explore wildcard deny.
    const global = config.permission;
    agent.permission.todowrite = agent.permission['*'] ??
      (typeof global === 'string' ? global : global?.todowrite ?? global?.['*'] ?? 'allow');
  }
}
