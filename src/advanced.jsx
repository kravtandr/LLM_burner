import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChartNoAxesCombined, ChevronDown, FileUp, FlaskConical, Info, SlidersHorizontal, X } from 'lucide-react';
import './advanced.css';
import { LoadCurveEditor, LoadCurveChart } from './LoadCurve.jsx';

const fmt = (value, digits = 2) => typeof value !== 'number' || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
const pct = value => typeof value === 'number' && Number.isFinite(value) ? `${fmt(value * 100, 1)}%` : '—';
const duration = value => typeof value === 'number' ? `${fmt(value / 1000)} s` : '—';
const defaultAdvanced = { loadMode: 'concurrency', requestRate: 1, arrivalPattern: 'constant', warmupRequests: 0, rampUpSeconds: 0, durationSeconds: 0, sweepConcurrency: [], prompts: [], datasetSelection: 'round-robin', randomSeed: 42, cacheBust: false, continuousUsage: false, loadCurve: [], curveTarget: 'concurrency', curveInterpolation: 'linear' };
function Field({ label, children, note }) { return <label className="advanced-field"><span>{label}</span>{children}{note && <small>{note}</small>}</label>; }
function Group({ title, children, open = false }) { return <details className="advanced-group" open={open || undefined}><summary>{title}<ChevronDown size={14} /></summary><div className="advanced-group-body">{children}</div></details>; }

function ArrayEditor({ value, onChange, kind, disabled }) {
  const encode = v => kind === 'sweep' ? v.join(', ') : v.length ? JSON.stringify(v, null, 2) : '';
  const [draft, setDraft] = useState(() => encode(value));
  const [error, setError] = useState('');
  const input = useRef(null);
  const lastValue = useRef(JSON.stringify(value));
  const errorId = useId();
  useEffect(() => {
    const serialized = JSON.stringify(value);
    if (serialized !== lastValue.current) {
      lastValue.current = serialized;
      setDraft(encode(value)); setError(''); input.current?.setCustomValidity('');
    }
  }, [JSON.stringify(value), kind]);
  function change(text) {
    setDraft(text);
    try {
      const next = !text.trim() ? [] : kind === 'sweep' ? text.split(',').map(v => v.trim() === '' ? NaN : Number(v.trim())) : JSON.parse(text);
      if (kind === 'sweep' && (!Array.isArray(next) || next.length > 8 || next.some(v => !Number.isInteger(v) || v < 1 || v > 128))) throw new Error('Enter up to 8 integers from 1 to 128, separated by commas.');
      if (kind === 'dataset' && (!Array.isArray(next) || next.length > 1000 || next.some(v => typeof v !== 'string' || !v.trim() || v.length > 100000) || next.reduce((total, v) => total + v.length, 0) > 500000)) throw new Error('Use a JSON array of up to 1,000 nonempty strings, at most 100,000 characters each and 500,000 in total.');
      lastValue.current = JSON.stringify(next); onChange(next); setError(''); input.current?.setCustomValidity('');
    } catch (e) { const message = e instanceof SyntaxError ? 'Check the JSON, for example ["First prompt", "Second prompt"].' : e.message; setError(message); input.current?.setCustomValidity(message); }
  }
  async function importFile(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError('File too large: maximum 10 MiB.'); return; }
    try { change(await file.text()); } catch { setError('Could not read the file.'); }
  }
  const props = { ref: input, value: draft, disabled, onChange: e => change(e.target.value), 'aria-invalid': Boolean(error), 'aria-describedby': error ? errorId : undefined, spellCheck: false };
  return <div className="advanced-array-editor"><Field label={kind === 'sweep' ? 'Concurrency sweep' : 'Prompt dataset · JSON'} note={kind === 'sweep' ? 'Leave empty for one stage. Each stage repeats the request limit and warmup.' : 'A string array preserves line breaks within prompts. Leave empty to use the main prompt.'}>{kind === 'sweep' ? <input {...props} placeholder="1, 4, 8, 16" /> : <textarea {...props} rows={5} placeholder={'["Explain how caching works", "Write a short story"]'} />}</Field>{kind === 'dataset' && <label className="advanced-file-button"><FileUp size={14} /> Load JSON<input type="file" accept=".json,application/json" disabled={disabled} onChange={importFile} /></label>}{error && <p id={errorId} className="advanced-error" role="alert">{error}</p>}</div>;
}

export function AdvancedSettings({ config, setConfig, disabled = false, stress = false }) {
  const c = { ...defaultAdvanced, ...config };
  const customCurve = !stress && Boolean(c.loadCurve?.length);
  const update = (key, value) => setConfig(previous => ({ ...previous, [key]: value }));
  const numeric = (key, { min, max, step = 'any', optional = false } = {}) => <input type="number" value={c[key] ?? ''} min={min} max={max} step={step} required={!optional} placeholder={optional ? 'Not set' : undefined} onChange={event => update(key, event.target.value === '' ? optional ? null : '' : Number(event.target.value))} />;
  return <fieldset className="advanced-settings" disabled={disabled} onInvalidCapture={event => { const group = event.target.closest('details'); if (group) group.open = true; }}>
    <div className="advanced-settings-heading"><SlidersHorizontal size={15} /><h3>Advanced settings</h3></div>
    <Group title="Load profile" open>
      {!stress && <LoadCurveEditor config={config} setConfig={setConfig} disabled={disabled} />}
      {!customCurve && <><Field label="Request scheduling"><select value={c.loadMode} onChange={e => update('loadMode', e.target.value)}><option value="concurrency">Constant concurrency</option><option value="rate">Request rate · RPS</option></select></Field>
      {c.loadMode === 'rate' && <div className="advanced-form-row"><Field label="Requests per second">{numeric('requestRate', { min: 0.1, max: 1000 })}</Field><Field label="Intervals"><select value={c.arrivalPattern} onChange={e => update('arrivalPattern', e.target.value)}><option value="constant">Constant</option><option value="poisson">Poisson</option></select></Field></div>}
      <Field label="Ramp-up, s">{numeric('rampUpSeconds', { min: 0, max: 600 })}</Field>
      {!stress && <><Field label="Stage duration limit, s" note="0 uses the request limit only. In-flight requests finish after the dispatch deadline.">{numeric('durationSeconds', { min: 0, max: 3600 })}</Field>
      <ArrayEditor kind="sweep" value={c.sweepConcurrency || []} onChange={value => update('sweepConcurrency', value)} disabled={disabled} /></>}</>}
      {customCurve && c.curveTarget === 'rate' && <Field label="Intervals"><select value={c.arrivalPattern} onChange={e => update('arrivalPattern', e.target.value)}><option value="constant">Constant</option><option value="poisson">Poisson</option></select></Field>}
      {(customCurve ? c.curveTarget === 'rate' : c.loadMode === 'rate') && <p className="advanced-note">Concurrency caps in-flight requests. Actual RPS may fall below the target when the endpoint is saturated.</p>}
      <Field label="Warmup requests">{numeric('warmupRequests', { min: 0, max: 1000, step: 1 })}</Field>
      <p className="advanced-note">Warmup is excluded from final metrics.{!customCurve && ' Ramp-up increases available concurrency from 1 to the target.'}</p>
    </Group>
    <Group title={`Prompt dataset${c.prompts?.length ? ` · ${c.prompts.length}` : ''}`}>
      <ArrayEditor kind="dataset" value={c.prompts || []} onChange={value => update('prompts', value)} disabled={disabled} />
      <div className="advanced-form-row"><Field label="Selection"><select value={c.datasetSelection} onChange={e => update('datasetSelection', e.target.value)}><option value="round-robin">Round-robin</option><option value="random">Random</option></select></Field><Field label="Workload seed">{numeric('randomSeed', { min: 0, max: 4294967295, step: 1 })}</Field></div>
      <label className="advanced-checkbox"><input type="checkbox" checked={Boolean(c.cacheBust)} onChange={e => update('cacheBust', e.target.checked)} />Unique prefix for each request</label>
      <p className="advanced-note">The prefix changes the text and cache behavior but does not guarantee a cache miss. All prompts share the system context. The workload seed controls prompt selection and Poisson intervals.</p>
    </Group>
    <Group title="Sampling">
      <div className="advanced-form-row"><Field label="Temperature">{numeric('temperature', { min: 0, max: 2, optional: true })}</Field><Field label="Top P">{numeric('topP', { min: 0, max: 1, optional: true })}</Field></div>
      <Field label="Model seed">{numeric('seed', { min: -2147483648, max: 2147483647, step: 1, optional: true })}</Field><p className="advanced-note">Empty parameters are omitted. Support and determinism depend on the API.</p>
    </Group>
    <Group title="Latency targets · SLO">
      <Field label="Maximum TTFT, ms">{numeric('sloTtftMs', { min: 0.001, max: 3600000, optional: true })}</Field><div className="advanced-form-row"><Field label="Full response, ms">{numeric('sloLatencyMs', { min: 0.001, max: 3600000, optional: true })}</Field><Field label="TPOT, ms / token">{numeric('sloTpotMs', { min: 0.001, max: 3600000, optional: true })}</Field></div><p className="advanced-note">Leave empty to disable a limit. Goodput counts successful requests meeting every enabled limit; unknown values are reported separately.</p>
    </Group>
    <Group title="Cost · manual USD prices">
      <Field label="Input · USD per million tokens">{numeric('inputPricePerMillion', { min: 0, max: 1000000, optional: true })}</Field><Field label="Output · USD per million tokens">{numeric('outputPricePerMillion', { min: 0, max: 1000000, optional: true })}</Field><p className="advanced-note">Requires complete usage and both prices. You supply USD prices; there is no currency conversion or separate cache pricing.</p>
    </Group>
  </fieldset>;
}

const distributionRows = [
  ['latencyMs', 'Full response', 'ms'], ['ttftMs', 'First token · TTFT', 'ms'], ['ttfoMs', 'First visible text · TTFO', 'ms'], ['ttstMs', 'First → second chunk · TTST', 'ms'], ['tpotMs', 'TPOT · estimate', 'ms/token'], ['iclMs', 'Mean request ICL', 'ms'], ['iclMaxMs', 'Max request ICL', 'ms'], ['decodeDurationMs', 'Generation duration', 'ms'], ['prefillTps', 'Input / TTFT · estimate', 'tok/s'], ['decodeTps', 'Decode TPS · estimate', 'tok/s'], ['e2eTps', 'Request TPS · end-to-end', 'tok/s'], ['inputTokens', 'Input tokens', 'tok'], ['outputTokens', 'Output tokens', 'tok'], ['queueMs', 'Dispatch delay', 'ms'], ['bytesReceived', 'Data received', 'bytes'], ['chunkCount', 'Generation chunks', 'count'],
];
function Stat({ label, value, note, tone = '' }) { return <div className={`advanced-stat ${tone}`}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>; }
function Breakdown({ title, values }) { const entries = values && typeof values === 'object' ? Object.entries(values) : []; return <div className="advanced-breakdown"><h3>{title}</h3>{entries.length ? <dl>{entries.map(([key, count]) => <div key={key}><dt>{key}</dt><dd>{fmt(count, 0)}</dd></div>)}</dl> : <p className="advanced-note">No values recorded</p>}</div>; }
function SweepChart({ stages }) {
  const points = stages.filter(stage => Number.isFinite(stage.metrics?.throughput) && Number.isFinite(stage.concurrency));
  if (!points.length) return <p className="advanced-note advanced-chart-placeholder">The curve appears when stage output throughput is available.</p>;
  const left = 58, top = 18, right = 22, bottom = 45, width = 650, height = 220;
  const maxX = Math.max(...points.map(p => p.concurrency), 1), maxY = Math.max(...points.map(p => p.metrics.throughput), 1) * 1.1;
  const x = n => left + n / maxX * (width - left - right), y = n => top + (1 - n / maxY) * (height - top - bottom);
  return <div className="advanced-curve"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Output throughput by concurrency stage"><text x={left} y={11}>tok/s</text>{[0, 0.5, 1].map(r => <g key={r}><line x1={left} x2={width - right} y1={y(r * maxY)} y2={y(r * maxY)} /><text x={left - 9} y={y(r * maxY) + 4} textAnchor="end">{fmt(r * maxY, 0)}</text></g>)}<polyline points={points.map(p => `${x(p.concurrency)},${y(p.metrics.throughput)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" />{points.map((p, index) => <g key={`${p.index}-${index}`}><circle cx={x(p.concurrency)} cy={y(p.metrics.throughput)} r="4" fill="var(--accent)"><title>Stage {p.index + 1}: {p.concurrency} concurrent, {fmt(p.metrics.throughput)} tok/s</title></circle><text x={x(p.concurrency)} y={height - bottom + 18} textAnchor="middle">{p.concurrency}</text></g>)}<text x={width / 2} y={height - 4} textAnchor="middle">Concurrent requests</text></svg></div>;
}

export function AdvancedResults({ run }) {
  if (!run) return null;
  const m = run.metrics || {}, c = run.config || {}, stages = run.stages || [];
  const hasSlo = ['sloTtftMs', 'sloLatencyMs', 'sloTpotMs'].some(key => c[key] != null);
  return <div className="advanced-results">
    {c.loadCurve?.length > 0 && <section className="panel advanced-panel"><div className="advanced-panel-heading"><h2>Saved load curve</h2><span className="advanced-caption">{c.curveTarget === 'rate' ? 'Request rate' : 'Concurrency'} · {c.curveInterpolation === 'step' ? 'Step' : 'Linear'}</span></div><LoadCurveChart points={c.loadCurve} target={c.curveTarget} interpolation={c.curveInterpolation} /></section>}
    <section className="panel advanced-panel"><div className="advanced-panel-heading"><h2><ChartNoAxesCombined size={18} />Detailed metrics</h2><span className="advanced-caption">Excluding warmup</span></div>
      <div className="advanced-stat-grid"><Stat label="Input throughput" value={fmt(m.inputThroughput)} note="input tok/s" /><Stat label="Output throughput" value={fmt(m.throughput)} note="output tok/s" /><Stat label="Total throughput" value={fmt(m.totalThroughput)} note="input + output tok/s" /><Stat label="Requests per second" value={fmt(m.requestsPerSecond)} note="successful requests / time" /></div>
      <div className="advanced-table-scroll" tabIndex="0" aria-label="Metric distributions, scroll horizontally"><table className="advanced-table"><thead><tr><th scope="col">Metric</th><th scope="col">N</th>{['Mean', 'Min.', 'Max.', 'σ', 'p50', 'p90', 'p95', 'p99'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{distributionRows.map(([key, label, unit]) => { const d = m.distributions?.[key] || {}; return <tr key={key}><th scope="row">{label}<small>{unit}</small></th><td>{fmt(d.count, 0)}</td>{['mean', 'min', 'max', 'stddev', 'p50', 'p90', 'p95', 'p99'].map(stat => <td key={stat}>{fmt(d[stat])}</td>)}</tr>; })}</tbody></table></div>
      <div className="advanced-footnote"><Info size={14} /><p>TTST and ICL measure stream chunks. Input / TTFT is a client-side estimate that includes network and queue time. TPOT and decode TPS use generation time and usage; a chunk is not a token. Continuous usage subtracts the first chunk’s tokens; otherwise one token is subtracted. ICL aggregates request means. “—” means unavailable.</p></div>
    </section>
    <section className="panel advanced-panel"><div className="advanced-panel-heading"><h2>Quality and data coverage</h2><span className="advanced-caption">{hasSlo ? 'SLOs enabled' : 'SLOs not configured'}</span></div>
      <div className="advanced-stat-grid"><Stat label="Goodput" value={hasSlo ? fmt(m.goodputRequestsPerSecond) : '—'} note="SLO requests / s" /><Stat label="Token goodput" value={hasSlo ? fmt(m.goodputTokensPerSecond) : '—'} note="output tok/s meeting SLOs" /><Stat label="Passed SLOs" value={hasSlo ? fmt(m.sloPassed, 0) : '—'} tone="advanced-positive" /><Stat label="Failed / unknown" value={hasSlo ? `${fmt(m.sloFailed, 0)} / ${fmt(m.sloUnknown, 0)}` : '—'} /></div>
      {hasSlo && <p className="advanced-thresholds">{[['sloTtftMs', 'TTFT'], ['sloLatencyMs', 'Full response'], ['sloTpotMs', 'TPOT']].filter(([key]) => c[key] != null).map(([key, label]) => <span key={key}>{label} ≤ {fmt(c[key])} ms</span>)}<span>SLO coverage: {pct(m.sloCoverage)}</span></p>}
      <div className="advanced-stat-grid advanced-secondary-stats"><Stat label="Success rate" value={pct(m.successRate)} /><Stat label="SLO pass fraction" value={hasSlo ? pct(m.goodRequestFraction) : '—'} note="Of all completed requests, including errors and cancellations" /><Stat label="Warmup completed" value={fmt(run.warmupCompleted, 0)} note={`Of ${fmt(run.warmupTotal, 0)} requests`} /><Stat label="Warmup errors" value={fmt(run.warmupErrors, 0)} /><Stat label="Errors" value={pct(m.errorRate)} /><Stat label="Cancelled" value={pct(m.cancelRate)} /><Stat label="Input usage" value={pct(m.inputUsageCoverage)} /><Stat label="Output usage" value={m.success > 0 && Number.isFinite(m.usageCount) ? pct(m.usageCount / m.success) : '—'} /><Stat label="Input tokens" value={fmt(m.inputTokens, 0)} /><Stat label="Reasoning tokens" value={fmt(m.reasoningTokens, 0)} /><Stat label="Prediction: accepted" value={fmt(m.acceptedPredictionTokens, 0)} /><Stat label="Prediction: rejected" value={fmt(m.rejectedPredictionTokens, 0)} /><Stat label="Cached input" value={fmt(m.cachedInputTokens, 0)} /><Stat label="Cached input fraction" value={pct(m.cacheHitRate)} /><Stat label="Estimated cost" value={m.costUsd == null ? '—' : `${fmt(m.costUsd, 6)} USD`} /><Stat label="Measurement time" value={duration(run.elapsedMs ?? m.elapsedMs)} /><Stat label="Including warmup" value={duration(run.wallElapsedMs)} /></div>
      <div className="advanced-breakdowns"><Breakdown title="Decode TPS method" values={m.timingMethods && Object.fromEntries(Object.entries(m.timingMethods).map(([key, value]) => [({ "usage-corrected": "First-chunk corrected", estimated: "Estimate: output − 1", unavailable: "Unavailable" })[key] || key, value]))} /><Breakdown title="Error types" values={m.errorsByType} /><Breakdown title="Finish reasons" values={m.finishReasons} /></div>
      <div className="advanced-footnote"><Info size={14} /><p>Token counts come from API usage and may have incomplete coverage. Cached and reasoning counts require server support. Cost needs both prices and complete input/output coverage; separate cache pricing is not included. The estimate covers successful measured requests only, excluding warmup and errors. Prediction usage is not speculative decoding telemetry.{!run.schemaVersion || run.schemaVersion < 2 ? ' Some advanced measurements are unavailable in this older run.' : ''}</p></div>
    </section>
    {stages.length > 0 && <section className="panel advanced-panel"><div className="advanced-panel-heading"><h2>Load stages</h2><span className="advanced-caption">{stages.length} stages</span></div>{stages.length > 1 && <SweepChart stages={stages} />}<div className="advanced-table-scroll" tabIndex="0" aria-label="Stage metrics, scroll horizontally"><table className="advanced-table"><thead><tr><th>Stage</th><th>Concurrency</th><th>Status</th><th>Completed</th><th>Time</th><th>Output tok/s</th><th>Requests / s</th><th>TTFT p95, ms</th><th>Latency p95, ms</th><th>Errors</th></tr></thead><tbody>{stages.map((s, i) => <tr key={s.index ?? i}><th scope="row">{(s.index ?? i) + 1}</th><td>{fmt(s.concurrency, 0)}</td><td>{({ pending: 'Pending', warmup: 'Warmup', measurement: 'Measurement', running: 'Running', completed: 'Completed', cancelled: 'Cancelled', interrupted: 'Interrupted', failed: 'Error' })[s.status] || s.status || '—'}</td><td>{fmt(s.completed, 0)}</td><td>{duration(s.elapsedMs)}</td><td>{fmt(s.metrics?.throughput)}</td><td>{fmt(s.metrics?.requestsPerSecond)}</td><td>{fmt(s.metrics?.distributions?.ttftMs?.p95)}</td><td>{fmt(s.metrics?.distributions?.latencyMs?.p95 ?? s.metrics?.latencyP95Ms)}</td><td>{fmt(s.metrics?.errors, 0)}</td></tr>)}</tbody></table></div></section>}
  </div>;
}

const comparisonSettings = [ ['testMode', 'Test mode'], ['loadCurve', 'Load curve'], ['curveTarget', 'Curve target'], ['curveInterpolation', 'Curve interpolation'], ['endpoint', 'Endpoint'], ['model', 'Model'], ['concurrency', 'Concurrency'], ['totalRequests', 'Request limit'], ['maxTokens', 'Output limit'], ['timeoutSeconds', 'Timeout, s'], ['tokenParameter', 'Limit parameter'], ['includeUsage', 'Request usage'], ['continuousUsage', 'Usage per chunk'], ['loadMode', 'Load mode'], ['requestRate', 'Target RPS'], ['arrivalPattern', 'Intervals'], ['warmupRequests', 'Warmup'], ['rampUpSeconds', 'Ramp-up, s'], ['durationSeconds', 'Duration limit, s'], ['sweepConcurrency', 'Stages'], ['datasetSelection', 'Prompt selection'], ['randomSeed', 'Workload seed'], ['cacheBust', 'Unique prefix'], ['temperature', 'Temperature'], ['topP', 'Top P'], ['seed', 'Model seed'], ['sloTtftMs', 'SLO TTFT'], ['sloLatencyMs', 'SLO latency'], ['sloTpotMs', 'SLO TPOT'], ['inputPricePerMillion', 'Input USD / million'], ['outputPricePerMillion', 'Output USD / million'], ['prompt', 'Main prompt'], ['system', 'System context'], ['prompts', 'Prompt dataset'] ];
const settingValue = (run, key) => key === 'testMode' ? run.config?.testMode || 'benchmark' : key === 'totalRequests' && run.config?.testMode === 'stress' ? 'No limit' : run.config?.[key] ?? defaultAdvanced[key] ?? null;
function settingText(value) { if (value == null) return 'Not set'; if (typeof value === 'boolean') return value ? 'Yes' : 'No'; if (Array.isArray(value)) return value.length ? JSON.stringify(value) : 'Empty'; return String(value); }

export function CompareRuns({ runs = [], onClose }) {
  const panel = useRef(null), close = useRef(null), titleId = useId(), onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; close.current?.focus();
    function keydown(event) {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); }
      if (event.key === 'Tab') {
        const elements = [...panel.current.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]')];
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus(); };
  }, []);
  const differenceKeys = comparisonSettings.filter(([key]) => new Set(runs.map(run => JSON.stringify(settingValue(run, key)))).size > 1);
  const metricRows = [['throughput', 'Output throughput, tok/s'], ['inputThroughput', 'Input throughput, tok/s'], ['requestsPerSecond', 'Successful requests / s'], ['ttftMs', 'Mean TTFT, ms'], ['latencyP95Ms', 'Latency p95, ms'], ['goodputRequestsPerSecond', 'SLO goodput, requests / s'], ['success', 'Successful'], ['errors', 'Errors'], ['costUsd', 'Cost, USD']];
  const maxThroughput = Math.max(1, ...runs.map(run => Number.isFinite(run.metrics?.throughput) ? run.metrics.throughput : 0));
  return createPortal(<div className="advanced-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section ref={panel} className="advanced-compare panel" role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="advanced-panel-heading"><div><h2 id={titleId}>Compare runs</h2><p className="advanced-note">Review configuration differences before comparing performance.</p></div><button ref={close} type="button" className="advanced-close" aria-label="Close comparison" onClick={onClose}><X size={20} /></button></div>
    <div className="advanced-compare-body"><div className="advanced-compare-bars" aria-label="Output throughput comparison">{runs.map((run, index) => <div className="advanced-compare-bar" key={run.id ?? index}><div><strong>{run.name || `Run ${index + 1}`}</strong>{run.config?.demo && <span className="advanced-demo"><FlaskConical size={12} />Demo</span>}<span>{fmt(run.metrics?.throughput)} tok/s</span></div><div className="advanced-bar-track"><div style={{ width: Number.isFinite(run.metrics?.throughput) ? `${run.metrics.throughput / maxThroughput * 100}%` : '0%' }} /></div></div>)}</div>
      <p className="advanced-scroll-hint">Scroll the table to see every run.</p><div className="advanced-table-scroll" tabIndex="0" aria-label="Metric comparison, scroll horizontally"><table className="advanced-table advanced-compare-table" style={{ minWidth: Math.max(530, 180 + runs.length * 180) }}><thead><tr><th scope="col">Metric</th>{runs.map((run, index) => <th scope="col" key={run.id ?? index}>{run.name || `Run ${index + 1}`}<small>{run.config?.model}{run.config?.demo ? ' · Demo' : ''}</small><small>{({ completed: 'Completed', running: 'Running', stopping: 'Stopping', cancelled: 'Cancelled', failed: 'Error', interrupted: 'Interrupted' })[run.status] || run.status || '—'} · {run.startedAt ? new Date(run.startedAt).toLocaleString('en-US') : '—'}</small></th>)}</tr></thead><tbody>{metricRows.map(([key, label]) => <tr key={key}><th scope="row">{label}</th>{runs.map((run, index) => <td key={run.id ?? index}>{fmt(run.metrics?.[key], key === 'costUsd' ? 6 : 2)}</td>)}</tr>)}</tbody></table></div>
      <div className="advanced-comparison-heading"><h3>Configuration differences</h3><span>{differenceKeys.length ? `${differenceKeys.length} settings` : 'Settings match'}</span></div>
      {differenceKeys.length > 0 && <div className="advanced-table-scroll" tabIndex="0" aria-label="Setting differences, scroll horizontally"><table className="advanced-table advanced-differences" style={{ minWidth: Math.max(530, 180 + runs.length * 180) }}><thead><tr><th scope="col">Setting</th>{runs.map((run, index) => <th scope="col" key={run.id ?? index}>{run.name || `Run ${index + 1}`}</th>)}</tr></thead><tbody>{differenceKeys.map(([key, label]) => <tr key={key}><th scope="row">{label}</th>{runs.map((run, index) => <td key={run.id ?? index}><div>{settingText(settingValue(run, key))}</div></td>)}</tr>)}</tbody></table></div>}
      <p className="advanced-note advanced-comparison-note">Demo data is synthetic. Workload, prompts, limits, SLOs, and usage coverage can affect comparisons. “—” means not measured or unavailable.</p>
    </div></section></div>, document.body);
}
