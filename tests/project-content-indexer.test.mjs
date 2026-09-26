import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createLocalDataStore } from '../server/data/store.mjs';
import { DatabaseSync } from 'node:sqlite';
import { deflateRawSync } from 'node:zlib';

function zip(files) {
  const locals=[],centrals=[];let offset=0;
  for(const [name,text] of Object.entries(files)){const n=Buffer.from(name),data=Buffer.from(text),compressed=deflateRawSync(data),crc=crc32(data);const local=Buffer.alloc(30+n.length);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(8,6);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(n.length,26);n.copy(local,30);locals.push(local,compressed);const central=Buffer.alloc(46+n.length);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,8);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(n.length,28);central.writeUInt32LE(offset,42);n.copy(central,46);centrals.push(central);offset+=local.length+compressed.length;}
  const cd=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,cd,end]);
}
function crc32(buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let i=0;i<8;i++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}return (crc^0xffffffff)>>>0;}

test('Node project content indexer rebuilds, searches, and reports freshness without Python', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-node-index-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const project=path.join(root,'project'); await mkdir(project);
  await writeFile(path.join(project,'notes.md'),'# Telescope\n\nA cobalt telescope observes Jupiter and its rings.');
  await mkdir(path.join(project,'.cache'));
  await writeFile(path.join(project,'.cache','generated.md'),'A cached zephyr should not enter project search.');
  const store=createLocalDataStore(path.join(root,'data')); store.close();
  const db=path.join(root,'data','freelancer.sqlite'), indexer=path.resolve('backend/tools/project-content-indexer.mjs');
  const invoke=(...args)=>spawnSync(process.execPath,[indexer,'--db',db,'--project-key',project,...args],{cwd:project,encoding:'utf8',env:{...process.env,PATH:''}});
  const rebuilt=invoke('rebuild','--root',project,'--facts','none');
  assert.equal(rebuilt.status,0,rebuilt.stderr);
  assert.equal(JSON.parse(rebuilt.stdout).indexed_sources,1);
  const search=invoke('search','telescope'); assert.equal(search.status,0,search.stderr);
  assert.match(search.stdout,/notes\.md/); assert.match(search.stdout,/Jupiter/);
  assert.doesNotMatch(invoke('search','zephyr').stdout,/generated\.md/);
  const status=invoke('status','--root',project); assert.equal(status.status,0,status.stderr);
  assert.equal(JSON.parse(status.stdout).stale,false);
  await writeFile(path.join(project,'second.md'),'A bronze telescope tracks Neptune.');
  const incremental=invoke('rebuild','--root',project,'--facts','none');
  assert.equal(incremental.status,0,incremental.stderr);
  assert.equal(JSON.parse(incremental.stdout).refresh_mode,'incremental');
  assert.equal(JSON.parse(incremental.stdout).units,2);
  assert.match(invoke('search','Neptune').stdout,/second\.md/);
  const unchanged=invoke('rebuild','--root',project,'--facts','none');
  assert.equal(unchanged.status,0,unchanged.stderr);
  assert.equal(JSON.parse(unchanged.stdout).files_reindexed,0);
  assert.match(invoke('search','Jupiter').stdout,/notes\.md/);
  await rm(path.join(project,'second.md'));
  const removed=invoke('rebuild','--root',project,'--facts','none');
  assert.equal(removed.status,0,removed.stderr);
  assert.equal(JSON.parse(removed.stdout).files_removed,1);
  assert.equal(JSON.parse(removed.stdout).units,1);
  assert.doesNotMatch(invoke('search','Neptune').stdout,/second\.md/);
});

test('Node indexer skips an unreadable extraction and keeps searchable sources', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-node-index-skip-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const project=path.join(root,'project');await mkdir(project);const data=path.join(root,'data');const store=createLocalDataStore(data);store.close();
  await writeFile(path.join(project,'broken.pdf'),'not a PDF');
  await writeFile(path.join(project,'good.md'),'The carnelian beacon is ready.');
  const indexer=path.resolve('backend/tools/project-content-indexer.mjs'),db=path.join(data,'freelancer.sqlite');
  const invoke=(...args)=>spawnSync(process.execPath,[indexer,'--db',db,'--project-key',project,...args],{cwd:project,encoding:'utf8'});
  const build=invoke('rebuild','--root',project);assert.equal(build.status,0,build.stderr);
  assert.equal(JSON.parse(build.stdout).extraction_failures.length,1);
  assert.match(invoke('search','carnelian').stdout,/good\.md/);
});

test('Node indexer extracts DOCX, XLSX, ZIP virtual sources and stores structured facts', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-Node-Index-Formats-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const project=path.join(root,'project');await mkdir(project);const data=path.join(root,'data');const store=createLocalDataStore(data);store.close();
  const docx=zip({'word/document.xml':'<w:document xmlns:w="w"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Voyager dossier</w:t></w:r></w:p><w:p><w:r><w:t>Speed: 9 km per second</w:t></w:r></w:p><w:p><w:r><w:t>Mission: Jupiter exploration</w:t></w:r></w:p></w:body></w:document>'});
  const xlsx=zip({'xl/workbook.xml':'<workbook xmlns:r="r"><sheets><sheet name="Ships" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>','xl/sharedStrings.xml':'<sst><si><t>Name</t></si><si><t>Speed</t></si><si><t>Enterprise</t></si><si><t>Warp 9</t></si></sst>','xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>'});
  await writeFile(path.join(project,'voyager.docx'),docx);await writeFile(path.join(project,'ships.xlsx'),xlsx);await writeFile(path.join(project,'archive.zip'),zip({'manual.txt':'Archive contains a nebula chart.'}));
  const indexer=path.resolve('backend/tools/project-content-indexer.mjs'),db=path.join(data,'freelancer.sqlite'),invoke=(...args)=>spawnSync(process.execPath,[indexer,'--db',db,'--project-key',project,...args],{cwd:project,encoding:'utf8'});
  const build=invoke('rebuild','--root',project,'--facts','general');assert.equal(build.status,0,build.stderr);const summary=JSON.parse(build.stdout);assert.equal(summary.extraction_failures.length,0,build.stderr);assert.ok(summary.facts>0,JSON.stringify(summary));
  assert.match(invoke('search','Jupiter').stdout,/voyager\.docx/);assert.match(invoke('search','Warp').stdout,/ships\.xlsx/);assert.match(invoke('search','nebula').stdout,/archive\.zip!manual\.txt/);
  // The production key is case-folded only on Windows. Mixed case in the
  // fixture prefix makes a POSIX regression deterministic, not seed-dependent.
  const key = process.platform === 'win32' ? project.toLowerCase() : project;
  const query = new DatabaseSync(db, { readOnly: true });
  try {
    assert.ok(query.prepare('SELECT COUNT(*) n FROM content_facts f JOIN content_sources s ON s.source_id=f.source_id WHERE s.project_key=?').get(key).n > 0,
      JSON.stringify(query.prepare('SELECT * FROM content_meta WHERE project_key=?').all(key)));
    if (process.platform !== 'win32') {
      assert.equal(query.prepare('SELECT COUNT(*) n FROM content_sources WHERE project_key=?').get(project.toLowerCase()).n, 0);
    }
  } finally { query.close(); }
});

test('Node indexer honors special fact rules and exposes aggregate fact statistics', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-node-index-facts-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const project=path.join(root,'project');await mkdir(project);const data=path.join(root,'data');const store=createLocalDataStore(data);store.close();
  await writeFile(path.join(project,'catalog.json'),JSON.stringify({model:'Aurora',speed:'9 km/s',status:'active'}));
  const indexer=path.resolve('backend/tools/project-content-indexer.mjs'),db=path.join(data,'freelancer.sqlite'),invoke=(...args)=>spawnSync(process.execPath,[indexer,'--db',db,'--project-key',project,...args],{cwd:project,encoding:'utf8'});
  const build=invoke('rebuild','--root',project,'--facts','both','--special-fact','velocity=speed');assert.equal(build.status,0,build.stderr);assert.ok(JSON.parse(build.stdout).facts>0);
  const facts=invoke('facts','--family','velocity');assert.equal(facts.status,0,facts.stderr);assert.match(facts.stdout,/9 km\/s/);
  const stats=invoke('facts','--stats');assert.equal(stats.status,0,stats.stderr);assert.match(stats.stdout,/identity/);
});

test('Node indexer reads a text-layer PDF without an external Python runtime', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-node-index-pdf-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const project=path.join(root,'project');await mkdir(project);const data=path.join(root,'data');const store=createLocalDataStore(data);store.close();
  const pdf='%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n2 0 obj << /Length 61 >> stream\nBT /F1 12 Tf 72 720 Td (ORCHID REPORT) Tj 0 -20 Td (Jupiter mission) Tj ET\nendstream endobj\n%%EOF';
  await writeFile(path.join(project,'report.pdf'),pdf,'latin1');
  const indexer=path.resolve('backend/tools/project-content-indexer.mjs'),db=path.join(data,'freelancer.sqlite'),build=spawnSync(process.execPath,[indexer,'--db',db,'--project-key',project,'rebuild','--root',project],{cwd:project,encoding:'utf8'});
  assert.equal(build.status,0,build.stderr);assert.equal(JSON.parse(build.stdout).extraction_failures.length,0);
  const search=spawnSync(process.execPath,[indexer,'--db',db,'--project-key',project,'search','ORCHID'],{cwd:project,encoding:'utf8'});assert.equal(search.status,0,search.stderr);assert.match(search.stdout,/report\.pdf/);
});