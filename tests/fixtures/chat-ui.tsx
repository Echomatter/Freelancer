import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Chat } from '../../src/Chat';
import { Details } from '../../src/WorkspacePanels';
import { workspaceCatalog } from '../../domain/workspace.mjs';
import '../../src/styles.css';
const settings = workspaceCatalog({});
const data = { settings, snapshot: {}, models: [], providers: { all: [], connected: [] } };
const initial = Array.from({length: 12}, (_, i) => [
  { info: { id: `u${i}`, role: 'user' }, parts: [{ type: 'text', text: `Request ${i + 1}: inspect the project.` }] },
  { info: { id: `a${i}`, role: 'assistant' }, parts: [
    { id: `tool${i}`, type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: `src/example-${i}.ts` }, output: 'File contents belong inside the work card.' } },
    { id: `prose${i}`, type: 'text', text: `Helpful explanation for request ${i + 1}. The result is ready to inspect.\n\nThis prose should remain readable outside the expandable work card.` },
  ] },
]).flat();
function Fixture() {
  const [messages, setMessages] = useState(initial), [session, setSession] = useState('one'), [draft, setDraft] = useState(''), [busy, setBusy] = useState(false), [details, setDetails] = useState('changes'), [child, setChild] = useState('');
  const add = () => { setBusy(true); setMessages(rows => [...rows, { info: {id: `stream-${rows.length}`, role:'assistant'}, parts:[{type:'text',text:'New streamed prose. '.repeat(35)}]}]); };
  return <main style={{height:'100vh', display:'flex', flexDirection:'column'}}>
    <nav style={{padding:12,display:'flex',gap:12}} aria-label="Fixture controls">
      <button onClick={add}>Append response</button>
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
