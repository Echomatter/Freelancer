// Request-scoped evaluation descriptions. These are not database schemas or executable code.
export const EVALUATION_LIMITS = Object.freeze({ contractBytes: 120000, packetBytes: 120000,
  receiptBytes: 900000, selectors: 20, inputs: 100, rows: 500, derivations: 50,
  scenarios: 10, questions: 20, stages: 5, expressions: 2000, depth: 12, receipts: 32, ttlMs: 3600000 });
export const fail = message => { throw Object.assign(Error(message), { status: 400, code: 'INVALID_EVALUATION' }); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const own = (value,key) => Object.hasOwn(value,key);
const unsafe = key => ['__proto__','prototype','constructor'].includes(key);
export const identifier = (value,label='ID') => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) fail(`${label} must be a bounded readable identifier.`);
  return value;
};
const text = (value,label,max=2000) => { if(typeof value!=='string'||!value.trim()||value.length>max) fail(`${label} requires bounded text.`); };
const list = (value,label,max) => { if(!Array.isArray(value)||value.length>max) fail(`${label} must be an array with at most ${max} entries.`); };
const keys = (value,allowed,label) => { if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key)||unsafe(key))) fail(`${label} contains unsupported fields.`); };
export function assertSafeEvaluationData(value) {
  let nodes=0;
  const visit=(item,depth)=>{
    if(++nodes>20000||depth>24) fail('Evaluation data is too deeply nested or large.');
    if(typeof item==='number'&&!Number.isFinite(item)) fail('Evaluation values must be finite JSON numbers.');
    if(typeof item==='string'&&(/Bearer\s+\S+/i.test(item)||/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(item)||/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[A-Z0-9]{16})\b/.test(item))) fail('Secret material cannot enter an evaluation packet.');
    if(item===null||['string','boolean','number'].includes(typeof item)) return;
    if(Array.isArray(item)) { for(const child of item) visit(child,depth+1);return; }
    if(!object(item)) fail('Evaluation values must be JSON data.');
    for(const [key,child] of Object.entries(item)) {
      if(unsafe(key)||/^(authorization|api[-_]?key|password|secret|access[_-]?token|refresh[_-]?token|credentials?|headers|env)$/i.test(key)) fail('Secret or unsafe fields cannot enter an evaluation packet.');
      visit(child,depth+1);
    }
  };
  visit(value,0);
}
export function readPath(value,path='') {
  if(typeof path!=='string'||path.length>300||path.split('.').some(unsafe)) fail('A projection path is invalid.');
  if(!path) return value;
  for(const part of path.split('.')) {
    if(!part||value===null||typeof value!=='object'||!own(value,part)) return null;
    value=value[part];
  }
  return value===undefined?null:value;
}
const ops=new Set(['add','subtract','multiply','divide','min','max','sum','count','eq','ne','lt','lte','gt','gte','and','or','not','if','project','filter','join']);
export function expressionRefs(expr,refs=new Set(),depth=0) {
  if(depth>EVALUATION_LIMITS.depth||!object(expr)) fail('Expressions require bounded JSON expression nodes.');
  if(own(expr,'ref')) { keys(expr,['ref','path'],'Reference'); identifier(expr.ref,'Input reference');readPath({},expr.path??'');refs.add(expr.ref); }
  else if(own(expr,'row')) {keys(expr,['row'],'Row reference');readPath({},expr.row);}
  else if(own(expr,'value')) keys(expr,['value'],'Literal');
  else {
    if(!ops.has(expr.op)) fail('Expression operation is unsupported.');
    if(expr.op==='project') { keys(expr,['op','input','fields'],'Projection');expressionRefs(expr.input,refs,depth+1);if(!object(expr.fields)||Object.keys(expr.fields).length>30) fail('Projection requires at most 30 fields.');for(const [key,path] of Object.entries(expr.fields)){identifier(key,'Projection name');readPath({},path);} }
    else if(expr.op==='filter') {keys(expr,['op','input','where'],'Filter');expressionRefs(expr.input,refs,depth+1);expressionRefs(expr.where,refs,depth+1);}
    else if(expr.op==='join') {keys(expr,['op','left','right','leftKey','rightKey','how'],'Join');expressionRefs(expr.left,refs,depth+1);expressionRefs(expr.right,refs,depth+1);if(typeof expr.leftKey!=='string'||typeof expr.rightKey!=='string')fail('Join requires explicit key paths.');readPath({},expr.leftKey);readPath({},expr.rightKey);if(!['left','inner'].includes(expr.how??'inner')) fail('Join must be left or inner.');}
    else {keys(expr,['op','args'],'Expression');list(expr.args,'Expression arguments',30);for(const arg of expr.args) expressionRefs(arg,refs,depth+1);}
  }
  return refs;
}
export function evaluateExpression(expr,entries,{row=null,warnings=[],budget={remaining:EVALUATION_LIMITS.expressions}}={}) {
  if(--budget.remaining<0) fail('Deterministic expression work exceeded its bound.');
  const warning=message=>{if(warnings.length<100&&!warnings.includes(message))warnings.push(message);return null;};
  const run=(child,nextRow=row)=>evaluateExpression(child,entries,{row:nextRow,warnings,budget});
  if(own(expr,'ref')) {const entry=entries[expr.ref];return entry?readPath(entry.value,expr.path??''):warning(`Missing input ${expr.ref}.`);}
  if(own(expr,'row')) return readPath(row,expr.row);
  if(own(expr,'value')) return expr.value;
  if(['project','filter'].includes(expr.op)) {
    const rows=run(expr.input);if(!Array.isArray(rows)) return warning(`${expr.op} needs an array; unknown input retained.`);
    if(rows.length>EVALUATION_LIMITS.rows) fail('Projection/filter row bound exceeded.');
    if(expr.op==='project') return rows.map(item=>Object.fromEntries(Object.entries(expr.fields).map(([key,path])=>[key,readPath(item,path)])));
    const result=[];for(const item of rows){const decision=run(expr.where,item);if(decision===true)result.push(item);else if(decision===null)warning('Filter contains unknown decisions; the returned array is incomplete.');else if(decision!==false)fail('Filter criteria must return a boolean or unknown.');}return result;
  }
  if(expr.op==='join') {
    const left=run(expr.left),right=run(expr.right);if(!Array.isArray(left)||!Array.isArray(right))return warning('Join inputs are unknown or not arrays.');
    if(left.length+right.length>EVALUATION_LIMITS.rows)fail('Join input row bound exceeded.');
    const result=[];for(const l of left){let matched=false;const key=readPath(l,expr.leftKey);for(const r of right){if(--budget.remaining<0)fail('Join work exceeded its bound.');const other=readPath(r,expr.rightKey);if(key!==null&&other!==null&&JSON.stringify(key)===JSON.stringify(other)){result.push({left:l,right:r});matched=true;}if(result.length>EVALUATION_LIMITS.rows)fail('Join output row bound exceeded.');}if(!matched&&(expr.how??'inner')==='left')result.push({left:l,right:null});}return result;
  }
  // Conditional branches are lazy. Unknown conditions do not invent a branch.
  if(expr.op==='if'){if(expr.args.length!==3)fail('if requires condition, true and false branches.');const condition=run(expr.args[0]);if(condition===null)return warning('Conditional condition is unknown.');if(typeof condition!=='boolean')fail('Conditional condition must be boolean.');return run(expr.args[condition?1:2]);}
  const args=expr.args.map(arg=>run(arg));
  if(expr.op==='count'){if(args.length!==1||!Array.isArray(args[0]))return warning('Count requires a known array.');return args[0].length;}
  if(args.some(value=>value===null))return warning(`Unknown value in ${expr.op}; no value imputed.`);
  if(['eq','ne'].includes(expr.op)){if(args.length!==2)fail('Equality needs two inputs.');const same=JSON.stringify(args[0])===JSON.stringify(args[1]);return expr.op==='eq'?same:!same;}
  if(['and','or','not'].includes(expr.op)){if(args.some(value=>typeof value!=='boolean')||(expr.op==='not'&&args.length!==1)||!args.length)fail('Boolean expression has invalid arguments.');return expr.op==='not'?!args[0]:expr.op==='and'?args.every(Boolean):args.some(Boolean);}
  const numbers=expr.op==='sum'&&args.length===1&&Array.isArray(args[0])?args[0]:args;
  if(numbers.some(value=>value===null))return warning('Arithmetic includes unknown values; no value imputed.');
  if(!numbers.length||numbers.some(value=>typeof value!=='number'||!Number.isFinite(value)))fail('Arithmetic and ordered comparisons require finite numbers.');
  if(['subtract','divide','lt','lte','gt','gte'].includes(expr.op)&&numbers.length!==2)fail('Binary expression requires exactly two numbers.');
  let result;
  switch(expr.op){case'add':case'sum':result=numbers.reduce((a,b)=>a+b,0);break;case'subtract':result=numbers[0]-numbers[1];break;case'multiply':result=numbers.reduce((a,b)=>a*b,1);break;case'divide':if(numbers[1]===0)return warning('Division by zero is unknown.');result=numbers[0]/numbers[1];break;case'min':result=Math.min(...numbers);break;case'max':result=Math.max(...numbers);break;case'lt':return numbers[0]<numbers[1];case'lte':return numbers[0]<=numbers[1];case'gt':return numbers[0]>numbers[1];case'gte':return numbers[0]>=numbers[1];default:fail('Unsupported arithmetic.');}
  return Number.isFinite(result)?result:warning('Arithmetic result exceeds finite range.');
}
export function validateComposition(value=[]) {
  list(value,'Composition',20);const ids=new Set();
  for(const item of value){keys(item,['id','terms','scale'],'Composition');identifier(item.id);if(ids.has(item.id))fail('Composition IDs must be unique.');ids.add(item.id);list(item.terms,'Composition terms',20);if(!item.terms.length)fail('Composition needs declared terms.');keys(item.scale,['min','max','units'],'Output scale');if(!Number.isFinite(item.scale.min)||!Number.isFinite(item.scale.max)||item.scale.max<=item.scale.min)fail('Composition output scale must declare increasing finite min/max.');text(item.scale.units,'Composition units',100);
    if(!Number.isFinite(item.scale.max-item.scale.min))fail('Composition output range must have a finite span.');
    for(const term of item.terms){keys(term,['questionID','field','weight','range','mapping'],'Composition term');identifier(term.questionID);if(!['score','probabilityYes','choice'].includes(term.field)||!Number.isFinite(term.weight)||term.weight<0)fail('Composition needs an answer field and nonnegative finite weight.');if(!Array.isArray(term.range)||term.range.length!==2||!term.range.every(Number.isFinite)||term.range[1]<=term.range[0]||!Number.isFinite(term.range[1]-term.range[0]))fail('Every composition term requires its explicit increasing numeric range with finite span.');if(term.field==='choice'&&(!object(term.mapping)||!Object.values(term.mapping).every(Number.isFinite)))fail('Choice composition needs an explicit numeric mapping.');}
    const weightTotal=item.terms.reduce((sum,term)=>sum+term.weight,0);if(!Number.isFinite(weightTotal)||weightTotal<=0)fail('Composition must have positive finite total weight.');
  }
  return value;
}
export function validateEvaluationContract(input) {
  assertSafeEvaluationData(input);if(Buffer.byteLength(JSON.stringify(input),'utf8')>EVALUATION_LIMITS.contractBytes)fail('Evaluation contract exceeds 120 KB.');
  keys(input,['version','name','evidence','supplied','derivations','scenarios','questions','composition','model'],'Contract');if(input.version!==1)fail('Evaluation contract version must be 1.');if(input.name!==undefined)text(input.name,'Evaluation name',200);if(input.model!==undefined)text(input.model,'Requested Jev model',300);
  const contract=structuredClone({evidence:[],supplied:[],derivations:[],scenarios:[],questions:[],composition:[],...input});
  list(contract.evidence,'Evidence selectors',20);list(contract.supplied,'Supplied entries',100);list(contract.derivations,'Derivations',50);list(contract.scenarios,'Scenarios',10);list(contract.questions,'Questions',20);
  const ids=new Set(),add=id=>{identifier(id);if(ids.has(id))fail(`Duplicate packet ID ${id}.`);ids.add(id);};
  for(const selector of contract.evidence){keys(selector,['id','source','recordID','domain','revision','attributes','fields','limit','query','filters'],'Evidence selector');add(selector.id);if(selector.source==='knowledge')selector.source='memory';if(!['catalog','memory','query'].includes(selector.source))fail('Choose a known evidence source.');if(selector.source!=='query')text(selector.recordID,'Stored record ID',2000);if(selector.domain==='facts')selector.domain='memories';if(selector.source==='memory'&&selector.domain!=='memories')fail('Exact retained evidence supports memories.');if(selector.source==='query'&&!['memories','files','conversations'].includes(selector.domain))fail('Choose a known query domain.');if(selector.source==='query'){if(typeof selector.query!=='string'||selector.query.length>200)fail('Query requires bounded text.');if(!selector.fields?.length)fail('Query evidence requires explicit projected fields.');}
    if(selector.revision!==undefined&&(!Number.isSafeInteger(selector.revision)||selector.revision<1||selector.source!=='memory'||selector.domain!=='memories'))fail('Revision requires a positive exact memory revision.');
    for(const field of ['attributes','fields'])if(selector[field]!==undefined){list(selector[field],field,30);for(const path of selector[field]){text(path,field,300);readPath({},path);}}
    if(selector.attributes&&selector.source!=='catalog')fail('Attributes apply only to catalog observations.');
    if(selector.limit!==undefined&&(!Number.isInteger(selector.limit)||selector.limit<1||selector.limit>(selector.source==='query'?50:200)))fail('Evidence row limit is invalid.');
    if(selector.filters!==undefined){if(selector.source!=='query')fail('Filters apply to query selectors only.');keys(selector.filters,['phrase','model','modelProvider','source','role','status','kind','includeArchived','epistemicState','origin','includeHistorical','projectID','projectDirectory','global'],'Query filters');}
    const forbidden=selector.source==='catalog'?['domain','revision','query','filters']:selector.source==='memory'?['attributes','query','filters']:['recordID','revision','attributes'];
    if(forbidden.some(key=>selector[key]!==undefined))fail('Evidence selector fields do not match the chosen source adapter.');
  }
  for(const entry of contract.supplied){keys(entry,['id','kind','value','provenance','dates'],'Supplied entry');add(entry.id);if(!['supplied','assumption','preference'].includes(entry.kind)||!own(entry,'value'))fail('Supplied entries require a declared kind and value.');}
  for(const derivation of contract.derivations){keys(derivation,['id','expression','description','subjective','units','scale'],'Derivation');const refs=expressionRefs(derivation.expression);for(const ref of refs)if(!ids.has(ref))fail(`Derivation references unavailable input ${ref}.`);add(derivation.id);if(derivation.subjective!==undefined&&typeof derivation.subjective!=='boolean')fail('Subjective must be boolean.');if(derivation.description!==undefined)text(derivation.description,'Derivation description');}
  const scenarios=new Set();for(const scenario of contract.scenarios){keys(scenario,['id','overlays'],'Scenario');identifier(scenario.id);if(scenarios.has(scenario.id)||scenario.id==='base')fail('Scenario IDs must be unique and not base.');scenarios.add(scenario.id);list(scenario.overlays,'Scenario overlays',30);const targets=new Set();for(const overlay of scenario.overlays){keys(overlay,['id','target','value','when','kind','reason'],'Overlay');identifier(overlay.id);if(!ids.has(overlay.target)||targets.has(overlay.target)||!['assumption','preference'].includes(overlay.kind)||!own(overlay,'value'))fail('Overlay requires one known target, declared kind and value.');targets.add(overlay.target);text(overlay.reason,'Overlay reason');if(overlay.when)for(const ref of expressionRefs(overlay.when))if(!ids.has(ref))fail('Overlay references unavailable input.');}}
  const qids=new Map();for(const q of contract.questions){keys(q,['id','primitive','instructions','criteria','inputs','scenario','stage','dependsOn'],'Question');identifier(q.id);if(qids.has(q.id))fail('Question IDs must be unique.');qids.set(q.id,q);text(q.instructions,'Full question instructions',10000);if(!['check','classify','score'].includes(q.primitive))fail('Choose check, classify or score.');list(q.inputs,'Question inputs',100);if(!q.inputs.length)fail('Questions require explicit selected evidence.');for(const id of q.inputs)if(!ids.has(id))fail(`Question input ${id} is unavailable.`);if(q.scenario!==undefined&&q.scenario!=='base'&&!scenarios.has(q.scenario))fail('Question scenario is unavailable.');if(q.stage!==undefined&&(!Number.isInteger(q.stage)||q.stage<0||q.stage>=5))fail('Question stage must be 0 through 4.');list(q.dependsOn??[],'Question dependencies',20);
    if(q.primitive==='check'){keys(q.criteria,['yes','no'],'Check criteria');if(!own(q.criteria,'yes')||!own(q.criteria,'no'))fail('Check requires explicit yes/no criteria.');}
    else if(q.primitive==='classify'){keys(q.criteria,['options'],'Choice criteria');if(!object(q.criteria.options)||Object.keys(q.criteria.options).length<1||Object.keys(q.criteria.options).length>20)fail('Choice requires a bounded option map.');for(const key of Object.keys(q.criteria.options))if(unsafe(key))fail('Unsafe choice key.');}
    else{keys(q.criteria,['levels'],'Score criteria');list(q.criteria.levels,'Score levels',10);if(q.criteria.levels.length<2)fail('Score needs at least two ordered rubric levels.');}
    const descriptions=q.primitive==='check'?[q.criteria.yes,q.criteria.no]:q.primitive==='classify'?Object.values(q.criteria.options):q.criteria.levels;for(const description of descriptions)text(description,'Explicit criterion',4000);
  }
  for(const q of contract.questions)for(const dependency of q.dependsOn??[]){const prior=qids.get(dependency);if(!prior||(prior.stage??0)>=(q.stage??0))fail('Dependent questions require an explicit later stage.');}
  validateComposition(contract.composition);for(const item of contract.composition)for(const term of item.terms)if(!qids.has(term.questionID))fail('Composition references an unavailable question.');
  return contract;
}
