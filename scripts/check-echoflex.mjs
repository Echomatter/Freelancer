import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export function dialogViolations(file, source) {
  const errors = [];
  if (file.endsWith('.css')) {
    if (!file.startsWith('src/echoflex/') && /::backdrop|\.modal-backdrop\b/.test(source))
      errors.push('Modal backdrops belong to Echoflex.');
    return errors;
  }
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JS);
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(tree);
      if (tag === 'dialog' && file !== 'src/echoflex/Dialog.tsx') errors.push('Use Echoflex Dialog instead of native dialog markup.');
      const role = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(tree) === 'role');
      // Project picker is an anchored, nonmodal disclosure; it never shades the app.
      if (role?.initializer && /^("|')(alertdialog|dialog)\1$/.test(role.initializer.getText(tree)) && file !== 'src/ProjectPicker.tsx')
        errors.push('Use Echoflex Dialog instead of a custom modal role.');
    }
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(tree);
      if (/^(window|globalThis)\.(confirm|alert|prompt)$/.test(name)) errors.push('Use an Echoflex dialog instead of a browser popup.');
      if (/\.showModal$/.test(name) && file !== 'src/echoflex/dialog-stack.mjs') errors.push('Dialog lifetimes belong to the Echoflex stack.');
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return errors;
}

export async function checkEchoflex(root = process.cwd()) {
  const errors = [], skins = new Set(), files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (/\.(tsx|ts|mjs|css)$/.test(entry.name)) files.push(target);
    }
  }
  await walk(path.join(root, 'src'));
  const contents = await Promise.all(files.map(async file => [path.relative(root, file).replaceAll('\\', '/'), await readFile(file, 'utf8')]));
  for (const [file, source] of contents) {
    errors.push(...dialogViolations(file, source).map(error => `${file}: ${error}`));
    if (file.endsWith('.tsx')) {
      const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = node => {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(tree) === 'Dialog') {
          const cls = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(tree) === 'className');
          if (cls?.initializer && ts.isStringLiteral(cls.initializer)) for (const name of cls.initializer.text.split(/\s+/)) skins.add(name);
        }
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
  }
  for (const [file, source] of contents.filter(([file]) => file.endsWith('.css') && !file.startsWith('src/echoflex/'))) {
    for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = match[1].trim().split(',').map(s => s.trim());
      if (selectors.some(s => s.startsWith('.ef-dialog') || [...skins].some(name => s === `.${name}`)) &&
        /(?:^|;)\s*(?:background(?:-color)?|border(?:-radius)?|box-shadow|padding|width|max-width|margin|position)\s*:/.test(match[2]))
        errors.push(`${file}: Dialog shell styling belongs to Echoflex; customize body content instead.`);
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const errors = await checkEchoflex();
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('Echoflex dialog boundary verified.');
}
