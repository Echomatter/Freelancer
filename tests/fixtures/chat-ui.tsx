import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Chat } from '../../src/Chat';
import { Details } from '../../src/WorkspacePanels';
import { workspaceCatalog } from '../../domain/workspace.mjs';
import '../../src/styles.css';
const settings = workspaceCatalog({});
const data = { settings, snapshot: {}, models: [], providers: { all: [], connected: [] } };
const initial: any[] = Array.from({length: 12}, (_, i) => [
  { info: { id: `u${i}`, role: 'user' }, parts: [{ type: 'text', text: `Request ${i + 1}: inspect the project.` }] },
  { info: { id: `a${i}`, role: 'assistant' }, parts: [
    { id: `tool${i}`, type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: `src/example-${i}.ts` }, output: i === 5 ? 'Line of file content.\n'.repeat(100) : 'File contents belong inside the work card.' } },
    { id: `prose${i}`, type: 'text', text: `Helpful explanation for request ${i + 1}. The result is ready to inspect.\n\nThis prose should remain readable outside the expandable work card.${i === 11 ? '\n\nMore transcript below the last work card. '.repeat(80) : ''}` },
  ] },
]).flat();
initial.find((message) => message.info.id === 'a5')!.parts.unshift(...Array.from({ length: 10 }, (_, index) => ({
  id: `extra-tool-${index}`, type: 'tool', tool: 'read',
  state: { status: 'completed', input: { filePath: `src/extra-${index}.ts` }, output: 'Additional file contents.' },
})));
initial.find((message) => message.info.id === 'a5')!.parts.splice(10, 0,
  { id: 'delegate-start', callID: 'delegate-start', type: 'tool', tool: 'delegate', state: { status: 'completed', input: { agentID: 'researcher' }, metadata: { sessionId: 'child-five', agentName: 'Researcher', selected_model: 'opencode/free', freelancer_status: 'running' } } },
  { id: 'delegate-callback', callID: 'delegate-callback', type: 'tool', tool: 'delegate', state: { status: 'completed', input: { worker: 'child-five' }, metadata: { sessionId: 'child-five', agentName: 'Researcher', freelancer_status: 'completed' }, output: JSON.stringify({ attempts: [{ child_session: 'child-five', selected_model: 'opencode/free' }] }) } },
);
function Fixture() {
  const [messages, setMessages] = useState(initial), [session, setSession] = useState('one'), [draft, setDraft] = useState(''), [busy, setBusy] = useState(false), [details, setDetails] = useState('changes'), [child, setChild] = useState('');
  const add = () => { setBusy(true); setMessages(rows => [...rows, { info: {id: `stream-${rows.length}`, role:'assistant'}, parts:[{type:'text',text:'New streamed prose. '.repeat(35)}]}]); };
  return <main style={{height:'100vh', display:'flex', flexDirection:'column'}}>
    <nav style={{padding:12,display:'flex',gap:12}} aria-label="Fixture controls">
      <button onClick={add}>Append response</button>
      <button onClick={() => { setMessages([{ info: { id: 'first-user', role: 'user' }, parts: [{ type: 'text', text: 'Start a new conversation.' }] }, { info: { id: 'first-tool', role: 'assistant' }, parts: [{ id: 'first-read', type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: 'src/first.ts' }, output: 'First tool output.' } }] }]); }}>Show first tool</button>
      <button onClick={() => { setBusy(true); setMessages(rows => [...rows, { info: { id: `live-${rows.length}`, role: 'assistant' }, parts: [{ id: `live-tool-${rows.length}`, type: 'tool', tool: 'read', state: { status: 'running', input: { filePath: 'src/live-update.ts' } } }] }]); }}>Append tool</button>
      <button onClick={() => { setSession(session === 'one' ? 'two' : 'one'); setMessages(initial); setBusy(false); }}>Switch chat</button>
      <button onClick={() => setMessages(rows => [...rows, {info:{id:'helper',role:'assistant'},parts:[{id:'delegate',type:'tool',tool:'delegate',state:{status:'completed',input:{agentID:'researcher'},metadata:{agentName:'Researcher',selected_model:'opencode/free',sessionId:'child-fixture'}}}]}])}>Add helper</button>
      <span role="status">{child ? `Opened ${child}` : 'Presentation fixture · no model inference'}</span>
    </nav>
    <div className="conversation-layout with-details">
      <Chat data={data} messages={messages} todos={[]} session={{id:session}} busy={busy} draft={draft} setDraft={setDraft} model="" setModel={() => {}} onSend={() => {}} onStop={() => setBusy(false)} onChild={setChild} onWorkflow={() => {}} agentID="engineer" setAgentID={() => {}} workflowID="build" onOpenDetails={setDetails} />
      <Details chat={{title:'Chat presentation fixture',diff:[{file:'src/example.ts',scope:'workspace',additions:3,deletions:1,status:'modified'}]}} requestTab={details} onChild={setChild} />
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
