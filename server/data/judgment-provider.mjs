import { TypeSafeClient, choice, noul, score } from '@typesafe-ai/sdk';

const boundedText = (value, limit = 400) => String(value ?? 'Provider request failed.')
  .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
  .replace(/(api[ _-]?key|token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
  .slice(0, limit);

const checkAborted = signal => {
  if (signal?.aborted) throw Object.assign(new Error('Judgment request was cancelled.'), { name: 'AbortError' });
};

function questionFor(definition) {
  const { primitive, question, criteria = {} } = definition;
  if (primitive === 'check') {
    return noul(question, { true: criteria.yes ?? null, false: criteria.no ?? null });
  }
  if (primitive === 'classify') {
    const options = criteria.options ?? criteria;
    if (!options || Array.isArray(options) || typeof options !== 'object' || Object.keys(options).length < 1)
      throw Error('Choice judgments require a nonempty criteria option map.');
    return choice(question, options);
  }
  if (primitive === 'score') {
    if (!Array.isArray(criteria.levels) || criteria.levels.length < 2 || criteria.levels.length > 10)
      throw Error('Score judgments require between two and ten ordered criteria levels.');
    return score(question, criteria.levels);
  }
  throw Error('Unsupported TypeSafe judgment primitive.');
}

function normalizeAnswer(definition, answer) {
  const { primitive } = definition;
  if (!answer || typeof answer !== 'object') throw Error('TypeSafe returned no typed answer.');
  if (primitive === 'check') {
    if (answer.type !== 'noul' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1)
      throw Error('TypeSafe returned an invalid Noul answer.');
    return { answer: { probabilityYes: answer.noul }, probabilities: { yes: answer.noul, no: 1 - answer.noul }, confidence: undefined,
      derived: { primitive: 'check', probabilityYes: answer.noul } };
  }
  const probabilities = answer.probabilities;
  if (!probabilities || typeof probabilities !== 'object' || Array.isArray(probabilities) ||
      Object.values(probabilities).some(value => !Number.isFinite(value) || value < 0 || value > 1))
    throw Error('TypeSafe returned invalid answer probabilities.');
  const probabilityTotal=Object.values(probabilities).reduce((sum,value)=>sum+value,0);
  if (Math.abs(probabilityTotal-1)>0.02) throw Error('TypeSafe returned probabilities that do not sum to one.');
  if (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1)
    throw Error('TypeSafe returned invalid answer confidence.');
  if (primitive === 'score') {
    if (answer.type !== 'score' || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > definition.criteria.levels.length-1)
      throw Error('TypeSafe returned an invalid Score answer.');
    return { answer: { score: answer.score, legend: answer.legend }, probabilities, confidence: answer.confidence,
      derived: { primitive: 'score', score: answer.score } };
  }
  const options=definition.criteria.options??definition.criteria;
  if (answer.type !== 'choice' || typeof answer.choice !== 'string' || !Object.hasOwn(options,answer.choice))
    throw Error('TypeSafe returned an invalid Choice answer.');
  return { answer: { choice: answer.choice }, probabilities, confidence: answer.confidence,
    derived: { primitive: 'classify', choice: answer.choice } };
}

export function createTypeSafeJudgmentProvider({ env = process.env, client, clientFactory } = {}) {
  const requestedModel = String(env.TYPESAFE_DEFAULT_MODEL || 'jev-latest').trim();
  const configured = Boolean(String(env.TYPESAFE_API_KEY || '').trim());
  let instance = client;
  const getClient = () => {
    if (!configured) return null;
    if (!instance) {
      instance = clientFactory
        ? clientFactory({ apiKey: env.TYPESAFE_API_KEY, defaultModel: requestedModel })
        : new TypeSafeClient({ apiKey: env.TYPESAFE_API_KEY, defaultModel: requestedModel, timeout: 30_000,
          retry: { maxRetries: 0 } });
    }
    return instance;
  };
  return {
    status() {
      return configured ? { configured: true, provider: 'typesafe', requestedModel, connectivity: 'not-checked' } :
        { configured: false, provider: 'typesafe', connectivity: 'unavailable', reason: 'TYPESAFE_API_KEY is not configured.' };
    },
    async evaluate({ definition, state, signal, model = requestedModel }) {
      const result=await this.evaluateMany({definitions:[definition],state,signal,model});
      return result.status==='ok' ? { ...result, results:[result.results[0]] } : result;
    },
    async evaluateMany({ definitions, state, signal, model = requestedModel }) {
      const started = Date.now();
      if (!configured) return { status: 'unavailable', requestedProvider: 'typesafe', requestedModel: model,
        latencyMs: 0, failure: 'TYPESAFE_API_KEY is not configured.' };
      try {
        checkAborted(signal);
        if (!Array.isArray(definitions) || !definitions.length || definitions.length>20)
          throw Error('A TypeSafe judgment batch must contain between one and twenty question definitions.');
        const ids=definitions.map(definition=>definition.questionID);
        if(ids.some(id=>typeof id!=='string'||!id.trim())||new Set(ids).size!==ids.length)
          throw Error('TypeSafe judgment batches require unique question IDs.');
        const questions=Object.fromEntries(definitions.map(definition=>[definition.questionID,questionFor(definition)]));
        const response = await getClient().systemOne({ model, state,
          questions }, { signal, timeout: 30_000, retry: { maxRetries: 0 } });
        checkAborted(signal);
        if (typeof response?.model !== 'string' || !response.model.trim()) throw Error('TypeSafe did not report the model it used.');
        const results=definitions.map(definition=>({questionID:definition.questionID,
          ...normalizeAnswer(definition,response.answers?.[definition.questionID])}));
        return { status: 'ok', requestedProvider: 'typesafe', requestedModel: model,
          reportedProvider: 'typesafe', reportedModel: response.model,
          latencyMs: Date.now() - started, usage: response.usage, results };
      } catch (error) {
        const cancelled = signal?.aborted || error?.name === 'AbortError' || error?.name === 'APIUserAbortError';
        const invalid = /typed answer|probabilities|confidence|reported the model|invalid (?:Noul|Score|Choice)|judgment batch|question IDs|judgments require|criteria option map/i.test(error?.message ?? '');
        return { status: cancelled ? 'cancelled' : invalid ? 'invalid-response' : 'provider-failed',
          requestedProvider: 'typesafe', requestedModel: model,
          reportedProvider: null, reportedModel: null, latencyMs: Date.now() - started,
          failure: boundedText(error?.message) };
      }
    },
  };
}
