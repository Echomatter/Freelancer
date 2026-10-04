import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describeCapability } from "../domain/capability-descriptions.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SKILLS = path.join(ROOT, "backend", "skills");
const manifest = JSON.parse(readFileSync(path.join(ROOT, "backend", "opencode", "catalog.json"), "utf8"));
const sharedInstructions = () => [
  "backend/global/WORKSTYLE.md",
  "backend/opencode/global-instructions.md",
  "server/execution.mjs",
].map(file => readFileSync(path.join(ROOT, file), "utf8")).join("\n");

function read(skill, file = "SKILL.md") {
  const p = path.join(SKILLS, skill, file);
  assert.equal(existsSync(p), true, `missing backend/skills/${skill}/${file}`);
  return readFileSync(p, "utf8");
}

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(m, "missing YAML frontmatter");
  const name = (m[1].match(/^name:\s*(.+)$/m) || [])[1]?.trim();
  const rawDescription = (m[1].match(/^description:\s*(.+)$/m) || [])[1]?.trim();
  const description = /^[>|]$/.test(rawDescription ?? "")
    ? (m[1].match(/^description:.*\r?\n((?:[ \t]+[^\n]*\n?)+)/m) || [])[1]?.trim()
    : rawDescription;
  return { name, description };
}

test("every shared skill exists with matching manifest frontmatter", () => {
  const names = new Set();
  for (const skill of manifest.skills) {
    const text = read(skill);
    const { name, description } = frontmatter(text);
    assert.equal(name, skill, `frontmatter name mismatch in ${skill}`);
    assert.ok(description && description.length > 10, `empty description in ${skill}`);
    assert.ok(!names.has(name), `duplicate skill name ${name}`);
    names.add(name);
  }
  assert.ok(existsSync(path.join(SKILLS, "delegate-work", "evidence-refresh.md")));
  assert.ok(existsSync(path.join(SKILLS, "record-outcome", "recording-contract.md")));
});

test("skills use the public delegate schema, not stale arguments", () => {
  const staleArg = /\b(agentID|selectedModel|userTaskId|workflowID|role)\b/;
  for (const skill of manifest.skills) {
    const text = read(skill);
    // Restrict argument checks to actual delegate calls; explanatory prose may
    // describe another tool's fields or explicitly prohibit retired names.
    const calls = text.match(/delegate\(\{[\s\S]*?\}\)/g) || [];
    for (const call of calls) {
      assert.doesNotMatch(call, staleArg, `${skill} contains stale delegate argument in ${call.slice(0, 80)}`);
    }
    assert.doesNotMatch(text, /delegate\.userTaskId/, `${skill} references nonexistent delegate.userTaskId`);
    assert.doesNotMatch(text, /subagent_type/, `${skill} references non-public subagent_type`);
  }
  const outcome = read("record-outcome", "recording-contract.md");
  for (const parameter of ["-UserTaskId", "-ReviewTaskId", "-MarkReviewDefect", "-Model", "-TaskType", "-Success", "-VerificationStatus", "-TestsPassed"]) {
    assert.ok(outcome.includes(parameter), `outcome contract must document ${parameter}`);
  }
});

test("evidence-refresh preserves bounded source maintenance and optional inspection", () => {
  const text = read("delegate-work", "evidence-refresh.md");
  assert.doesNotMatch(text, /\bBuild (captures|runs|prepares|owns)\b/, "retired Build stage remains");
  assert.doesNotMatch(text, /mandatory (stage|review)/i, "mandatory stage remains");
  assert.match(read("delegate-work"), /named[\s\S]*agent/i, "delegation must use the named catalog");
  assert.match(text, /if useful|optional/i, "source delegation should remain optional");
  for (const field of ["inspectionOnly", "base_sha256", "capture_id", "last_researched_at"]) {
    assert.ok(text.includes(field), `evidence maintenance must retain ${field}`);
  }
  assert.match(text, /model_catalog/, "published catalog refresh must remain distinct from internal evidence maintenance");
});

test("shared guidance preserves native authority and actual goal contracts", () => {
  const shared = sharedInstructions();
  assert.match(shared, /grant no authority|never grant permission/i);
  assert.match(shared, /native[\s\S]{0,100}permissions/i);
  assert.match(shared, /paid[\s\S]{0,80}consent/i);
  assert.match(shared, /Git\/GitHub agreements|project agreement/i);
  const routing = read("delegate-work");
  assert.match(routing, /paid_delegate/);
  assert.match(routing, /never replay[\s\S]*uncertain input/i);
  const goal = read("pursue-goal");
  for (const field of ["goal_checkpoint", "interpretation", "checkpoint", "reason", "evidence", "continue", "waiting", "pause", "complete"]) {
    assert.ok(goal.includes(field), `goal contract must preserve ${field}`);
  }
  assert.match(goal, /auto-resume explicit Stop/i);
  assert.match(goal, /Ordinary chats do not call/);
  for (const skill of manifest.skills) {
    assert.doesNotMatch(read(skill), /grants (you )?write|paid access granted/i, `${skill} implies authority`);
  }
});

test("investigation skills retain honest unavailable-evidence fallbacks", () => {
  for (const skill of ["debug", "verify", "playwright", "review"]) {
    assert.match(read(skill), /unavailable/i, `${skill} must retain the unavailable-evidence limitation`);
  }
  const handoff = read("handoff");
  assert.match(handoff, /missing/i);
  assert.match(handoff, /partial findings/i);
  assert.match(handoff, /recovery probe/i);
});

test("verification states are classified honestly", () => {
  for (const text of [read("verify"), read("handoff"), read("record-outcome", "recording-contract.md")]) {
    for (const state of ["passed", "failed", "skipped", "not-run", "unavailable", "unverified"]) {
      assert.ok(text.toLowerCase().includes(state), `verification guidance must classify ${state}`);
    }
  }
  assert.match(read("record-outcome", "recording-contract.md"), /tests_passed: null/);
  assert.match(read("playwright"), /failed, unavailable or unrun/);
});

test("playwright distinguishes browser observations from repository fixtures", () => {
  const text = read("playwright");
  const operations = read("playwright", "references/mcp-operations.md");
  assert.match(operations, /configured native MCP/i);
  assert.match(text, /Repository journeys/);
  assert.match(text, /fixture journeys[\s\S]*distinct evidence/i);
  assert.match(operations, /browser_snapshot/);
  assert.match(operations, /actual|live|discovered/i, "browser operations must use observed schemas");
  assert.doesNotMatch(text + operations, /install .*browser stack/i, "must not install a competing browser stack");
});

test("handoff is a durable checkpoint without automatic Git actions", () => {
  const text = read("handoff").toLowerCase();
  for (const part of ["objective", "state", "checks", "decisions", "remaining", "risks", "next action"]) {
    assert.ok(text.includes(part), `handoff must cover ${part}`);
  }
  assert.match(text, /never[\s\S]{0,100}performs? git actions/i);
  assert.doesNotMatch(text, /\bgit commit\b|\bgit stash\b/, "handoff must not instruct commits or stashes");
});

test("debug and review retain distinct investigation and critique contracts", () => {
  const debug = read("debug").toLowerCase();
  for (const part of ["reproduc", "hypothesis", "smallest", "rerun"]) {
    assert.ok(debug.includes(part), `debug must cover ${part}`);
  }
  const review = read("review").toLowerCase();
  assert.match(review, /return findings/);
  assert.match(review, /inspectiononly: true/);
  assert.match(review, /independentreview: true/);
  for (const part of ["correctness", "regression", "security", "checks", "user-visible"]) {
    assert.ok(review.includes(part), `review must cover ${part}`);
  }
});

test("manifest lists exactly the implemented skills; retired entries are absent", () => {
  const implemented = readdirSync(SKILLS, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(path.join(SKILLS, entry.name, "SKILL.md")))
    .map(entry => entry.name);
  assert.deepEqual([...manifest.skills].sort(), implemented.sort(), "manifest skills must match implemented folders");
  for (const retired of ["sync", "browser-verify", "docs-research", "model-routing"]) {
    assert.ok(!manifest.skills.includes(retired), `retired skill ${retired} must be absent`);
  }
});

test("authored skills and registered tools have concise capability summaries", () => {
  for (const skill of manifest.skills) {
    assert.match(skill, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `invalid canonical skill ID ${skill}`);
    const summary = describeCapability("skills", skill);
    assert.ok(summary?.name, `missing display name for ${skill}`);
    assert.ok(summary?.description && summary.description.length <= 240, `missing or too-long summary for ${skill}`);
    assert.match(summary.description, /^[^.!?]+[.!?]$/, `summary for ${skill} should be one short sentence`);
  }
  for (const tool of manifest.tools) {
    const summary = describeCapability("tools", tool);
    assert.ok(summary?.name, `missing display name for ${tool}`);
    assert.ok(summary?.description && summary.description.length <= 240, `missing or too-long summary for ${tool}`);
  }
  assert.equal(describeCapability("tools", "unlisted_native_mcp_tool"), null);
});

test("optional guidance stays proportional and task-triggered", () => {
  const shared = sharedInstructions();
  assert.match(shared, /load guidance only when useful|Load useful skills on demand/i);
  assert.match(shared, /Do not load a chain of skills/i);
  const comparison = read("compare-builds");
  assert.match(comparison, /same brief[\s\S]*acceptance criteria/i);
  assert.match(comparison, /tests[\s\S]*only when requested or already authorized/i);
  assert.match(comparison, /Do not invent a winner/i);
  assert.match(comparison, /never automatically merges, publishes/i);
});

test("capability guidance keeps historical, advisory and observed evidence distinct", () => {
  const memory = read("remember");
  assert.match(memory, /Verify current[\s\S]*against source or native receipts/i);
  assert.match(memory, /Do not automatically mirror/i);
  assert.match(memory, /Structured model outcomes remain[\s\S]*authoritative/i);
  assert.doesNotMatch(memory, /only when the user asks|agreed project workflow/i);
  const verify = read("verify");
  assert.match(verify, /fixture does not prove provider authentication/i);
  assert.match(verify, /build does not prove a[\s\S]*visible launch/i);
  assert.match(verify, /documentation does not prove the app/i);
  const routing = read("delegate-work");
  assert.match(routing, /runtime owns eligibility/i);
  assert.match(routing, /Neither supplies entitlement,[\s\S]*paid consent or verified task success/i);
  assert.match(sharedInstructions(), /tools remain directly usable|do not gate the platform-wide toolkit/i);
  assert.match(read("bounded-judgment"), /No skill is a prerequisite/i);
  assert.match(read("reason-through"), /adds no observations or independent verification/i);
});
