import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Badge, Button, Panel } from './echoflex/Controls';
import { HelpHint } from './HelpHint';
import { ProviderText, providerAttributes } from './ProviderColors';
import './model-cards.css';

const quantity = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const publishedPrice = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });
const tinyNumber = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3 });
const cache = new Map<string, { data: any; at: number }>();
const known = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const value = (cell: any) => known(cell?.value) ? (cell.value !== 0 && Math.abs(cell.value) < 0.01 ? tinyNumber : number).format(cell.value) : '—';
const price = (cell: any) => known(cell?.value) ? '$' + (cell.value !== 0 && Math.abs(cell.value) < 0.000001 ? tinyNumber : publishedPrice).format(cell.value) : '—';
const date = (timestamp: any) => {
  const parsed = new Date(timestamp);
  return timestamp != null && Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString() : 'Unknown date';
};
const url = (input: unknown) => {
  try { const parsed = new URL(String(input)); return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : undefined; }
  catch { return undefined; }
};
const metricTitle = (cell: any) => [cell?.units, cell?.scale?.version && `Scale ${cell.scale.version}`,
  cell?.availability !== 'present' && 'Unavailable in this source'].filter(Boolean).join(' · ');

function CardSources({ summary }: { summary: any }) {
  const records = [summary.deployment, ...summary.ratings].filter(Boolean);
  return <div className="model-card-source-help">
    <p>Model ID: {summary.native.id}</p>
    {summary.deployment && <p>Published deployment prices are USD per million tokens. Account access and billing may differ.</p>}
    {records.map((record: any) => <div key={record.id}>
      <strong>{record.testedName ?? record.name}</strong>
      <p>Retrieved {date(record.retrievedAt)}</p>
      {record.testedName && <p>{['intelligence', 'coding', 'agentic'].map(name =>
        `${name === 'intelligence' ? 'Intelligence' : name === 'coding' ? 'Coding' : 'Agentic'} ${value(record.metrics[`ratings.artificial-analysis.${name}`])}${record.metrics[`ratings.artificial-analysis.${name}`]?.scale?.version ? ` (${record.metrics[`ratings.artificial-analysis.${name}`].scale.version})` : ''}`
      ).join(' · ')}</p>}
      {record.testedName && (known(record.metrics['performance.output_tokens_per_second']?.value) || known(record.metrics['performance.time_to_first_token']?.value)) && <p>
        {known(record.metrics['performance.output_tokens_per_second']?.value) && <span>{value(record.metrics['performance.output_tokens_per_second'])} tokens/s </span>}
        {known(record.metrics['performance.time_to_first_token']?.value) && <span> · {value(record.metrics['performance.time_to_first_token'])}s first token</span>}
      </p>}
      {url(record.url) && <a href={url(record.url)} target="_blank" rel="noreferrer">Open source</a>}
    </div>)}
    {summary.coverage?.partial && <p>Source coverage is partial. Unavailable values are not replaced with zero.</p>}
  </div>;
}

function PublishedFacts({ summary }: { summary: any }) {
  const deployment = summary.deployment;
  const ratings = summary.ratings ?? [];
  return <>
    {deployment && <section className="model-card-prices" aria-label="Published deployment prices">
      <div className="model-card-source-line">
        <a href={url(deployment.url) ?? 'https://models.dev'} target="_blank" rel="noreferrer">models.dev</a>
        <span>USD / 1M tokens</span>
      </div>
      <dl className="model-card-pairs">
        <div><dt>Input</dt><dd>{price(deployment.metrics['pricing.input'])}</dd></div>
        <div><dt>Output</dt><dd>{price(deployment.metrics['pricing.output'])}</dd></div>
      </dl>
      {capturedDates([deployment]) && <span className="model-card-date">Captured {capturedDates([deployment])}</span>}
    </section>}
    {!!ratings.length && <section className="model-card-ratings" aria-label="Published model ratings">
      <div className="model-card-source-line">
        <a href="https://artificialanalysis.ai" target="_blank" rel="noreferrer">Artificial Analysis</a>
        <span>Index scores</span>
      </div>
      {ratings.slice(0, 2).map((record: any) => <div className="model-card-rating" key={record.id}>
        <div className="model-card-configuration" title={record.testedName}>{record.label || record.testedName}</div>
        <dl className="model-card-scores">
          {['intelligence', 'coding', 'agentic'].map(name => {
            const cell = record.metrics[`ratings.artificial-analysis.${name}`];
            return <div key={name}><dt>{name === 'intelligence' ? 'Intelligence' : name === 'coding' ? 'Coding' : 'Agentic'}
              {cell?.scale?.version && <small>{cell.scale.version}</small>}</dt><dd title={metricTitle(cell)}>{value(cell)}</dd></div>;
          })}
        </dl>
        {(known(record.metrics['performance.output_tokens_per_second']?.value) || known(record.metrics['performance.time_to_first_token']?.value)) &&
          <div className="model-card-speed">
            {known(record.metrics['performance.output_tokens_per_second']?.value) && <span>{value(record.metrics['performance.output_tokens_per_second'])} tokens/s</span>}
            {known(record.metrics['performance.time_to_first_token']?.value) && <span>{value(record.metrics['performance.time_to_first_token'])}s first token</span>}
          </div>}
      </div>)}
      {ratings.length > 2 && <span className="model-card-more">+{ratings.length - 2} tested configurations · Scores in help</span>}
      {capturedDates(ratings) && <span className="model-card-date">Captured {capturedDates(ratings)}</span>}
    </section>}
    {!deployment && !ratings.length && <span className="model-card-empty">{summary.coverage?.deploymentAmbiguous ? 'Multiple published deployments' : 'No matched published data'}</span>}
    {summary.coverage?.recordsTruncated && <span className="model-card-empty">Partial source coverage</span>}
    <HelpHint topic="model-data" details={<CardSources summary={summary} />} />
  </>;
}

function capturedDates(records: any[]) {
  const dates = records.map(record => record.retrievedAt).filter(timestamp => timestamp != null)
    .map(timestamp => new Date(timestamp).getTime()).filter(Number.isFinite);
  if (!dates.length) return '';
  const first = date(Math.min(...dates)), last = date(Math.max(...dates));
  return first === last ? first : `${first} – ${last}`;
}

export function ModelCard({ model, providerName, appearance, version, status }: {
  model: any; providerName: string; appearance: any; version: number; status: { label: string; tone: string };
}) {
  const target = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false), [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '120px' });
    if (target.current) observer.observe(target.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    const key = `${version}:${model.id}`, saved = cache.get(key);
    const abort = new AbortController();
    setError('');
    if (saved && !retry && Date.now() - saved.at < 60000) { setSummary(saved.data); return; }
    setSummary(null);
    void api('models/data?' + new URLSearchParams({ operation: 'card', id: model.id }), undefined, 'GET', abort.signal).then(result => {
      if (abort.signal.aborted) return;
      if (cache.size >= 256) cache.delete(cache.keys().next().value!);
      cache.set(key, { data: result, at: Date.now() }); setSummary(result);
    }).catch(error => {
      if (!abort.signal.aborted) setError(error instanceof Error ? error.message : 'Published data unavailable.');
    });
    return () => abort.abort();
  }, [visible, model.id, version, retry]);
  const capabilities = model.nativeCapabilities ?? {};
  const access = ({ free: 'Free', metered: 'Metered', credits: 'Credits', subscription: 'Plan' } as Record<string, string>)[model.costClass] ?? 'Unknown access';
  return <div ref={target} className="model-card-anchor">
    <Panel {...providerAttributes(model.provider, appearance)} className="provider-model-card model-card" aria-label={`${model.name} model data`}>
      <header className="model-card-heading">
        <h2><ProviderText provider={model.provider} mark>{model.name}</ProviderText></h2>
        <span className={`model-status ${status.tone}`} title={model.availability} aria-label={`Model status: ${status.label} (${model.availability})`}>
          <span className="model-status-dot" aria-hidden="true" />{status.label}
        </span>
      </header>
      <div className="model-provider-name"><ProviderText provider={model.provider}>{providerName}</ProviderText></div>
      <div className="model-card-capabilities" aria-label="Native model capabilities">
        <Badge tone={model.costClass === 'free' ? 'success' : 'neutral'}>{access}</Badge>
        {typeof model.tools === 'boolean' && <span>{model.tools ? 'Tools' : 'No tools'}</span>}
        {capabilities.reasoning === true && <span>Reasoning</span>}
        {capabilities.input?.image === true && <span>Vision</span>}
      </div>
      <dl className="model-card-pairs model-card-limits" aria-label="Native model limits">
        <div><dt>Context</dt><dd>{known(model.context) ? quantity.format(model.context) : '—'}</dd></div>
        <div><dt>Max output</dt><dd>{known(model.output) ? quantity.format(model.output) : '—'}</dd></div>
      </dl>
      {summary ? <PublishedFacts summary={summary} /> : error ? <div className="model-card-error">
        <p role="alert">Published data unavailable</p><Button type="button" title={error} onClick={() => setRetry(value => value + 1)}>Retry data</Button>
        <HelpHint topic="model-data" details={<p>{error}</p>} />
      </div> : <span className="model-card-empty">{visible ? 'Loading published data…' : 'Published data'}</span>}
    </Panel>
  </div>;
}
