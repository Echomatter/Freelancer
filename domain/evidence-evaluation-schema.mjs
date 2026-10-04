// Freelancer's local contract, not a TypeSafe request schema. Runtime validation
// additionally enforces reference/stage relationships, privacy and byte/work bounds.
const text={type:'string',minLength:1,maxLength:2000};
const id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'};
const array=(items,maxItems)=>({type:'array',items,maxItems});
const record=(properties,required)=>({type:'object',properties,required,additionalProperties:false});
const ref=name=>({$ref:'#/$defs/'+name});
export const EVALUATION_SCHEMA={
  $schema:'https://json-schema.org/draft/2020-12/schema',title:'Freelancer evidence evaluation v1',
  ...record({version:{const:1},name:{...text,maxLength:200},model:{...text,maxLength:300},
    evidence:array(ref('selector'),20),supplied:array(ref('supplied'),100),derivations:array(ref('derivation'),50),
    scenarios:array(ref('scenario'),10),questions:array(ref('question'),20),composition:array(ref('composition'),20)},['version']),
  $defs:{
    selector:record({id,source:{enum:['catalog','knowledge','query']},recordID:text,domain:{enum:['files','conversations','facts','memories']},
      revision:{type:'integer',minimum:1},attributes:array({...text,maxLength:300},30),fields:array({...text,maxLength:300},30),
      limit:{type:'integer',minimum:1,maximum:200},query:{type:'string',maxLength:200},filters:ref('filters')},['id','source']),
    filters:record(Object.fromEntries(['model','modelProvider','source','role','status','kind','epistemicState','origin','projectID','projectDirectory'].map(key=>[key,{type:'string'}]).concat(
      ['phrase','pinnedOnly','includeArchived','includeHistorical','global'].map(key=>[key,{type:'boolean'}]))),[]),
    supplied:record({id,kind:{enum:['supplied','assumption','preference']},value:{},provenance:{},dates:{}},['id','kind','value']),
    derivation:record({id,expression:ref('expression'),description:text,subjective:{type:'boolean'},units:{},scale:{}},['id','expression']),
    scenario:record({id,overlays:array(ref('overlay'),30)},['id','overlays']),
    overlay:record({id,target:id,value:{},when:ref('expression'),kind:{enum:['assumption','preference']},reason:text},['id','target','value','kind','reason']),
    question:record({id,primitive:{enum:['check','classify','score']},instructions:{...text,maxLength:10000},criteria:{oneOf:[
      record({yes:{...text,maxLength:4000},no:{...text,maxLength:4000}},['yes','no']),
      record({options:{type:'object',minProperties:1,maxProperties:20,additionalProperties:{...text,maxLength:4000}}},['options']),
      record({levels:{...array({...text,maxLength:4000},10),minItems:2}},['levels'])]},
      inputs:{...array(id,100),minItems:1},scenario:id,stage:{type:'integer',minimum:0,maximum:4},dependsOn:array(id,20)},['id','primitive','instructions','criteria','inputs']),
    composition:record({id,terms:{...array(ref('term'),20),minItems:1},scale:record({min:{type:'number'},max:{type:'number'},units:{...text,maxLength:100}},['min','max','units'])},['id','terms','scale']),
    term:record({questionID:id,field:{enum:['probabilityYes','score','choice']},weight:{type:'number',minimum:0},
      range:{type:'array',items:{type:'number'},minItems:2,maxItems:2},mapping:{type:'object',additionalProperties:{type:'number'}}},['questionID','field','weight','range']),
    expression:{oneOf:[record({ref:id,path:{type:'string',maxLength:300}},['ref']),record({value:{}},['value']),record({row:{type:'string',maxLength:300}},['row']),
      record({op:{enum:['add','subtract','multiply','divide','min','max','sum','count','eq','ne','lt','lte','gt','gte','and','or','not','if']},args:array(ref('expression'),30)},['op','args']),
      record({op:{const:'project'},input:ref('expression'),fields:{type:'object',maxProperties:30,additionalProperties:{type:'string',maxLength:300}}},['op','input','fields']),
      record({op:{const:'filter'},input:ref('expression'),where:ref('expression')},['op','input','where']),
      record({op:{const:'join'},left:ref('expression'),right:ref('expression'),leftKey:{type:'string',maxLength:300},rightKey:{type:'string',maxLength:300},how:{enum:['inner','left']}},['op','left','right','leftKey','rightKey'])]},
  },
};
// Encode adapter-specific requirements explicitly, while reference integrity is
// checked by the deterministic controller after JSON schema validation.
EVALUATION_SCHEMA.$defs.selector.allOf=[
  {if:{properties:{source:{const:'catalog'}}},then:{required:['recordID'],properties:{domain:false,revision:false,query:false,filters:false}}},
  {if:{properties:{source:{const:'knowledge'}}},then:{required:['recordID','domain'],properties:{domain:{enum:['facts','memories']},attributes:false,query:false,filters:false}}},
  {if:{properties:{source:{const:'query'}}},then:{required:['domain','query','fields'],properties:{limit:{type:'integer',minimum:1,maximum:50},fields:{minItems:1},recordID:false,revision:false,attributes:false}}},
];
EVALUATION_SCHEMA.$defs.question.allOf=[['check','yes'],['classify','options'],['score','levels']].map(([primitive,key])=>({
  if:{properties:{primitive:{const:primitive}}},then:{properties:{criteria:{required:[key]}}},
}));
EVALUATION_SCHEMA.$defs.term.allOf=[{
  if:{properties:{field:{const:'choice'}}},then:{required:['mapping']},
}];
