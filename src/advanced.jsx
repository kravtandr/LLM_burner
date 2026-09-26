import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChartNoAxesCombined, ChevronDown, FileUp, FlaskConical, Info, SlidersHorizontal, X } from 'lucide-react';
import './advanced.css';

const fmt = (value, digits = 2) => typeof value !== 'number' || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
const pct = value => typeof value === 'number' && Number.isFinite(value) ? `${fmt(value * 100, 1)}%` : '—';
const duration = value => typeof value === 'number' ? `${fmt(value / 1000)} с` : '—';
const defaultAdvanced = { loadMode: 'concurrency', requestRate: 1, arrivalPattern: 'constant', warmupRequests: 0, rampUpSeconds: 0, durationSeconds: 0, sweepConcurrency: [], prompts: [], datasetSelection: 'round-robin', randomSeed: 42, cacheBust: false, continuousUsage: false };
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
      if (kind === 'sweep' && (!Array.isArray(next) || next.length > 8 || next.some(v => !Number.isInteger(v) || v < 1 || v > 128))) throw new Error('До 8 целых значений от 1 до 128, через запятую.');
      if (kind === 'dataset' && (!Array.isArray(next) || next.length > 1000 || next.some(v => typeof v !== 'string' || !v.trim() || v.length > 100000) || next.reduce((total, v) => total + v.length, 0) > 500000)) throw new Error('Нужен JSON-массив: до 1000 непустых строк, до 100 000 символов каждая и 500 000 суммарно.');
      lastValue.current = JSON.stringify(next); onChange(next); setError(''); input.current?.setCustomValidity('');
    } catch (e) { const message = e instanceof SyntaxError ? 'Проверьте JSON: например, ["Первый запрос", "Второй запрос"].' : e.message; setError(message); input.current?.setCustomValidity(message); }
  }
  async function importFile(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError('Файл слишком большой: максимум 10 МБ.'); return; }
    try { change(await file.text()); } catch { setError('Не удалось прочитать файл.'); }
  }
  const props = { ref: input, value: draft, disabled, onChange: e => change(e.target.value), 'aria-invalid': Boolean(error), 'aria-describedby': error ? errorId : undefined, spellCheck: false };
  return <div className="advanced-array-editor"><Field label={kind === 'sweep' ? 'Ступени параллельности' : 'Набор запросов · JSON'} note={kind === 'sweep' ? 'Пусто — одна ступень. Каждая ступень повторяет лимит запросов и прогрев.' : 'Массив строк сохраняет переносы внутри запросов. Пусто — основной текст запроса.'}>{kind === 'sweep' ? <input {...props} placeholder="1, 4, 8, 16" /> : <textarea {...props} rows={5} placeholder={'["Объясни принцип работы кэша", "Напиши короткий рассказ"]'} />}</Field>{kind === 'dataset' && <label className="advanced-file-button"><FileUp size={14} /> Загрузить JSON<input type="file" accept=".json,application/json" disabled={disabled} onChange={importFile} /></label>}{error && <p id={errorId} className="advanced-error" role="alert">{error}</p>}</div>;
}

export function AdvancedSettings({ config, setConfig, disabled = false }) {
  const c = { ...defaultAdvanced, ...config };
  const update = (key, value) => setConfig(previous => ({ ...previous, [key]: value }));
  const numeric = (key, { min, max, step = 'any', optional = false } = {}) => <input type="number" value={c[key] ?? ''} min={min} max={max} step={step} required={!optional} placeholder={optional ? 'Не задано' : undefined} onChange={event => update(key, event.target.value === '' ? optional ? null : '' : Number(event.target.value))} />;
  return <fieldset className="advanced-settings" disabled={disabled} onInvalidCapture={event => { const group = event.target.closest('details'); if (group) group.open = true; }}>
    <div className="advanced-settings-heading"><SlidersHorizontal size={15} /><h3>Расширенные параметры</h3></div>
    <Group title="Профиль нагрузки" open>
      <Field label="Режим подачи запросов"><select value={c.loadMode} onChange={e => update('loadMode', e.target.value)}><option value="concurrency">Постоянная параллельность</option><option value="rate">Заданная частота · RPS</option></select></Field>
      {c.loadMode === 'rate' && <><div className="advanced-form-row"><Field label="Запросов в секунду">{numeric('requestRate', { min: 0.1, max: 1000 })}</Field><Field label="Интервалы"><select value={c.arrivalPattern} onChange={e => update('arrivalPattern', e.target.value)}><option value="constant">Равномерно</option><option value="poisson">Пуассон</option></select></Field></div><p className="advanced-note">Параллельность ограничивает число одновременных запросов. При насыщении фактический RPS может быть ниже заданного.</p></>}
      <div className="advanced-form-row"><Field label="Прогрев, запросов">{numeric('warmupRequests', { min: 0, max: 1000, step: 1 })}</Field><Field label="Разгон, с">{numeric('rampUpSeconds', { min: 0, max: 600 })}</Field></div>
      <Field label="Лимит времени ступени, с" note="0 — только лимит запросов. После дедлайна уже начатые запросы завершаются.">{numeric('durationSeconds', { min: 0, max: 3600 })}</Field>
      <ArrayEditor kind="sweep" value={c.sweepConcurrency || []} onChange={value => update('sweepConcurrency', value)} disabled={disabled} />
      <p className="advanced-note">Прогрев исключён из итоговых метрик. Разгон увеличивает доступную параллельность от 1 до целевого значения.</p>
    </Group>
    <Group title={`Набор запросов${c.prompts?.length ? ` · ${c.prompts.length}` : ''}`}>
      <ArrayEditor kind="dataset" value={c.prompts || []} onChange={value => update('prompts', value)} disabled={disabled} />
      <div className="advanced-form-row"><Field label="Порядок"><select value={c.datasetSelection} onChange={e => update('datasetSelection', e.target.value)}><option value="round-robin">По кругу</option><option value="random">Случайно</option></select></Field><Field label="Seed нагрузки">{numeric('randomSeed', { min: 0, max: 4294967295, step: 1 })}</Field></div>
      <label className="advanced-checkbox"><input type="checkbox" checked={Boolean(c.cacheBust)} onChange={e => update('cacheBust', e.target.checked)} />Уникальный префикс каждого запроса</label>
      <p className="advanced-note">Префикс меняет текст и поведение кэша, но не гарантирует cache miss. Системный контекст общий для всего набора. Seed нагрузки управляет выбором запросов и интервалами Пуассона.</p>
    </Group>
    <Group title="Сэмплирование">
      <div className="advanced-form-row"><Field label="Temperature">{numeric('temperature', { min: 0, max: 2, optional: true })}</Field><Field label="Top P">{numeric('topP', { min: 0, max: 1, optional: true })}</Field></div>
      <Field label="Seed модели">{numeric('seed', { min: -2147483648, max: 2147483647, step: 1, optional: true })}</Field><p className="advanced-note">Пустые параметры не отправляются. Поддержка и детерминированность зависят от API.</p>
    </Group>
    <Group title="Цели задержки · SLO">
      <Field label="TTFT не более, мс">{numeric('sloTtftMs', { min: 0.001, max: 3600000, optional: true })}</Field><div className="advanced-form-row"><Field label="Полный ответ, мс">{numeric('sloLatencyMs', { min: 0.001, max: 3600000, optional: true })}</Field><Field label="TPOT, мс / токен">{numeric('sloTpotMs', { min: 0.001, max: 3600000, optional: true })}</Field></div><p className="advanced-note">Пусто — порог отключён. Goodput учитывает успешные запросы, выполнившие все заданные пороги; неизвестные значения считаются отдельно.</p>
    </Group>
    <Group title="Стоимость · вручную в USD">
      <Field label="Input · USD за 1 млн токенов">{numeric('inputPricePerMillion', { min: 0, max: 1000000, optional: true })}</Field><Field label="Output · USD за 1 млн токенов">{numeric('outputPricePerMillion', { min: 0, max: 1000000, optional: true })}</Field><p className="advanced-note">Расчёт доступен при полных данных usage и обеих ценах. Цены задаёте вы; валюты не конвертируются, отдельные тарифы кэша не учитываются.</p>
    </Group>
  </fieldset>;
}

const distributionRows = [
  ['latencyMs', 'Полный ответ', 'мс'], ['ttftMs', 'Первый токен · TTFT', 'мс'], ['ttfoMs', 'Первый видимый текст · TTFO', 'мс'], ['ttstMs', 'Первый → второй chunk · TTST', 'мс'], ['tpotMs', 'TPOT · оценка', 'мс/токен'], ['iclMs', 'Средний ICL запроса', 'мс'], ['iclMaxMs', 'Максимальный ICL запроса', 'мс'], ['decodeDurationMs', 'Длительность генерации', 'мс'], ['prefillTps', 'Input / TTFT · оценка', 'tok/s'], ['decodeTps', 'Decode TPS · оценка', 'tok/s'], ['e2eTps', 'TPS запроса · end-to-end', 'tok/s'], ['inputTokens', 'Input токены', 'tok'], ['outputTokens', 'Output токены', 'tok'], ['queueMs', 'Задержка подачи', 'мс'], ['bytesReceived', 'Получено данных', 'байт'], ['chunkCount', 'Чанки с генерацией', 'шт.'],
];
function Stat({ label, value, note, tone = '' }) { return <div className={`advanced-stat ${tone}`}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>; }
function Breakdown({ title, values }) { const entries = values && typeof values === 'object' ? Object.entries(values) : []; return <div className="advanced-breakdown"><h3>{title}</h3>{entries.length ? <dl>{entries.map(([key, count]) => <div key={key}><dt>{key}</dt><dd>{fmt(count, 0)}</dd></div>)}</dl> : <p className="advanced-note">Нет зарегистрированных значений</p>}</div>; }
function SweepChart({ stages }) {
  const points = stages.filter(stage => Number.isFinite(stage.metrics?.throughput) && Number.isFinite(stage.concurrency));
  if (!points.length) return <p className="advanced-note advanced-chart-placeholder">Кривая появится, когда будут доступны output throughput ступеней.</p>;
  const left = 58, top = 18, right = 22, bottom = 45, width = 650, height = 220;
  const maxX = Math.max(...points.map(p => p.concurrency), 1), maxY = Math.max(...points.map(p => p.metrics.throughput), 1) * 1.1;
  const x = n => left + n / maxX * (width - left - right), y = n => top + (1 - n / maxY) * (height - top - bottom);
  return <div className="advanced-curve"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Output throughput по ступеням параллельности"><text x={left} y={11}>tok/s</text>{[0, 0.5, 1].map(r => <g key={r}><line x1={left} x2={width - right} y1={y(r * maxY)} y2={y(r * maxY)} /><text x={left - 9} y={y(r * maxY) + 4} textAnchor="end">{fmt(r * maxY, 0)}</text></g>)}<polyline points={points.map(p => `${x(p.concurrency)},${y(p.metrics.throughput)}`).join(' ')} fill="none" stroke="var(--accent, #315bdd)" strokeWidth="2" />{points.map((p, index) => <g key={`${p.index}-${index}`}><circle cx={x(p.concurrency)} cy={y(p.metrics.throughput)} r="4" fill="var(--accent, #315bdd)"><title>Ступень {p.index + 1}: {p.concurrency} одновременно, {fmt(p.metrics.throughput)} tok/s</title></circle><text x={x(p.concurrency)} y={height - bottom + 18} textAnchor="middle">{p.concurrency}</text></g>)}<text x={width / 2} y={height - 4} textAnchor="middle">Параллельные запросы</text></svg></div>;
}

export function AdvancedResults({ run }) {
  if (!run) return null;
  const m = run.metrics || {}, c = run.config || {}, stages = run.stages || [];
  const hasSlo = ['sloTtftMs', 'sloLatencyMs', 'sloTpotMs'].some(key => c[key] != null);
  return <div className="advanced-results">
    <section className="panel advanced-panel"><div className="advanced-panel-heading"><h2><ChartNoAxesCombined size={18} />Подробные метрики</h2><span className="advanced-caption">Без прогрева</span></div>
      <div className="advanced-stat-grid"><Stat label="Input throughput" value={fmt(m.inputThroughput)} note="input tok/s" /><Stat label="Output throughput" value={fmt(m.throughput)} note="output tok/s" /><Stat label="Всего throughput" value={fmt(m.totalThroughput)} note="input + output tok/s" /><Stat label="Запросов в секунду" value={fmt(m.requestsPerSecond)} note="успешные запросы / время" /></div>
      <div className="advanced-table-scroll" tabIndex="0" aria-label="Распределения метрик, горизонтальная прокрутка"><table className="advanced-table"><thead><tr><th scope="col">Метрика</th><th scope="col">N</th>{['Среднее', 'Мин.', 'Макс.', 'σ', 'p50', 'p90', 'p95', 'p99'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{distributionRows.map(([key, label, unit]) => { const d = m.distributions?.[key] || {}; return <tr key={key}><th scope="row">{label}<small>{unit}</small></th><td>{fmt(d.count, 0)}</td>{['mean', 'min', 'max', 'stddev', 'p50', 'p90', 'p95', 'p99'].map(stat => <td key={stat}>{fmt(d[stat])}</td>)}</tr>; })}</tbody></table></div>
      <div className="advanced-footnote"><Info size={14} /><p>TTST и ICL измеряют чанки потока. Input / TTFT — клиентская оценка, включающая сеть и очередь. TPOT и decode TPS — оценки по длительности генерации и usage; чанк не равен токену. При continuous usage из числа output токенов вычитаются токены первого чанка; иначе вычитается один токен. ICL агрегируется по средним значениям запросов. «—» означает отсутствие данных.</p></div>
    </section>
    <section className="panel advanced-panel"><div className="advanced-panel-heading"><h2>Качество и полнота данных</h2><span className="advanced-caption">{hasSlo ? 'SLO включены' : 'SLO не заданы'}</span></div>
      <div className="advanced-stat-grid"><Stat label="Goodput" value={hasSlo ? fmt(m.goodputRequestsPerSecond) : '—'} note="SLO запросов / с" /><Stat label="Token goodput" value={hasSlo ? fmt(m.goodputTokensPerSecond) : '—'} note="output tok/s в рамках SLO" /><Stat label="Выполнили SLO" value={hasSlo ? fmt(m.sloPassed, 0) : '—'} tone="advanced-positive" /><Stat label="Нарушили / неизвестно" value={hasSlo ? `${fmt(m.sloFailed, 0)} / ${fmt(m.sloUnknown, 0)}` : '—'} /></div>
      {hasSlo && <p className="advanced-thresholds">{[['sloTtftMs', 'TTFT'], ['sloLatencyMs', 'Полный ответ'], ['sloTpotMs', 'TPOT']].filter(([key]) => c[key] != null).map(([key, label]) => <span key={key}>{label} ≤ {fmt(c[key])} мс</span>)}<span>Покрытие SLO: {pct(m.sloCoverage)}</span></p>}
      <div className="advanced-stat-grid advanced-secondary-stats"><Stat label="Успешность" value={pct(m.successRate)} /><Stat label="Доля в рамках SLO" value={hasSlo ? pct(m.goodRequestFraction) : '—'} note="От всех завершённых, включая ошибки и отмены" /><Stat label="Прогрев завершён" value={fmt(run.warmupCompleted, 0)} note={`Из ${fmt(run.warmupTotal, 0)} запросов`} /><Stat label="Ошибки прогрева" value={fmt(run.warmupErrors, 0)} /><Stat label="Ошибки" value={pct(m.errorRate)} /><Stat label="Отменены" value={pct(m.cancelRate)} /><Stat label="Input usage" value={pct(m.inputUsageCoverage)} /><Stat label="Output usage" value={m.success > 0 && Number.isFinite(m.usageCount) ? pct(m.usageCount / m.success) : '—'} /><Stat label="Input токены" value={fmt(m.inputTokens, 0)} /><Stat label="Reasoning токены" value={fmt(m.reasoningTokens, 0)} /><Stat label="Prediction: принято" value={fmt(m.acceptedPredictionTokens, 0)} /><Stat label="Prediction: отклонено" value={fmt(m.rejectedPredictionTokens, 0)} /><Stat label="Cached input" value={fmt(m.cachedInputTokens, 0)} /><Stat label="Доля cached input" value={pct(m.cacheHitRate)} /><Stat label="Расчётная стоимость" value={m.costUsd == null ? '—' : `${fmt(m.costUsd, 6)} USD`} /><Stat label="Измеряемое время" value={duration(run.elapsedMs ?? m.elapsedMs)} /><Stat label="С прогревом" value={duration(run.wallElapsedMs)} /></div>
      <div className="advanced-breakdowns"><Breakdown title="Расчёт decode TPS" values={m.timingMethods && Object.fromEntries(Object.entries(m.timingMethods).map(([key, value]) => [({ "usage-corrected": "С учётом первого чанка", estimated: "Оценка: output − 1", unavailable: "Недоступен" })[key] || key, value]))} /><Breakdown title="Типы ошибок" values={m.errorsByType} /><Breakdown title="Причины завершения" values={m.finishReasons} /></div>
      <div className="advanced-footnote"><Info size={14} /><p>Счётчики токенов основаны на usage API и могут иметь неполное покрытие. Cached и reasoning доступны, только если их сообщает сервер. Стоимость требует обе цены и полное покрытие input/output; тарифы cache отдельно не учитываются. Это оценка только успешных измеряемых запросов: прогрев и ошибки в стоимость не входят. Prediction usage не является телеметрией speculative decoding.{!run.schemaVersion || run.schemaVersion < 2 ? ' В этой сохранённой версии часть расширенных измерений отсутствует.' : ''}</p></div>
    </section>
    {stages.length > 0 && <section className="panel advanced-panel"><div className="advanced-panel-heading"><h2>Ступени нагрузки</h2><span className="advanced-caption">{stages.length} ступеней</span></div>{stages.length > 1 && <SweepChart stages={stages} />}<div className="advanced-table-scroll" tabIndex="0" aria-label="Метрики ступеней, горизонтальная прокрутка"><table className="advanced-table"><thead><tr><th>Ступень</th><th>Параллельность</th><th>Статус</th><th>Завершено</th><th>Время</th><th>Output tok/s</th><th>Запросов / с</th><th>TTFT p95, мс</th><th>Latency p95, мс</th><th>Ошибки</th></tr></thead><tbody>{stages.map((s, i) => <tr key={s.index ?? i}><th scope="row">{(s.index ?? i) + 1}</th><td>{fmt(s.concurrency, 0)}</td><td>{({ pending: 'Ожидает', warmup: 'Прогрев', measurement: 'Измерение', running: 'Выполняется', completed: 'Завершена', cancelled: 'Остановлена', interrupted: 'Прервана', failed: 'Ошибка' })[s.status] || s.status || '—'}</td><td>{fmt(s.completed, 0)}</td><td>{duration(s.elapsedMs)}</td><td>{fmt(s.metrics?.throughput)}</td><td>{fmt(s.metrics?.requestsPerSecond)}</td><td>{fmt(s.metrics?.distributions?.ttftMs?.p95)}</td><td>{fmt(s.metrics?.distributions?.latencyMs?.p95 ?? s.metrics?.latencyP95Ms)}</td><td>{fmt(s.metrics?.errors, 0)}</td></tr>)}</tbody></table></div></section>}
  </div>;
}

const comparisonSettings = [ ['endpoint', 'Endpoint'], ['model', 'Модель'], ['concurrency', 'Параллельность'], ['totalRequests', 'Лимит запросов'], ['maxTokens', 'Лимит output'], ['timeoutSeconds', 'Таймаут, с'], ['tokenParameter', 'Параметр лимита'], ['includeUsage', 'Запрашивать usage'], ['continuousUsage', 'Usage каждого чанка'], ['loadMode', 'Режим нагрузки'], ['requestRate', 'Заданный RPS'], ['arrivalPattern', 'Интервалы'], ['warmupRequests', 'Прогрев'], ['rampUpSeconds', 'Разгон, с'], ['durationSeconds', 'Лимит времени, с'], ['sweepConcurrency', 'Ступени'], ['datasetSelection', 'Выбор запросов'], ['randomSeed', 'Seed нагрузки'], ['cacheBust', 'Уникальный префикс'], ['temperature', 'Temperature'], ['topP', 'Top P'], ['seed', 'Seed модели'], ['sloTtftMs', 'SLO TTFT'], ['sloLatencyMs', 'SLO latency'], ['sloTpotMs', 'SLO TPOT'], ['inputPricePerMillion', 'Input USD / млн'], ['outputPricePerMillion', 'Output USD / млн'], ['prompt', 'Основной запрос'], ['system', 'Системный контекст'], ['prompts', 'Набор запросов'] ];
const settingValue = (run, key) => run.config?.[key] ?? defaultAdvanced[key] ?? null;
function settingText(value) { if (value == null) return 'Не задано'; if (typeof value === 'boolean') return value ? 'Да' : 'Нет'; if (Array.isArray(value)) return value.length ? JSON.stringify(value) : 'Пусто'; return String(value); }

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
  const metricRows = [['throughput', 'Output throughput, tok/s'], ['inputThroughput', 'Input throughput, tok/s'], ['requestsPerSecond', 'Успешных запросов / с'], ['ttftMs', 'Средний TTFT, мс'], ['latencyP95Ms', 'Latency p95, мс'], ['goodputRequestsPerSecond', 'SLO goodput, запросов / с'], ['success', 'Успешно'], ['errors', 'Ошибки'], ['costUsd', 'Стоимость, USD']];
  const maxThroughput = Math.max(1, ...runs.map(run => Number.isFinite(run.metrics?.throughput) ? run.metrics.throughput : 0));
  return createPortal(<div className="advanced-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section ref={panel} className="advanced-compare panel" role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="advanced-panel-heading"><div><h2 id={titleId}>Сравнение запусков</h2><p className="advanced-note">Проверьте различия конфигураций перед сравнением скорости.</p></div><button ref={close} type="button" className="advanced-close" aria-label="Закрыть сравнение" onClick={onClose}><X size={20} /></button></div>
    <div className="advanced-compare-body"><div className="advanced-compare-bars" aria-label="Сравнение output throughput">{runs.map((run, index) => <div className="advanced-compare-bar" key={run.id ?? index}><div><strong>{run.name || `Запуск ${index + 1}`}</strong>{run.config?.demo && <span className="advanced-demo"><FlaskConical size={12} />Демо</span>}<span>{fmt(run.metrics?.throughput)} tok/s</span></div><div className="advanced-bar-track"><div style={{ width: Number.isFinite(run.metrics?.throughput) ? `${run.metrics.throughput / maxThroughput * 100}%` : '0%' }} /></div></div>)}</div>
      <p className="advanced-scroll-hint">Прокрутите таблицу вправо, чтобы увидеть все запуски.</p><div className="advanced-table-scroll" tabIndex="0" aria-label="Сравнение метрик, горизонтальная прокрутка"><table className="advanced-table advanced-compare-table" style={{ minWidth: Math.max(530, 180 + runs.length * 180) }}><thead><tr><th scope="col">Метрика</th>{runs.map((run, index) => <th scope="col" key={run.id ?? index}>{run.name || `Запуск ${index + 1}`}<small>{run.config?.model}{run.config?.demo ? ' · Демо' : ''}</small><small>{({ completed: 'Завершён', running: 'Выполняется', stopping: 'Останавливается', cancelled: 'Остановлен', failed: 'Ошибка', interrupted: 'Прерван' })[run.status] || run.status || '—'} · {run.startedAt ? new Date(run.startedAt).toLocaleString('ru-RU') : '—'}</small></th>)}</tr></thead><tbody>{metricRows.map(([key, label]) => <tr key={key}><th scope="row">{label}</th>{runs.map((run, index) => <td key={run.id ?? index}>{fmt(run.metrics?.[key], key === 'costUsd' ? 6 : 2)}</td>)}</tr>)}</tbody></table></div>
      <div className="advanced-comparison-heading"><h3>Различия конфигураций</h3><span>{differenceKeys.length ? `${differenceKeys.length} параметров` : 'Параметры совпадают'}</span></div>
      {differenceKeys.length > 0 && <div className="advanced-table-scroll" tabIndex="0" aria-label="Различия настроек, горизонтальная прокрутка"><table className="advanced-table advanced-differences" style={{ minWidth: Math.max(530, 180 + runs.length * 180) }}><thead><tr><th scope="col">Параметр</th>{runs.map((run, index) => <th scope="col" key={run.id ?? index}>{run.name || `Запуск ${index + 1}`}</th>)}</tr></thead><tbody>{differenceKeys.map(([key, label]) => <tr key={key}><th scope="row">{label}</th>{runs.map((run, index) => <td key={run.id ?? index}><div>{settingText(settingValue(run, key))}</div></td>)}</tr>)}</tbody></table></div>}
      <p className="advanced-note advanced-comparison-note">Демо содержит синтетические данные. Разная нагрузка, запросы, лимиты, SLO и покрытие usage могут менять результат. «—» — значение не измерено или недоступно.</p>
    </div></section></div>, document.body);
}
