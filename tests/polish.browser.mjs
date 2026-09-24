import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { localDataFixture } from './fixtures/local-data-app.mjs';

const f = await localDataFixture();
const original = f.host.request.bind(f.host);
let todos = Array.from({ length: 30 }, (_, i) => ({ content: `Long task ${i + 1}`, status: i ? 'pending' : 'in_progress' }));
f.host.request = (route, options) => route.endsWith('/todo') ? Promise.resolve(todos) : original(route, options);
f.state.messages.ses_history = Array.from({length: 22}, (_, i) => [
  { info: { id: 'u'+i, role: 'user', time: {created: i*2} }, parts: [{id: 'up'+i, type: 'text', text: 'Review the layout, step '+(i+1)}] },
  { info: { id: 'a'+i, parentID:'u'+i, role:'assistant', providerID:'opencode', modelID:'free', time:{created:i*2+1,completed:i*2+2},finish:'stop' }, parts:[{id:'ap'+i,type:'text',text:'The workspace keeps your project and active work in view. This result is demonstration content for the layout check.\n\n- Provider identities stay consistent.\n- The composer stays available while you read.\n- Worker results remain separate from verified success.'}] },
]).flat();
f.state.messages.ses_history[0].parts[0].text = 'Please check the responsive layout, preserve the current reading position, and confirm that longer messages use a comfortable width without filling the entire conversation. '.repeat(4);
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:960}});
const errors=[];page.on('pageerror', e=>errors.push(e.message));page.setDefaultTimeout(15000);
try {
  await page.goto(f.url);
  await page.locator('.sidebar .sessions').getByRole('button',{name:/Important conversation/}).click();
  await page.getByRole('button',{name:'Dismiss task list until it changes'}).waitFor();
  const scroll=page.locator('.chat-scroll'), composer=page.locator('.composer');
  const bounds=await scroll.boundingBox(), input=await composer.boundingBox();
  assert.ok(Math.abs(bounds.y+bounds.height-960)<2,'scroll track reaches workspace bottom');
  assert.ok(Math.abs(input.y+input.height-960)<2,'composer aligns with scroll track bottom');
  const message = page.locator('.message.user').last();
  const bubble = await message.locator('.message-body').boundingBox();
  const row = await message.locator('..').boundingBox();
  assert.ok(Math.abs(bubble.x+bubble.width-row.x-row.width)<2,'user messages align with the conversation right edge');
  assert.ok(bubble.width<row.width/2,'short messages fit their text instead of leaving a wide color block');
  const longBubble = await page.locator('.message.user').first().boundingBox();
  assert.ok(longBubble.width>row.width*.6 && longBubble.width<row.width*.9,'long messages have a comfortable bounded width');
  await scroll.evaluate(e=>{e.scrollTop=300;});
  const before=await scroll.evaluate(e=>e.scrollTop);
  await page.getByRole('button',{name:'Application settings',exact:true}).click();
  await page.getByRole('button',{name:'Models',exact:true}).click();
  await page.getByRole('heading',{name:'Models',exact:true}).waitFor();
  await page.getByRole('button',{name:'Project settings',exact:true}).click();
  await page.getByRole('button',{name:'Workspace',exact:true}).click();
  await composer.waitFor();
  assert.ok(Math.abs((await scroll.evaluate(e=>e.scrollTop))-before)<3,'navigation preserves reading position');
  await page.getByRole('button',{name:'Dismiss task list until it changes'}).click();
  assert.equal(await page.getByRole('button',{name:'Dismiss task list until it changes'}).count(),0);
  assert.equal(todos.length,30,'dismiss did not mutate native todos');
  await page.getByRole('button',{name:'Show tasks',exact:true}).click();
  await page.getByRole('button',{name:'Dismiss task list until it changes'}).waitFor();
  await scroll.evaluate(e=>{e.scrollTop=e.scrollHeight;});
  await mkdir('artifacts/polish',{recursive:true});
  await page.screenshot({path:'artifacts/polish/workspace-desktop.png'});
  f.state.status.ses_history={type:'busy'};
  await page.locator('.composer textarea').fill('Check the navigation while the current work continues.');
  await page.getByRole('button',{name:'Queue or delegate message',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Queue or Delegate?'});
  await dialog.getByRole('button',{name:/^Queue Send automatically/}).click();
  const queued=page.locator('.work-card').filter({hasText:'Queue · Waiting'});
  await queued.waitFor();
  assert.equal(await queued.getByRole('button',{name:'Cancel message'}).count(),1);
  const taskCard = page.locator('.work-card').filter({ hasText: 'Tasks · 0/30 complete' });
  const taskToggle = taskCard.getByRole('button', { name: /Tasks · 0\/30 complete/ });
  assert.equal(await taskToggle.getAttribute('aria-expanded'), 'false', 'long task cards start collapsed so they do not create a nested scroll region');
  assert.ok(await queued.count(), 'queued delivery remains visible alongside a long task list');
  await taskToggle.click();
  const cardMetrics = await page.evaluate(() => {
    const cards = document.querySelector('.composer-cards');
    const tasks = document.querySelector('.todo-dock-list');
    return { cards: getComputedStyle(cards).overflowY, tasks: getComputedStyle(tasks).overflowY };
  });
  assert.equal(cardMetrics.cards, 'visible', 'composer cards do not gain their own scrollbar');
  assert.equal(cardMetrics.tasks, 'visible', 'task list does not gain a second scrollbar');
  await queued.getByRole('button',{name:'Dismiss delivery card'}).click();
  await page.getByRole('button',{name:'Show hidden delivery cards'}).click();
  await queued.waitFor();
  await page.screenshot({path:'artifacts/polish/workspace-cards.png'});
  await queued.getByRole('button',{name:'Cancel message'}).click();
  await queued.waitFor({state:'detached'});
  await page.setViewportSize({width:480,height:840});
  await composer.waitFor();
  const mobile=await composer.boundingBox();
  assert.ok(mobile.x>=0&&mobile.x+mobile.width<=480,'composer fits narrow viewport');
  assert.ok(Math.abs(mobile.y+mobile.height-840)<2,'narrow composer stays bottom aligned');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
  await page.screenshot({path:'artifacts/polish/workspace-narrow.png'});
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.deepEqual(errors,[]);
  console.log('PASS bottom-aligned scrollbar/composer, retained navigation position, shared dismissible cards, explicit queue cancel, narrow layout and no browser errors');
} catch(error){await mkdir('artifacts/polish',{recursive:true});await page.screenshot({path:'artifacts/polish/failure.png'});throw error;}
finally { await browser.close(); await f.close(); }
