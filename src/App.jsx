import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, CircleHelp, Clock3, ExternalLink, Plus, Radio, Server, X, Zap } from 'lucide-react';
import { ConfigForm, Results, History, Help, isRunning } from './components.jsx';
import { AdvancedSettings, AdvancedResults, CompareRuns } from './advanced.jsx';
import { ADVANCED_DEFAULTS, simpleConfig, portableConfig } from '../shared/settings.mjs';

const defaults = { ...ADVANCED_DEFAULTS, name: '', endpoint: 'http://localhost:8000/v1', model: '', apiKey: '', system: 'Ты — полезный ассистент. Отвечай подробно и последовательно.', prompt: 'Объясни, как работает большая языковая модель: от токенизации входного текста до генерации ответа. Приведи примеры и опиши каждый этап.', concurrency: 4, totalRequests: 12, maxTokens: 256, timeoutSeconds: 120, includeUsage: true, tokenParameter: 'max_tokens' };
async function api(path, options) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `Ошибка сервера: ${response.status}`); }
  return response.status === 204 ? null : response.json();
}

export default function App() {
  const [config, setConfig] = useState(defaults);
  const [advanced, setAdvanced] = useState(() => localStorage.getItem('burner-ui-mode') === 'advanced');
  const [models, setModels] = useState([]);
  const [discovering, setDiscovering] = useState(false);
  const [compareIds, setCompareIds] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [comparing, setComparing] = useState(false);
  const configInput = useRef(null);
  const closeComparison = useCallback(() => setComparison(null), []);
  const plannedRequests = config.totalRequests * (advanced && config.sweepConcurrency?.length ? config.sweepConcurrency.length : 1) + (advanced ? (config.warmupRequests || 0) * (config.sweepConcurrency?.length || 1) : 0);
  const [view, setView] = useState('test');
  const [runs, setRuns] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [run, setRun] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [online, setOnline] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const [help, setHelp] = useState(false);
  const [page, setPage] = useState(0);
  const [historyCount, setHistoryCount] = useState(50);
  const [more, setMore] = useState(false);
  const initial = useRef(true);
  const restoreConfigId = useRef(null);

  useEffect(() => {
    let cancelled = false, timer;
    async function refresh() {
      try {
        const [health, first] = await Promise.all([api('/health'), api('/runs')]);
        if (cancelled) return;
        setOnline(true); setActiveId(health.activeId);
        setRuns(old => [...first, ...old.filter(r => !first.some(n => n.id === r.id))]);
        if (historyCount === 50) setMore(first.length === 50);
        if (initial.current) {
          initial.current = false;
          if (health.activeId) { restoreConfigId.current = health.activeId; setSelectedId(health.activeId); }
          else { const remembered = sessionStorage.getItem('burner-selected'); if (first.some(r => r.id === remembered)) { restoreConfigId.current = remembered; setSelectedId(remembered); } }
        }
      } catch { if (!cancelled) setOnline(false); }
      if (!cancelled) timer = setTimeout(refresh, 1500);
    }
    refresh(); return () => { cancelled = true; clearTimeout(timer); };
  }, [historyCount]);

  useEffect(() => {
    if (!selectedId) { setRun(null); return; }
    sessionStorage.setItem('burner-selected', selectedId);
    let cancelled = false, timer;
    async function refresh() {
      try {
        const data = await api(`/runs/${selectedId}?offset=${page * 100}`);
        if (cancelled) return;
        setRun(data);
        if (restoreConfigId.current === selectedId) {
          setConfig({ ...defaults, ...data.config, apiKey: '', ...(data.config.demo ? { endpoint: defaults.endpoint, model: '' } : {}) });
          restoreConfigId.current = null;
        }
        if (isRunning(data)) timer = setTimeout(refresh, 700);
        else setActiveId(id => id === selectedId ? null : id);
      } catch (e) { if (!cancelled) { setError(e.message); timer = setTimeout(refresh, 3000); } }
    }
    refresh(); return () => { cancelled = true; clearTimeout(timer); };
  }, [selectedId, page]);

  useEffect(() => {
    if (!help) return;
    const previous = document.activeElement;
    const listener = e => {
      if (e.key === 'Escape') setHelp(false);
      if (e.key === 'Tab') {
        const dialog = document.querySelector('[role="dialog"]');
        const items = dialog?.querySelectorAll('button, a, input, select, textarea, [tabindex="0"]');
        if (!items?.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', listener); const oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', listener); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, [help]);

  async function start(demo) {
    if (busy || activeId) return;
    setBusy(true); setError('');
    try {
      const created = await api('/runs', { method: 'POST', body: JSON.stringify({ ...(advanced ? config : simpleConfig(config)), demo, ...(demo ? { model: config.model || 'demo-model', endpoint: 'http://localhost/demo/v1', apiKey: '' } : {}) }) });
      setRun(created); setSelectedId(created.id); setPage(0); setActiveId(created.id); setView('test');
      setRuns(old => [created, ...old.filter(r => r.id !== created.id)]);
      if (window.innerWidth < 900) setTimeout(() => document.querySelector('.results-column')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function stop() {
    setStopping(true);
    try { await api(`/runs/${selectedId}/stop`, { method: 'POST' }); } catch (e) { setError(e.message); } finally { setStopping(false); }
  }
  function openRun(id) { if (id !== selectedId) setRun(null); setSelectedId(id); setPage(0); setView('test'); }
  function repeat() {
    if (!run) return;
    const { demo, ...saved } = run.config;
    setConfig({ ...defaults, ...saved, apiKey: '', ...(demo ? { endpoint: defaults.endpoint } : {}) });
    if (hasAdvanced(saved)) { setAdvanced(true); localStorage.setItem('burner-ui-mode', 'advanced'); }
    setView('test'); document.querySelector('.config-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function deleteRun(id) {
    try {
      await api(`/runs/${id}`, { method: 'DELETE' });
      setRuns(old => old.filter(r => r.id !== id)); setCompareIds(old => old.filter(value => value !== id));
      if (selectedId === id) { setSelectedId(null); sessionStorage.removeItem('burner-selected'); }
    } catch (e) { setError(e.message); }
  }
  async function loadMore() {
    try {
      const items = await api(`/runs?offset=${runs.length}`);
      setRuns(old => [...old, ...items.filter(r => !old.some(n => n.id === r.id))]); setHistoryCount(n => n + 50); setMore(items.length === 50);
    } catch (e) { setError(e.message); }
  }
  function changeMode() { setAdvanced(value => { localStorage.setItem('burner-ui-mode', value ? 'simple' : 'advanced'); return !value; }); }
  async function discover() {
    setDiscovering(true); setError('');
    try { const data = await api('/models', { method: 'POST', body: JSON.stringify({ endpoint: config.endpoint, apiKey: config.apiKey }) }); setModels(data.models); if (!data.models.length) setError('Endpoint вернул пустой список моделей. Укажите модель вручную.'); }
    catch (e) { setError(e.message); } finally { setDiscovering(false); }
  }
  async function compare() {
    setComparing(true);
    try { setComparison(await Promise.all(compareIds.map(id => api(`/runs/${id}`)))); } catch (e) { setError(e.message); } finally { setComparing(false); }
  }
  function exportConfig() {
    const blob = new Blob([JSON.stringify({ schemaVersion: 2, config: portableConfig(config) }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'llm-burner-config.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importConfig(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setError('Конфигурация должна быть меньше 3 MiB.'); return; }
    try {
      const parsed = JSON.parse(await file.text()); const candidate = parsed.config ?? parsed;
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Нужен JSON-объект конфигурации.');
      const checked = await api('/config/validate', { method: 'POST', body: JSON.stringify({ ...defaults, ...portableConfig(candidate), apiKey: '' }) });
      setConfig({ ...checked, apiKey: '' }); setError('');
    } catch (e) { setError(e instanceof SyntaxError ? 'Некорректный JSON конфигурации.' : e.message); }
  }
  function preset(name) {
    const presets = {
      latency: { concurrency: 1, totalRequests: 20, maxTokens: 256, warmupRequests: 2 },
      throughput: { concurrency: 8, totalRequests: 64, maxTokens: 512, warmupRequests: 4 },
      sweep: { concurrency: 8, totalRequests: 32, maxTokens: 256, warmupRequests: 2, sweepConcurrency: [1, 2, 4, 8] },
      rate: { loadMode: 'rate', concurrency: 8, requestRate: 2, totalRequests: 60, durationSeconds: 30, maxTokens: 256 },
    };
    if (presets[name]) setConfig(old => ({ ...old, ...ADVANCED_DEFAULTS, ...presets[name] }));
  }
  function newTest() { setView('test'); setSelectedId(null); setPage(0); sessionStorage.removeItem('burner-selected'); }

  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="#" aria-label="LLM Burner — новый тест" onClick={e => { e.preventDefault(); newTest(); }}><span className="brand-mark"><Zap size={22} fill="currentColor" /></span><span>llm<span className="brand-light">burner</span><small>Endpoint benchmark</small></span></a><div className="sidebar-caption">Рабочее пространство</div><nav aria-label="Основная навигация"><button aria-label="Тестирование" className={`nav-item ${view === 'test' ? 'selected' : ''}`} onClick={() => setView('test')}><Activity size={18} /><span>Тестирование</span>{activeId && <span className="live-dot" />}</button><button aria-label="История" className={`nav-item ${view === 'history' ? 'selected' : ''}`} onClick={() => setView('history')}><Clock3 size={18} /><span>История</span><span className="nav-count">{runs.length}</span></button></nav><div className="sidebar-bottom"><div className="local-card"><div className="local-icon"><Server size={17} /></div><div><strong>Локальное пространство</strong><p>История на вашем устройстве</p></div></div><button className="help-button" onClick={() => setHelp(true)}><CircleHelp size={17} />Как читать результаты<ExternalLink size={13} /></button><div className="version">LLM Burner <span>v1.0</span></div></div></aside>
    <main className="main-content"><header className="topbar"><div className="breadcrumb">Рабочее пространство <span>/</span><strong>{view === 'history' ? 'История' : 'Тестирование'}</strong></div><span className={`connection ${online === false ? 'offline' : ''}`}><i />{online == null ? 'Подключаемся' : online ? 'Сервер подключён' : 'Нет связи с сервером'}</span></header><div className={`page-content ${advanced ? 'advanced-mode' : 'simple-mode'}`}><div className="page-heading"><div><h1>{view === 'history' ? 'История замеров' : 'Испытайте свою модель'}</h1><p>{view === 'history' ? 'Каждый запуск сохранён. Вернитесь к цифрам и повторите тест.' : 'Скорость генерации, параллельная нагрузка и реальные цифры.'}</p></div><button className="button new-test" onClick={newTest}><Plus size={16} />Новый тест</button></div>
      <div className="mode-toolbar"><div className="mode-switch"><span className={!advanced ? 'mode-current' : ''}>Простой</span><button type="button" role="switch" aria-label="Расширенный режим" aria-checked={advanced} onClick={changeMode}><span /></button><span className={advanced ? 'mode-current' : ''}>Расширенный</span></div><p>{advanced ? 'Профили нагрузки, распределения и SLO' : 'Быстрый запуск с базовыми настройками'}</p>{advanced && view === 'test' && <div className="config-tools"><select aria-label="Пресет нагрузки" value="" disabled={!!activeId} onChange={e => preset(e.target.value)}><option value="">Пресеты нагрузки</option><option value="latency">Задержка · 1 поток</option><option value="throughput">Пропускная способность · 8 потоков</option><option value="sweep">Серия · 1 / 2 / 4 / 8</option><option value="rate">Частота · 2 RPS / 30 с</option></select><button className="button" disabled={!!activeId} onClick={() => configInput.current?.click()}>Импорт</button><button className="button" onClick={exportConfig}>Сохранить настройки</button><input ref={configInput} hidden type="file" accept=".json,application/json" aria-label="Импорт конфигурации" onChange={importConfig} /></div>}</div>
      {error && <div className="alert" role="alert"><InfoIcon /><span>{error}</span><button className="icon-button" aria-label="Закрыть сообщение" onClick={() => setError('')}><X size={16} /></button></div>}
      {online === false && <div className="alert" role="status">Нет связи с сервером. Интерфейс переподключится автоматически. Запустите сервер командой npm start.</div>}
      {activeId && selectedId !== activeId && <button className="active-banner" onClick={() => openRun(activeId)}><Radio size={17} />Сейчас выполняется тест<span>Открыть прогресс <ArrowRight size={15} /></span></button>}
      {view === 'history' ? <History runs={runs} openRun={openRun} deleteRun={deleteRun} more={more} loadMore={loadMore} compareIds={compareIds} toggleCompare={id => setCompareIds(old => old.includes(id) ? old.filter(value => value !== id) : [...old, id].slice(0, 4))} onCompare={compare} comparing={comparing} /> : <div className="workspace-grid"><ConfigForm config={config} setConfig={setConfig} start={start} busy={busy} active={!!activeId} onDemo={() => start(true)} onDiscoverModels={discover} models={models} discovering={discovering} plannedRequests={plannedRequests} advancedContent={advanced ? <AdvancedSettings config={config} setConfig={setConfig} disabled={busy || !!activeId} /> : null} /><Results run={run} stop={stop} repeat={repeat} page={page} setPage={setPage} stopping={stopping} advancedContent={advanced ? <AdvancedResults run={run} /> : null} /></div>}
      <footer className="page-footer"><span><span className="footer-dot" />Измерения выполняются с этого компьютера</span><button onClick={() => setHelp(true)}>О методике измерений <CircleHelp size={13} /></button></footer></div></main>{comparison && <CompareRuns runs={comparison} onClose={closeComparison} />}{help && <Help close={() => setHelp(false)} />}
  </div>;
}
function InfoIcon() { return <CircleHelp size={18} />; }

function hasAdvanced(config) { return Object.keys(ADVANCED_DEFAULTS).some(key => JSON.stringify(config[key] ?? ADVANCED_DEFAULTS[key]) !== JSON.stringify(ADVANCED_DEFAULTS[key])); }
