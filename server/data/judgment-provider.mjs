import { isDeepStrictEqual } from 'node:util';
import { TypeSafeClient, choice, noul, score } from '@typesafe-ai/sdk';

// TypeSafe defines a full distribution and a probability-weighted Score.
// Keep distribution/ordinary arithmetic validation strict. Live Jev responses
// also report hundredth-resolution scores and bins whose displayed mean can
// differ by a few hundredths; the bounded policy below handles that separately.
const numericTolerance = 1e-6;
const hundredthResolution = value => Math.abs(value * 100 - Math.round(value * 100)) <= numericTolerance;
function hundredthScoreBounds(probabilities) {
  // Solve the smallest/largest possible mean of bins rounded to hundredths,
  // subject to a unit-sum underlying distribution. At most ten bins are used.
  const lower = probabilities.map(value => Math.max(0, value - 0.005));
  const upper = probabilities.map(value => Math.min(1, value + 0.005));
  const remaining = 1 - lower.reduce((sum, value) => sum + value, 0);
  const extreme = descending => {
    let mass = remaining, mean = lower.reduce((sum, value, index) => sum + index * value, 0);
    for (let offset = 0; offset < lower.length; offset++) {
      const index = descending ? lower.length - 1 - offset : offset;
      const addition = Math.min(mass, upper[index] - lower[index]);
      mean += index * addition;
      mass = Math.max(0, mass - addition);
    }
    return mean;
  };
  // The reported score can itself have been rounded to hundredths.
  return { min: Math.max(0, extreme(false) - 0.005), max: Math.min(lower.length - 1, extreme(true) + 0.005) };
}
const aliases = new Set(['jev-latest', 'jev-preview']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = (message, reason = 'invalid-answer') => Object.assign(new Error(message), { judgmentFailure: reason });
const boundedText = (value, secret, limit = 400) => String(value ?? 'Provider request failed.')
  .split(secret || '\0').join('[redacted]')
  .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
  .replace(/(api[ _-]?key|token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
  .slice(0, limit);

const checkAborted = signal => {
  if (signal?.aborted) throw Object.assign(new Error('Judgment request was cancelled.'), { name: 'AbortError' });
};

// Capture JSON inputs before awaiting the provider so a caller cannot change the
// rubric against which an in-flight answer is validated.
function captureEntry(value, label) {
  if (value !== null && typeof value !== 'string' && typeof value !== 'object')
    throw invalid(label + ' must be text, a JSON object or array, or null.', 'invalid-definition');
  const seen = new Set();
  let entries = 0;
  const visit = (item, depth = 0) => {
    if (++entries > 30_000 || depth > 50) throw invalid(label + ' exceeds its structure limit.', 'invalid-definition');
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) return;
    if (!record(item) && !Array.isArray(item)) throw invalid(label + ' must contain JSON values.', 'invalid-definition');
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null)
      throw invalid(label + ' must contain JSON objects.', 'invalid-definition');
    if (seen.has(item)) throw invalid(label + ' must not contain cycles.', 'invalid-definition');
    seen.add(item);
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index++) visit(item[index], depth + 1);
    } else {
      for (const child of Object.values(item)) visit(child, depth + 1);
    }
    seen.delete(item);
  };
  visit(value);
  return JSON.parse(JSON.stringify(value));
}

/** Validate and capture Freelancer's check/classify/score definition vocabulary. */
export function validateTypeSafeJudgmentDefinition(definition) {
  if (!record(definition) || typeof definition.questionID !== 'string' || !definition.questionID.trim() || definition.questionID.length > 200)
    throw invalid('TypeSafe judgment definitions require bounded question IDs.', 'invalid-definition');
  const { primitive } = definition;
  const question = captureEntry(definition.question ?? null, 'Judgment question');
  const criteria = definition.criteria ?? {};
  if (!record(criteria)) throw invalid('Judgment criteria must be a JSON object.', 'invalid-definition');
  let capturedCriteria;
  if (primitive === 'check') {
    capturedCriteria = { yes: captureEntry(criteria.yes ?? null, 'Noul yes criterion'), no: captureEntry(criteria.no ?? null, 'Noul no criterion') };
  } else if (primitive === 'classify') {
    const options = criteria.options ?? criteria;
    if (!record(options) || Object.keys(options).length < 1 || Object.keys(options).length > 255)
      throw invalid('Choice judgments require a nonempty criteria option map with at most 255 options.', 'invalid-definition');
    capturedCriteria = { options: Object.fromEntries(Object.entries(options).map(([key, value]) => [key, captureEntry(value, 'Choice option criterion')])) };
  } else if (primitive === 'score') {
    if (!Array.isArray(criteria.levels) || criteria.levels.length < 2 || criteria.levels.length > 10)
      throw invalid('Score judgments require between two and ten ordered criteria levels.', 'invalid-definition');
    capturedCriteria = { levels: Array.from(criteria.levels, value => captureEntry(value, 'Score level criterion')) };
  } else throw invalid('Unsupported TypeSafe judgment primitive.', 'invalid-definition');
  return { ...definition, question, criteria: capturedCriteria };
}

function questionFor({ primitive, question, criteria }) {
  if (primitive === 'check') return noul(question, { true: criteria.yes, false: criteria.no });
  if (primitive === 'classify') return choice(question, criteria.options);
  return score(question, criteria.levels);
}

function exactKeys(value, keys) {
  return record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function normalizeAnswer(definition, answer) {
  const { primitive, criteria } = definition;
  if (!record(answer) || !Object.hasOwn(answer, 'type')) throw invalid('TypeSafe returned no typed answer.');
  if (primitive === 'check') {
    if (answer.type !== 'noul' || !Object.hasOwn(answer, 'noul') || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1)
      throw invalid('TypeSafe returned an invalid Noul answer.');
    return { answer: { probabilityYes: answer.noul }, probabilities: { yes: answer.noul, no: 1 - answer.noul }, confidence: undefined,
      derived: { primitive: 'check', probabilityYes: answer.noul } };
  }
  const keys = primitive === 'score' ? criteria.levels.map((_, index) => String(index)) : Object.keys(criteria.options);
  const probabilities = answer.probabilities;
  if (!exactKeys(probabilities, keys) || keys.some(key => !Number.isFinite(probabilities[key]) || probabilities[key] < 0 || probabilities[key] > 1))
    throw invalid('TypeSafe returned invalid answer probabilities or option keys.');
  const probabilityTotal = keys.reduce((sum, key) => sum + probabilities[key], 0);
  if (Math.abs(probabilityTotal - 1) > numericTolerance) throw invalid('TypeSafe returned probabilities that do not sum to one.');
  if (!Object.hasOwn(answer, 'confidence') || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1)
    throw invalid('TypeSafe returned invalid answer confidence.');
  const capturedProbabilities = Object.fromEntries(keys.map(key => [key, probabilities[key]]));
  if (primitive === 'score') {
    if (answer.type !== 'score' || !Object.hasOwn(answer, 'score') || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > criteria.levels.length - 1)
      throw invalid('TypeSafe returned an invalid Score answer.');
    if (!exactKeys(answer.legend, keys) || keys.some(key => !isDeepStrictEqual(answer.legend[key], criteria.levels[Number(key)])))
      throw invalid('TypeSafe returned an invalid Score legend.');
    const expectedScore = keys.reduce((sum, key) => sum + Number(key) * probabilities[key], 0);
    const scoreDifference = Math.abs(answer.score - expectedScore);
    // This is a local compatibility policy, not a vendor precision guarantee.
    // Apply it only to coarse hundredth-resolution responses observed live:
    // require a possible unit-sum distribution within half a hundredth of each
    // reported bin, and half a hundredth of score. Other responses stay strict.
    const coarse = hundredthResolution(answer.score) && keys.every(key => hundredthResolution(probabilities[key]));
    const bounds = coarse ? hundredthScoreBounds(keys.map(key => probabilities[key])) :
      { min: expectedScore - numericTolerance * criteria.levels.length, max: expectedScore + numericTolerance * criteria.levels.length };
    if (answer.score < bounds.min - numericTolerance || answer.score > bounds.max + numericTolerance)
      throw invalid('TypeSafe returned a Score inconsistent with its probabilities.');
    const legend = Object.fromEntries(keys.map(key => [key, criteria.levels[Number(key)]]));
    return { answer: { score: answer.score, legend }, probabilities: capturedProbabilities, confidence: answer.confidence,
      derived: { primitive: 'score', score: answer.score,
        ...(scoreDifference > numericTolerance * criteria.levels.length ? { scoreValidation: {
          policy: 'local-hundredth-resolution', expectedFromReportedProbabilities: expectedScore,
          absoluteDifference: scoreDifference, compatibleScoreBounds: bounds,
        } } : {}) } };
  }
  if (answer.type !== 'choice' || !Object.hasOwn(answer, 'choice') || typeof answer.choice !== 'string' || !Object.hasOwn(criteria.options, answer.choice) ||
      keys.some(key => probabilities[key] > probabilities[answer.choice] + numericTolerance))
    throw invalid('TypeSafe returned an invalid Choice answer or selected a lower-probability option.');
  return { answer: { choice: answer.choice }, probabilities: capturedProbabilities, confidence: answer.confidence,
    derived: { primitive: 'classify', choice: answer.choice } };
}

/** Validate one answer without network access; the captured rubric is authoritative. */
export function normalizeTypeSafeJudgmentAnswer(definition, answer) {
  return normalizeAnswer(validateTypeSafeJudgmentDefinition(definition), answer);
}

// The SDK forwards AbortSignal to HTTP. Detach the application wait promptly even
// if an injected transport ignores it; cancellation does not prove remote execution stopped.
function waitForAnswer(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const finish = callback => value => { signal.removeEventListener('abort', aborted); callback(value); };
    const aborted = () => finish(reject)(Object.assign(new Error('Judgment request was cancelled.'), { name: 'AbortError' }));
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(finish(resolve), finish(reject));
    if (signal.aborted) aborted();
  });
}

function capturedUsage(usage) {
  if (usage === undefined) return undefined;
  if (!record(usage) || !Number.isSafeInteger(usage.input_tokens) || usage.input_tokens < 0 || !Number.isSafeInteger(usage.output_tokens) || usage.output_tokens < 0)
    throw invalid('TypeSafe returned invalid token usage.', 'invalid-usage');
  return { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens };
}

export function createTypeSafeJudgmentProvider({ env = process.env, client, clientFactory } = {}) {
  const requestedModel = String(env.TYPESAFE_DEFAULT_MODEL || '').trim() || 'jev-latest';
  const apiKey = String(env.TYPESAFE_API_KEY || '').trim();
  const configured = Boolean(apiKey);
  let instance = client;
  const getClient = () => {
    if (!instance) instance = clientFactory ? clientFactory({ apiKey, defaultModel: requestedModel }) :
      new TypeSafeClient({ apiKey, defaultModel: requestedModel, timeout: 30_000, retry: { maxRetries: 0 }, logLevel: 'off' });
    return instance;
  };
  const evaluateMany = async ({ definitions, state, signal, model = requestedModel }) => {
    const started = Date.now();
    const receipt = { requestedProvider: 'typesafe', requestedModel: model };
    if (!configured) return { ...receipt, status: 'unavailable', latencyMs: 0, failure: 'TYPESAFE_API_KEY is not configured.' };
    let reportedModel = null, usage;
    try {
      checkAborted(signal);
      if (typeof model !== 'string' || !model.trim() || model.length > 300 || model !== model.trim())
        throw invalid('TypeSafe requires a bounded model name.', 'invalid-model');
      if (!Array.isArray(definitions) || !definitions.length || definitions.length > 20)
        throw invalid('A TypeSafe judgment batch must contain between one and twenty question definitions.', 'invalid-definition');
      const captured = definitions.map(validateTypeSafeJudgmentDefinition);
      const ids = captured.map(definition => definition.questionID);
      if (new Set(ids).size !== ids.length) throw invalid('TypeSafe judgment batches require unique question IDs.', 'invalid-definition');
      const questions = Object.fromEntries(captured.map(definition => [definition.questionID, questionFor(definition)]));
      const response = await waitForAnswer(getClient().systemOne({ model, state: captureEntry(state, 'Judgment state'), questions },
        { signal, timeout: 30_000, retry: { maxRetries: 0 } }), signal);
      checkAborted(signal);
      if (!record(response) || !Object.hasOwn(response, 'model') || typeof response.model !== 'string' || !response.model.trim() ||
          response.model.length > 300 || response.model !== response.model.trim() || response.model.includes(apiKey))
        throw invalid('TypeSafe did not report a valid model name.', 'invalid-model');
      reportedModel = response.model;
      usage = capturedUsage(response.usage);
      // Aliases move server-side. The published response schema promises a string,
      // not a version-name grammar or an independently verified alias mapping.
      const modelMatch = aliases.has(model) ? 'alias-response' :
        reportedModel === model ? 'exact' : 'mismatch';
      if (modelMatch === 'mismatch') return { ...receipt, status: 'invalid-response', reportedProvider: 'typesafe', reportedModel,
        modelMatch, failureReason: 'model-mismatch', failure: 'TypeSafe reported a model that does not match the requested model.',
        latencyMs: Date.now() - started, usage, results: [], resultsReusable: false };
      const results = [], failures = [];
      if (!record(response.answers)) throw invalid('TypeSafe returned no typed answer map.');
      for (const definition of captured) {
        try {
          if (!Object.hasOwn(response.answers, definition.questionID)) throw invalid('TypeSafe returned no typed answer for this question.');
          results.push({ questionID: definition.questionID, ...normalizeAnswer(definition, response.answers[definition.questionID]) });
        } catch (error) {
          failures.push({ questionID: definition.questionID, status: 'invalid-response', failureReason: error.judgmentFailure ?? 'invalid-answer', failure: boundedText(error.message, apiKey) });
        }
      }
      const extraCount = Object.keys(response.answers).filter(id => !ids.includes(id)).length;
      if (extraCount) failures.push({ questionID: null, status: 'invalid-response', failureReason: 'unexpected-answers', failure: 'TypeSafe returned answers for unrequested question IDs.', count: extraCount });
      return { ...receipt, status: failures.length ? 'invalid-response' : 'ok', reportedProvider: 'typesafe', reportedModel, modelMatch,
        latencyMs: Date.now() - started, usage, results,
        ...(failures.length ? { partial: results.length > 0, failures, failure: 'TypeSafe returned an incomplete or invalid judgment batch.', resultsReusable: false } : {}) };
    } catch (error) {
      const cancelled = signal?.aborted || error?.name === 'AbortError' || error?.name === 'APIUserAbortError';
      return { ...receipt, status: cancelled ? 'cancelled' : error?.judgmentFailure ? 'invalid-response' : 'provider-failed',
        reportedProvider: reportedModel ? 'typesafe' : null, reportedModel, latencyMs: Date.now() - started, usage, resultsReusable: false,
        failureReason: cancelled ? 'cancelled' : error?.judgmentFailure ?? (error?.name === 'APITimeoutError' ? 'timeout' : 'provider-failed'),
        failure: cancelled ? 'Judgment request was cancelled.' : boundedText(error?.message, apiKey) };
    }
  };
  return {
    status() {
      return configured ? { configured: true, provider: 'typesafe', requestedModel, connectivity: 'not-checked' } :
        { configured: false, provider: 'typesafe', connectivity: 'unavailable', reason: 'TYPESAFE_API_KEY is not configured.' };
    },
    async evaluate({ definition, state, signal, model = requestedModel }) {
      return evaluateMany({ definitions: [definition], state, signal, model });
    },
    evaluateMany,
  };
}
