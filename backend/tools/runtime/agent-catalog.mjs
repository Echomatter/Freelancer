import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  workspaceCatalog,
  normalizeAgent,
  normalizeWorkflow,
} from "../../../domain/workspace.mjs";

export const retiredAgents = Object.freeze([
  "build",
  "plan",
  "explore",
  "general",
  "worker",
  "architect",
  "review",
]);

// One authored catalog. Native profiles are transport adapters, not a second
// set of personas. The exact agent + workflow prompt is supplied per request.
export function checkedCatalog(settings = {}) {
  const catalog = workspaceCatalog(settings);
  const ids = new Set();
  for (const agent of catalog.agents) {
    normalizeAgent(agent, agent.id);
    if (ids.has(agent.id) || retiredAgents.includes(agent.id))
      throw Error(
        "Invalid or duplicate agent definition. Existing settings were preserved.",
      );
    ids.add(agent.id);
  }
  for (const workflow of catalog.workflows)
    normalizeWorkflow(workflow, workflow.id, catalog.agents);
  return structuredClone(catalog);
}
export async function readAgentCatalog(root) {
  let settings;
  try {
    settings = JSON.parse(
      await readFile(path.join(root, ".state/webpage/settings.json"), "utf8"),
    );
    if (settings.version !== 1 || !Array.isArray(settings.projects))
      throw Error("Unsupported agent settings");
  } catch (error) {
    if (error.code !== "ENOENT")
      throw Error(
        "Agent settings are unavailable. Existing definitions were preserved.",
      );
  }
  return checkedCatalog(settings);
}
export function configureAgentProfiles(config, catalog) {
  config.agent ??= {};
  const legacyPrimary = config.agent.build?.permission;
  for (const agent of catalog.agents) {
    const previous = config.agent[agent.id] ?? {};
    const permission =
      previous.permission ??
      legacyPrimary ??
      (typeof config.permission === "string" ? config.permission : {});
    const fallback = (key, otherwise) =>
      permission[key] ??
      permission["*"] ??
      (typeof config.permission === "string"
        ? config.permission
        : (config.permission?.[key] ?? config.permission?.["*"])) ??
      otherwise;
    config.agent[agent.id] = {
      ...previous,
      mode: "all",
      description: `${agent.name}: available for a main chat or a delegated assignment in Freelancer.`,
      // Persona and workflow are resolved once into each request's system prompt.
      // Do not pin an assignment's model or copy a mutable persona into this cache.
      prompt: "",
      model: undefined,
      permission:
        typeof permission === "string"
          ? permission
          : {
              ...permission,
              paid_delegate: fallback("paid_delegate", "ask"),
              plan_enter: "deny",
              task: fallback("task", "allow"),
            },
    };
  }
  for (const name of retiredAgents)
    config.agent[name] = { ...config.agent[name], disable: true };
  config.default_agent = "engineer";
  return config;
}
