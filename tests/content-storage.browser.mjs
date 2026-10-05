import { test, expect } from './support/browser-test.mjs';
import { localDataFixture } from './fixtures/local-data-app.mjs';

test('content storage shows memory and instruction search cards', { tag:['@app'] }, async ({appBrowser:browser,own}) => {
  const f=await own(localDataFixture());
  f.app.localData.get().createMemory({kind:'note',title:'Searchable fixture memory',body:'retained memory card coverage sentinel'});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto(f.url);
  const application=page.getByRole('button',{name:'Application settings',exact:true});
  if(await application.getAttribute('aria-expanded')!=='true') await application.click();
  await page.getByRole('button',{name:'Content & Storage',exact:true}).click();
  await page.getByRole('heading',{name:'Content & Storage',exact:true}).waitFor();
  const memories=page.getByRole('region',{name:'Memory search index'});
  const guidance=page.getByRole('region',{name:'Agent instruction and skill search index'});
  await expect(memories).toContainText('1 searchable');
  await expect(memories).toContainText('1 retained memories');
  await expect(guidance).toContainText('0 indexed files');
  await expect(guidance).toContainText('0 skills');
  await expect(memories.getByRole('button',{name:'Put project away'})).toHaveCount(0);
  await memories.getByRole('button',{name:'Search all content'}).click();
  await expect(page.getByRole('heading',{name:'Search all content',exact:true})).toBeVisible();
  await expect(page.getByText('Searchable fixture memory',{exact:true})).toBeVisible();
});
