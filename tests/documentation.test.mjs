import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const entrypoints = [
  "README.md", "docs/README.md", "docs/getting-started.md",
  "docs/ARCHITECTURE.md", "docs/local-data.md", "docs/named-agents.md", "docs/delegation-budget.md",
];
const read = path => readFileSync(resolve(root, path), "utf8");

// These entrypoints use inline Markdown links and ATX headings. Keep the
// checker dependency-free and deliberately scoped; this is not a GFM parser.
function withoutFences(markdown) {
  let fence;
  return markdown.split(/\r?\n/).map(line => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (!fence && marker) { fence = marker[1]; return ""; }
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length)
        fence = undefined;
      return "";
    }
    return line;
  }).join("\n");
}
function anchors(markdown) {
  const used = new Set();
  for (const match of withoutFences(markdown).matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*$/gm)) {
    const base = match[1].toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, "").replace(/ /g, "-");
    let slug = base, suffix = 0;
    while (used.has(slug)) slug = `${base}-${++suffix}`;
    used.add(slug);
  }
  return used;
}
function links(markdown) {
  return Array.from(withoutFences(markdown).matchAll(/!?\[[^\]\n]*\]\(([^\s)]+)\)/g), match => match[1]);
}
function localTarget(document, href) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return null;
  const match = href.match(/^([^?#]*)(?:\?[^#]*)?(?:#(.*))?$/);
  assert.ok(match, `Invalid link in ${document}: ${href}`);
  const file = match[1] ? resolve(root, dirname(document), decodeURIComponent(match[1])) : resolve(root, document);
  const fromRoot = relative(root, file);
  assert.ok(fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !fromRoot.startsWith(sep), `Link escapes repository: ${href}`);
  return { file, fragment: decodeURIComponent(match[2] ?? "") };
}

for (const document of entrypoints) {
  test(`documentation links and anchors resolve: ${document}`, () => {
    const hrefs = links(read(document));
    assert.ok(hrefs.length > 0, `No links checked in ${document}`);
    for (const href of hrefs) {
      const target = localTarget(document, href);
      if (!target) continue;
      let stat;
      try { stat = statSync(target.file); }
      catch { assert.fail(`${document}: missing target ${href}`); }
      if (target.fragment && extname(target.file) === ".md") {
        assert.ok(stat.isFile(), `${document}: fragment targets a directory: ${href}`);
        assert.ok(anchors(readFileSync(target.file, "utf8")).has(target.fragment), `${document}: missing heading ${href}`);
      }
    }
  });
}

test("documentation checker skips code examples and recognizes duplicate headings", () => {
  const markdown = "# First use\n## First use\n## First use-1\n```md\n[example](missing.md)\n## Not a heading\n```\n[setup](docs/getting-started.md#first-use)\n";
  assert.deepEqual(links(markdown), ["docs/getting-started.md#first-use"]);
  assert.deepEqual([...anchors(markdown)], ["first-use", "first-use-1", "first-use-1-1"]);
  assert.equal(localTarget("README.md", "https://example.com/page#heading"), null);
  assert.equal(localTarget("README.md", "mailto:example@example.com"), null);
  assert.throws(() => localTarget("README.md", "../../outside.md"), /escapes repository/);
  assert.equal(localTarget("docs/README.md", "getting-started.md?view=1#first-use").fragment, "first-use");
});

test("documented npm scripts exist in the package manifest", () => {
  const scripts = JSON.parse(read("package.json")).scripts;
  for (const document of ["README.md", "docs/getting-started.md"]) {
    const commands = Array.from(read(document).matchAll(/\bnpm(?:\.cmd)?\s+(?:run\s+([\w:-]+)|(start|test))\b/g));
    assert.ok(commands.length > 0);
    for (const match of commands) {
      const command = match[1] ?? match[2];
      assert.equal(typeof scripts[command], "string", `${document}: unknown npm script ${command}`);
    }
  }
});
