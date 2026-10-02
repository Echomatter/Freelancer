import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SKILLS = path.join(ROOT, "backend", "skills");

const EXPECTED = [
  "debug",
  "verify",
  "browser-verify",
  "review",
  "handoff",
  "reorient",
  "search-index",
  "model-routing",
  "record-outcome",
  "pursue-goal",
];
const CAPABILITY_SKILLS = [
  "playwright", "web-research", "remember", "reason-through", "docs-research",
  "bounded-judgment", "typesafe-ai",
];

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
  for (const skill of [...EXPECTED, ...CAPABILITY_SKILLS]) {
    const text = read(skill);
    const { name, description } = frontmatter(text);
    assert.equal(name, skill, `frontmatter name mismatch in ${skill}`);
    assert.ok(description && description.length > 10, `empty description in ${skill}`);
    assert.ok(!names.has(name), `duplicate skill name ${name}`);
    names.add(name);
  }
  assert.ok(existsSync(path.join(SKILLS, "model-routing", "evidence-refresh.md")));
});

test("skills use the public delegate schema, not stale arguments", () => {
  const staleArg = /\b(agentID|selectedModel|userTaskId|workflowID|role)\b/;
  for (const skill of EXPECTED) {
    const text = read(skill);
    // Check each delegate({...}) call's own arguments; prose that forbids a
    // token (e.g. "never use `agentID`") is allowed.
    const calls = text.match(/delegate\(\{[\s\S]*?\}\)/g) || [];
    for (const call of calls) {
      assert.doesNotMatch(call, staleArg, `${skill} contains stale delegate argument in ${call.slice(0, 80)}`);
    }
    assert.doesNotMatch(text, /delegate\.userTaskId/, `${skill} references nonexistent delegate.userTaskId`);
    assert.doesNotMatch(text, /subagent_type/, `${skill} references non-public subagent_type`);
  }
  const outcome = read("record-outcome");
  assert.match(outcome, /-UserTaskId/, "record-outcome must preserve valid -UserTaskId");
  assert.match(outcome, /-ReviewTaskId/, "record-outcome must preserve valid -ReviewTaskId");
  assert.match(outcome, /-MarkReviewDefect/, "record-outcome must preserve valid -MarkReviewDefect");
  assert.match(outcome, /-Model/, "record-outcome must preserve valid -Model");
  assert.match(outcome, /-TaskType/, "record-outcome must preserve valid -TaskType");
  assert.match(outcome, /-Success/, "record-outcome must preserve valid -Success");
  assert.match(outcome, /-TestsPassed/, "record-outcome must preserve valid -TestsPassed");
});

test("evidence-refresh is rewritten around named agents with optional delegation", () => {
  const text = read("model-routing", "evidence-refresh.md");
  assert.doesNotMatch(text, /\bBuild (captures|runs|prepares|owns)\b/, "retired Build stage remains");
  assert.doesNotMatch(text, /mandatory (stage|review)/i, "mandatory stage remains");
  assert.match(text, /Researcher/, "should still name Researcher as an option");
  assert.match(text, /engineer|designer|named agent/i, "should reference current named agents");
  assert.match(text, /optional/i, "delegation/review should be optional");
  assert.match(text, /inspectionOnly/, "read-only delegation should use inspectionOnly");
});

test("skills teach procedure and fallback, not authority", () => {
  for (const skill of EXPECTED) {
    const text = read(skill);
    assert.match(text, /grants no[\s\S]{0,200}?authority/i, `${skill} must disclaim authority`);
    assert.match(text, /optional|never required/i, `${skill} must not mandate delegation`);
  }
  for (const skill of EXPECTED) {
    const text = read(skill);
    const withoutDisclaimer = text.replace(/grants no [^\n]*/gi, "");
    assert.doesNotMatch(
      withoutDisclaimer,
      /grants (you )?write|enables? integration|will publish|paid access granted/i,
      `${skill} implies authority`,
    );
  }
});

test("new skills declare required capabilities with honest fallbacks", () => {
  for (const skill of ["debug", "verify", "browser-verify", "review", "handoff"]) {
    const text = read(skill);
    assert.match(text, /Required capabilities/i, `${skill} must list required capabilities`);
    assert.match(text, /Fallback/i, `${skill} must document a fallback`);
  }
});

test("verification states are classified honestly", () => {
  for (const skill of ["debug", "verify", "handoff"]) {
    const text = read(skill).toLowerCase();
    for (const state of ["passed", "failed", "skipped", "unavailable", "unverified"]) {
      assert.ok(text.includes(state), `${skill} must classify ${state}`);
    }
  }
  const browser = read("browser-verify");
  assert.match(browser, /Pass/, "browser-verify must classify Pass");
  assert.match(browser, /Fail/, "browser-verify must classify Fail");
  assert.match(browser, /Skip/, "browser-verify must classify Skip");
});

test("browser-verify distinguishes MCP observation from repo fixtures", () => {
  const text = read("browser-verify");
  assert.match(text, /browser MCP/i, "must reference the native configured browser MCP");
  assert.match(text, /browser journeys|test:browser/i, "must reference repo browser journeys for fixtures");
  assert.match(text, /distinct/i, "must distinguish MCP observation from fixture results");
  assert.doesNotMatch(text, /install .*browser stack/i, "must not install a competing browser stack");
});

test("handoff is a durable checkpoint without auto-commit", () => {
  const text = read("handoff").toLowerCase();
  for (const part of ["objective", "state", "checks", "decisions", "remaining", "risks", "next action"]) {
    assert.ok(text.includes(part), `handoff must cover ${part}`);
  }
  assert.match(text, /auto-commit|do not .*commit|never .*commit/i, "handoff must forbid auto-commit");
  assert.doesNotMatch(text, /\bgit commit\b|\bgit stash\b/, "handoff must not instruct commits or stashes");
});

test("debug and review follow the required shape", () => {
  const debug = read("debug").toLowerCase();
  for (const part of ["reproduc", "hypothesis", "smallest", "rerun"]) {
    assert.ok(debug.includes(part), `debug must cover ${part}`);
  }
  const review = read("review").toLowerCase();
  assert.ok(review.includes("report-only"), "review must be report-only");
  for (const part of ["correctness", "regression", "security", "tests", "user-visible"]) {
    assert.ok(review.includes(part), `review must cover ${part}`);
  }
});

test("manifest lists exactly the implemented skills; sync is absent", () => {
  const manifestPath = path.join(ROOT, "backend", "opencode", "catalog.json");
  assert.equal(existsSync(manifestPath), true, "missing backend/opencode/catalog.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.ok(!manifest.skills.includes("sync"), "sync must be absent from the manifest");
  assert.deepEqual([...manifest.skills].sort(), [...EXPECTED, ...CAPABILITY_SKILLS].sort(), "manifest skills must match implemented skills");
  for (const skill of manifest.skills) {
    assert.equal(
      existsSync(path.join(SKILLS, skill, "SKILL.md")),
      true,
      `manifest skill ${skill} has no backend/skills/${skill}/SKILL.md`,
    );
  }
});

test("optional flows stay task-triggered", () => {
  for (const skill of ["debug", "verify", "review"]) {
    assert.match(read(skill), /task-triggered only/i, `${skill} must keep extras task-triggered`);
  }
});

test("capability guidance keeps historical, advisory and observed evidence distinct", () => {
  const memory = read("remember");
  assert.match(memory, /verify[\s\S]*current source/i);
  assert.match(memory, /never[\s\S]*automatically mirror/i);
  assert.match(memory, /structured model[\s\S]*outcomes remain authoritative/i);
  assert.doesNotMatch(memory, /only when the user asks|agreed project workflow/i);
  const verify = read("verify");
  assert.match(verify, /unit test does not prove[\s\S]*UI[\s\S]*Playwright interaction does not prove[\s\S]*invariants/);
  assert.match(verify, /documentation[\s\S]*does not prove the app/);
  assert.match(read("model-routing"), /JEV cannot set eligibility, override explicit model choices or authorize paid use/);
  assert.match(read("browser-verify"), /tools can be called directly without loading it/);
  for (const skill of CAPABILITY_SKILLS) {
    assert.match(read(skill), /optional/i, `${skill} must remain guidance`);
    assert.match(read(skill), /not a prerequisite|neither[\s\S]*required|does not grant or gate|neither skill is a prerequisite/i,
      `${skill} must not become an access prerequisite`);
  }
});
