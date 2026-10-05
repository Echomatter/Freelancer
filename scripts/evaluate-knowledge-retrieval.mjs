import { createTypeSafeJudgmentProvider } from '../server/data/judgment-provider.mjs';

// Synthetic acceptance corpus only. It deliberately exercises provenance cases
// without sending any project, chat, or user-authored warehouse data.
const scenarios = [
  { id:'exact_id', query:'Which retry failure is identified by code ERR-413?', positive:'exact_match', candidates:{
    exact_match:{reference:'fixture:exact-id#L1',projectID:'synthetic-a',path:'errors.md',status:'current',text:'ERR-413: request payload too large; split the batch before retrying.'},
    near_match:{reference:'fixture:near-id#L1',projectID:'synthetic-a',path:'errors.md',status:'current',text:'ERR-431: remote authentication failed; refresh the provider connection.'},
  } },
  { id:'unicode', query:'What spelling is used for the beverage café?', positive:'unicode_spelling', candidates:{
    unicode_spelling:{reference:'fixture:unicode#L2',projectID:'synthetic-b',path:'glossary.md',status:'current',text:'The product glossary uses “café” with the accented e.'},
    ascii_spelling:{reference:'fixture:ascii#L2',projectID:'synthetic-b',path:'glossary.md',status:'current',text:'The unrelated search test fixture uses the ASCII spelling cafe.'},
  } },
  { id:'paraphrase', query:'How does the sender avoid duplicating input when delivery is uncertain?', positive:'ack_boundary', candidates:{
    ack_boundary:{reference:'fixture:ack#L4-L7',projectID:'synthetic-c',path:'sender.md',status:'current',text:'Clear the captured editor generation only after the native send is acknowledged; preserve newer typing and inspect uncertain deliveries before replay.'},
    autosave:{reference:'fixture:draft#L1-L3',projectID:'synthetic-c',path:'drafts.md',status:'current',text:'Drafts save continuously while the user types and restore when a window is reopened.'},
  } },
  { id:'contradiction_current', query:'What is the current default delivery behavior?', positive:'current_policy', candidates:{
    current_policy:{reference:'fixture:policy-v4#L1-L5',projectID:'synthetic-d',path:'delivery.md',status:'current',validFrom:'2026-09-20',text:'Current policy: uncertain delivery is inspected before any retry; the system does not automatically replay.'},
    superseded_policy:{reference:'fixture:policy-v2#L1-L3',projectID:'synthetic-d',path:'delivery.md',status:'superseded',validTo:'2026-09-19',text:'Old policy: automatically retry a send when its acknowledgement is missing.'},
  } },
  { id:'historical_revision', query:'What value did the record contain before the correction on 2026-09-18?', positive:'old_revision', candidates:{
    old_revision:{reference:'fixture:claim-rev1#L2',projectID:'synthetic-e',path:'claim-history.md',status:'historical',validTo:'2026-09-18',text:'Revision 1, captured 2026-09-12: retry_limit was 2.'},
    current_revision:{reference:'fixture:claim-rev2#L2',projectID:'synthetic-e',path:'claim-history.md',status:'current',validFrom:'2026-09-18',text:'Revision 2, corrected 2026-09-18: retry_limit is 3.'},
  } },
  { id:'retained_chat', query:'What did the retained conversation say about keeping capture time separate from source time?', positive:'chat_snapshot', candidates:{
    chat_snapshot:{reference:'fixture:session-4@rev-2#msg-7',projectID:'synthetic-f',path:'conversation snapshot',status:'retained',capturedAt:'2026-08-02T09:30:00Z',text:'Keep the original source time separate from capture time; record this capture as a separate later snapshot revision.'},
    nearby_chat:{reference:'fixture:session-8@rev-1#msg-3',projectID:'synthetic-f',path:'conversation snapshot',status:'retained',text:'The message discusses timestamp formatting in a log parser, not conversation capture time.'},
  } },
  { id:'missing_source', query:'Can the original unavailable source text be read?', positive:'missing_placeholder', candidates:{
    missing_placeholder:{reference:'fixture:missing-2',projectID:'synthetic-g',path:'conversation snapshot',status:'missing-source-placeholder',text:'Original source is unavailable. This placeholder preserves the source identity; it contains no captured conversation text.'},
    fabricated_content:{reference:'fixture:guess-2',projectID:'synthetic-g',path:'conversation snapshot',status:'unverified',text:'The unavailable conversation probably said to migrate the project data carefully.'},
  } },
  { id:'multi_project', query:'In project alpha, what is the connection timeout in config.json?', positive:'alpha_config', candidates:{
    alpha_config:{reference:'fixture:alpha-config#L8',projectID:'project-alpha',path:'config.json',status:'current',text:'connection.timeoutMs = 18000'},
    beta_config:{reference:'fixture:beta-config#L8',projectID:'project-beta',path:'config.json',status:'current',text:'connection.timeoutMs = 4000'},
  } },
];

const state={
  purpose:'Synthetic retrieval relevance evaluation. Candidate references and content are fabricated fixtures, not user data.',
  queries:Object.fromEntries(scenarios.map(({id,query})=>[id,query])),
  candidates:Object.fromEntries(scenarios.map(({id,candidates})=>[id,candidates])),
};
const definitions=scenarios.flatMap(scenario=>Object.keys(scenario.candidates).map(candidateID=>({
  questionID:`${scenario.id}__${candidateID}`,
  primitive:'score',
  question:{task:'Judge retrieval relevance for this exact query and candidate. Respect project identity, source status, revision time, exact identifiers, Unicode, and explicit missing-source placeholders. A missing source is relevant to a question about availability but never supports invented source content.',
    query:scenario.query,candidateID,candidatePath:`state.candidates.${scenario.id}.${candidateID}`},
  criteria:{levels:['Poor: unrelated, contradicted, wrong project, wrong time period, or unsupported by the referenced source.','Partial: related but lacks the requested identity, scope, time, or direct answer.','Strong: directly answers the query with matching provenance, scope, identity, and time.']},
})));

const provider=createTypeSafeJudgmentProvider();
if(!provider.status().configured) throw Error('Set TYPESAFE_API_KEY in the runtime environment to run the synthetic evaluation.');
const run=await provider.evaluateMany({definitions,state});
if(run.status!=='ok') throw Error(`TypeSafe evaluation ${run.status}: ${run.failure??'unknown provider error'}`);
const scores=new Map(run.results.map(result=>[result.questionID,result.answer.score]));
const cases=scenarios.map(scenario=>{
  const entries=Object.keys(scenario.candidates).map(candidateID=>({candidateID,score:scores.get(`${scenario.id}__${candidateID}`)}));
  if(entries.some(entry=>!Number.isFinite(entry.score))) throw Error(`Missing score for ${scenario.id}.`);
  entries.sort((a,b)=>b.score-a.score||a.candidateID.localeCompare(b.candidateID));
  const positiveRank=entries.findIndex(entry=>entry.candidateID===scenario.positive)+1;
  const positiveScore=entries.find(entry=>entry.candidateID===scenario.positive).score;
  const negativeScore=entries.find(entry=>entry.candidateID!==scenario.positive).score;
  return {id:scenario.id,positiveRank,positiveScore,negativeScore,correctTop1:positiveScore>negativeScore};
});
const top1=cases.reduce((sum,item)=>sum+(item.positiveScore>item.negativeScore?1:item.positiveScore===item.negativeScore?0.5:0),0)/cases.length;
const mrr=cases.reduce((sum,item)=>sum+(item.positiveScore>item.negativeScore?1:item.positiveScore===item.negativeScore?0.75:0.5),0)/cases.length;
process.stdout.write(JSON.stringify({evaluation:'synthetic-knowledge-retrieval-v1',status:'complete',provider:run.reportedProvider,
  requestedModel:run.requestedModel,reportedModel:run.reportedModel,latencyMs:run.latencyMs,usage:run.usage,
  cases:cases.length,candidatePairs:definitions.length/2,top1Accuracy:top1,meanReciprocalRank:mrr,caseResults:cases},null,2));
