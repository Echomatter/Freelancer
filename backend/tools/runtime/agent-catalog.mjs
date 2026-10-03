import { readRuntimeText as readFile } from './state-database.mjs';

import path from "node:path";
import {
  normalizeAgent,
  workspaceCatalog,
} from "../../../domain/workspace.mjs";

export const retiredAgents = Object.freeze([
  "git",
  "build",
  "plan",
  "explore",
  "general",
  "worker",
  "architect",
  "review",
]);

// One authored catalog. Native profiles are transport adapters, not a second
// set of personas. The exact agent prompt is supplied per request.
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
    // This hook sees authored configuration, before native generated-profile
    // defaults. Preserve explicit per-agent decisions (including deny); only
    // supply allow when no native/user rule applies.
    const question = fallback("question", "allow");
    config.agent[agent.id] = {
      ...previous,
      mode: "all",
      description: `${agent.name}: available for a main chat or a delegated assignment in Freelancer.`,
      // The authored persona is resolved into each request's system prompt.
      // Do not pin an assignment's model or copy a mutable persona into this cache.
      prompt: "",
      model: undefined,
      // OpenCode's generated named profiles otherwise disable its built-in
      // question tool, leaving the browser with no native request to render.
      tools: { ...previous.tools, question: previous.tools?.question ?? true },
      permission:
        typeof permission === "string"
          ? permission
          : {
              ...permission,
              // Override the native generated-profile default, not authored
              // permission decisions, so questions can reach the native UI.
              question,
              paid_delegate: fallback("paid_delegate", "ask"),
              plan_enter: "deny",
              task: fallback("task", "allow"),
            },
    };
  }
  for (const name of retiredAgents)
    config.agent[name] = { ...config.agent[name], disable: true };
  // Preserve a usable default chosen in native OpenCode settings. Freelancer's
  // retired built-ins stay disabled, so only a missing or retired default
  // falls back to the authored catalog's primary agent.
  if (typeof config.default_agent !== "string" || !config.default_agent || retiredAgents.includes(config.default_agent))
    config.default_agent = "engineer";
  return config;
}
