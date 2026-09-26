import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, CircleHelp, Plus, Radio, X } from 'lucide-react';
import { ConfigForm, Results, History, Help, isRunning } from './components.jsx';
import RequestDetails from './RequestDetails';
import { AdvancedSettings, AdvancedResults, CompareRuns } from './advanced.jsx';
import { loadConnectionHistory, rememberConnectionValue, connectionValues } from './connection-history.mjs';
import { ADVANCED_DEFAULTS, simpleConfig, portableConfig } from '../shared/settings.mjs';

const defaults = { ...ADVANCED_DEFAULTS, name: '', endpoint: 'http://localhost:8000/v1', model: '', apiKey: '', system: 'You are a helpful assistant. Respond in detail with clear, logical explanations.', prompt: 'Explain how a large language model works, from input tokenization to generating a response. Give examples and describe each stage.', concurrency: 4, totalRequests: 12, maxTokens: 256, timeoutSeconds: 120, includeUsage: true, tokenParameter: 'max_tokens' };
async function api(path, options) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `Server error: ${response.status}`); }
  return response.status === 204 ? null : response.json();
}

export default function App() {
  const [connectionHistory, setConnectionHistory] = useState(loadConnectionHistory);
  const connectionRef = useRef(connectionHistory);
  const [config, setConfig] = useState(() => ({ ...defaults, ...connectionHistory.last }));
  const endpointRef = useRef(config.endpoint); endpointRef.current = config.endpoint;
  function rememberConnection(field, value, commit = false) {
    const next = rememberConnectionValue(connectionRef.current, field, value, commit);
    connectionRef.current = next; setConnectionHistory(next);
  }
  const [advanced, setAdvanced] = useState(() => localStorage.getItem('burner-ui-mode') === 'advanced');
  const [models, setModels] = useState([]);
  const [discovering, setDiscovering] = useState(false);
  const [compareIds, setCompareIds] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [comparing, setComparing] = useState(false);
  const configInput = useRef(null);
  const closeComparison = useCallback(() => setComparison(null), []);
  const stageCount = advanced && !config.loadCurve?.length ? config.sweepConcurrency?.length || 1 : 1;
  const plannedRequests = (config.totalRequests + (advanced ? config.warmupRequests || 0 : 0)) * stageCount;
  const [view, setView] = useState(() => sessionStorage.getItem('burner-workspace') === 'stress' ? 'stress' : 'test');
  const [stressDuration, setStressDuration] = useState(60);
  const stress = view === 'stress';
  useEffect(() => { if (view !== 'history') sessionStorage.setItem('burner-workspace', view); }, [view]);
  function workloadConfig() {
    return { ...(advanced ? config : simpleConfig(config)), testMode: stress ? 'stress' : 'benchmark', ...(stress ? { totalRequests: null, durationSeconds: stressDuration, loadCurve: [], sweepConcurrency: [] } : {}) };
  }
  const [runs, setRuns] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [run, setRun] = useState(null);
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);
  const [inspectedRequest, setInspectedRequest] = useState(null);
  const closeRequest = useCallback(() => setInspectedRequest(null), []);
  useEffect(() => { setInspectedRequest(null); }, [selectedId]);
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

  useEffect(() => { setModels([]); }, [config.endpoint]);

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
          setConfig({ ...defaults, ...data.config, totalRequests: data.config.totalRequests ?? defaults.totalRequests, durationSeconds: data.config.testMode === 'stress' ? 0 : data.config.durationSeconds, apiKey: '', ...(data.config.demo ? { endpoint: defaults.endpoint, model: '' } : {}), ...connectionRef.current.last });
          setView(data.config.testMode === 'stress' ? 'stress' : 'test');
          if (data.config.testMode === 'stress') setStressDuration(data.config.durationSeconds);
          setSettingsCollapsed(false);
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
    rememberConnection('endpoint', config.endpoint, true); rememberConnection('model', config.model, true);
    setBusy(true); setError('');
    try {
      const created = await api('/runs', { method: 'POST', body: JSON.stringify({ ...workloadConfig(), demo, ...(demo ? { model: config.model || 'demo-model', endpoint: 'http://localhost/demo/v1', apiKey: '' } : {}) }) });
      setRun(created); setSelectedId(created.id); setPage(0); setActiveId(created.id); setView(created.config.testMode === 'stress' ? 'stress' : 'test'); setSettingsCollapsed(true); setInspectedRequest(null);
      setRuns(old => [created, ...old.filter(r => r.id !== created.id)]);
      if (window.innerWidth < 900) setTimeout(() => document.querySelector('.results-column')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function stop() {
    setStopping(true);
    try { await api(`/runs/${selectedId}/stop`, { method: 'POST' }); } catch (e) { setError(e.message); } finally { setStopping(false); }
  }
  function openRun(id) { setSettingsCollapsed(false); setInspectedRequest(null); if (id !== selectedId) setRun(null); setSelectedId(id); setPage(0); setView(runs.find(item => item.id === id)?.config.testMode === 'stress' ? 'stress' : 'test'); }
  function repeat() {
    if (!run) return;
    setSettingsCollapsed(false);
    const { demo, ...saved } = run.config;
    setConfig({ ...defaults, ...saved, totalRequests: saved.totalRequests ?? defaults.totalRequests, durationSeconds: saved.testMode === 'stress' ? 0 : saved.durationSeconds, apiKey: '', ...(demo ? { endpoint: defaults.endpoint } : {}) });
    if (hasAdvanced(saved)) { setAdvanced(true); localStorage.setItem('burner-ui-mode', 'advanced'); }
    setView(saved.testMode === 'stress' ? 'stress' : 'test');
    if (saved.testMode === 'stress') setStressDuration(saved.durationSeconds);
    document.querySelector('.config-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  function changeMode() { setSettingsCollapsed(false); setAdvanced(value => { localStorage.setItem('burner-ui-mode', value ? 'simple' : 'advanced'); return !value; }); }
  async function discover() {
    const endpoint = config.endpoint;
    rememberConnection('endpoint', endpoint, true);
    setDiscovering(true); setError('');
    try { const data = await api('/models', { method: 'POST', body: JSON.stringify({ endpoint: config.endpoint, apiKey: config.apiKey }) }); if (endpointRef.current !== endpoint) return; setModels(data.models); if (!data.models.length) setError('The endpoint returned no models. Enter a model name manually.'); }
    catch (e) { setError(e.message); } finally { setDiscovering(false); }
  }
  async function compare() {
    setComparing(true);
    try { setComparison(await Promise.all(compareIds.map(id => api(`/runs/${id}`)))); } catch (e) { setError(e.message); } finally { setComparing(false); }
  }
  function exportConfig() {
    const blob = new Blob([JSON.stringify({ schemaVersion: 2, config: portableConfig(workloadConfig()) }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'llm-burner-config.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importConfig(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setError('Configuration must be smaller than 3 MiB.'); return; }
    try {
      const parsed = JSON.parse(await file.text()); const candidate = parsed.config ?? parsed;
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Expected a JSON configuration object.');
      const checked = await api('/config/validate', { method: 'POST', body: JSON.stringify({ ...defaults, ...portableConfig(candidate), apiKey: '' }) });
      setConfig({ ...checked, totalRequests: checked.totalRequests ?? defaults.totalRequests, durationSeconds: checked.testMode === 'stress' ? 0 : checked.durationSeconds, apiKey: '' });
      setView(checked.testMode === 'stress' ? 'stress' : 'test');
      if (checked.testMode === 'stress') setStressDuration(checked.durationSeconds); setSettingsCollapsed(false); setError('');
    } catch (e) { setError(e instanceof SyntaxError ? 'Invalid configuration JSON.' : e.message); }
  }
  function preset(name) {
    const presets = {
      latency: { concurrency: 1, totalRequests: 20, maxTokens: 256, warmupRequests: 2 },
      throughput: { concurrency: 8, totalRequests: 64, maxTokens: 512, warmupRequests: 4 },
      sweep: { concurrency: 8, totalRequests: 32, maxTokens: 256, warmupRequests: 2, sweepConcurrency: [1, 2, 4, 8] },
      rate: { loadMode: 'rate', concurrency: 8, requestRate: 2, totalRequests: 60, durationSeconds: 30, maxTokens: 256 },
    };
    if (presets[name]) { setSettingsCollapsed(false); setConfig(old => ({ ...old, ...ADVANCED_DEFAULTS, ...presets[name] })); }
  }
  function newTest() { setSettingsCollapsed(false); setInspectedRequest(null); setView(stress ? 'stress' : 'test'); setSelectedId(null); setPage(0); sessionStorage.removeItem('burner-selected'); }

  function switchWorkspace(target) {
    setView(target); setSettingsCollapsed(false);
    if (run && (run.config.testMode === 'stress' ? 'stress' : 'test') !== target) {
      setSelectedId(null); setPage(0); sessionStorage.removeItem('burner-selected');
    }
  }

  return <div className="app-shell">
    <header className="app-header"><div className="app-header-inner">
      <a className="brand" href="#" aria-label="LLM Burner — new test" onClick={e => { e.preventDefault(); newTest(); }}><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span>LLM Burner</span></a>
      <nav className="main-nav" aria-label="Main navigation"><button aria-label="Benchmark" aria-current={view === 'test' ? 'page' : undefined} className={`nav-item ${view === 'test' ? 'selected' : ''}`} onClick={() => switchWorkspace('test')}>Benchmark{activeId && <span className="live-dot" />}</button><button aria-label="Stress test" aria-current={stress ? 'page' : undefined} className={`nav-item ${stress ? 'selected' : ''}`} onClick={() => switchWorkspace('stress')}>Stress test</button><button aria-label="History" aria-current={view === 'history' ? 'page' : undefined} className={`nav-item ${view === 'history' ? 'selected' : ''}`} onClick={() => setView('history')}>History<span className="nav-count">{runs.length}</span></button></nav>
      <div className="header-utilities"><span className={`connection ${online === false ? 'offline' : ''}`}><i />{online == null ? 'Connecting' : online ? 'Local server online' : 'Server disconnected'}</span><button className="icon-button" aria-label="Reading results" onClick={() => setHelp(true)}><CircleHelp size={18} /></button></div>
    </div></header>
    <main className="main-content"><div className={`page-content ${advanced ? 'advanced-mode' : 'simple-mode'}`}><div className="page-heading"><div><h1>{view === 'history' ? 'Run history' : stress ? 'Stress test your model' : 'Benchmark your model'}</h1><p>{view === 'history' ? 'Saved measurements, ready to compare.' : stress ? 'Sustained load for a set duration. No request-count limit.' : 'Find the limits of your endpoint.'}</p></div><button className="button new-test" onClick={newTest}><Plus size={16} />New test</button></div>
      <div className="mode-toolbar"><div className="mode-switch"><span className={!advanced ? 'mode-current' : ''}>Simple</span><button type="button" role="switch" aria-label="Advanced mode" aria-checked={advanced} onClick={changeMode}><span /></button><span className={advanced ? 'mode-current' : ''}>Advanced</span></div><p>{advanced ? 'Load profiles, distributions & SLOs' : 'Essential controls'}</p>{advanced && view !== 'history' && <div className="config-tools">{!stress && <select aria-label="Load preset" value="" disabled={!!activeId} onChange={e => preset(e.target.value)}><option value="">Load presets</option><option value="latency">Latency · 1 concurrent</option><option value="throughput">Throughput · 8 concurrent</option><option value="sweep">Sweep · 1 / 2 / 4 / 8</option><option value="rate">Rate · 2 RPS / 30 s</option></select>}<button className="button" disabled={!!activeId} onClick={() => configInput.current?.click()}>Import</button><button className="button" onClick={exportConfig}>Save settings</button><input ref={configInput} hidden type="file" accept=".json,application/json" aria-label="Import configuration" onChange={importConfig} /></div>}</div>
      {error && <div className="alert" role="alert"><InfoIcon /><span>{error}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setError('')}><X size={16} /></button></div>}
      {online === false && <div className="alert" role="status">The server is disconnected. This page will reconnect automatically. Start the server with npm start.</div>}
      {activeId && selectedId !== activeId && <button className="active-banner" onClick={() => openRun(activeId)}><Radio size={17} />A test is running<span>View progress <ArrowRight size={15} /></span></button>}
      {view === 'history' ? <History runs={runs} openRun={openRun} deleteRun={deleteRun} more={more} loadMore={loadMore} compareIds={compareIds} toggleCompare={id => setCompareIds(old => old.includes(id) ? old.filter(value => value !== id) : [...old, id].slice(0, 4))} onCompare={compare} comparing={comparing} /> : <div className="workspace-grid"><ConfigForm stress={stress} stressDuration={stressDuration} setStressDuration={setStressDuration} collapsed={settingsCollapsed} onToggleSettings={() => setSettingsCollapsed(value => !value)} run={run} config={config} setConfig={setConfig} start={start} busy={busy} active={!!activeId} onDemo={() => start(true)} onDiscoverModels={discover} models={models} discovering={discovering} plannedRequests={plannedRequests} rememberConnection={rememberConnection} endpointSuggestions={connectionValues('endpoint', [...connectionHistory.endpoints, ...runs.filter(r => !r.config.demo).map(r => r.config.endpoint)])} modelSuggestions={connectionValues('model', [...connectionHistory.models, ...models, ...runs.filter(r => !r.config.demo).map(r => r.config.model)])} advancedContent={advanced ? <AdvancedSettings stress={stress} config={config} setConfig={setConfig} disabled={busy || !!activeId} /> : null} /><Results progressInSettings={settingsCollapsed} onInspectRequest={setInspectedRequest} run={run} stop={stop} repeat={repeat} page={page} setPage={setPage} stopping={stopping} advancedContent={advanced ? <AdvancedResults run={run} /> : null} /></div>}
      <footer className="page-footer"><span><span className="footer-dot" />Measurements run from this computer</span><button onClick={() => setHelp(true)}>Measurement methodology <CircleHelp size={13} /></button></footer></div></main>{comparison && <CompareRuns runs={comparison} onClose={closeComparison} />}{help && <Help close={() => setHelp(false)} />}{inspectedRequest && run && <RequestDetails runId={run.id} request={inspectedRequest} requests={run.results || []} onSelectRequest={setInspectedRequest} onClose={closeRequest} />}
  </div>;
}
function InfoIcon() { return <CircleHelp size={18} />; }

function hasAdvanced(config) { return Object.keys(ADVANCED_DEFAULTS).filter(key => !(config.testMode === 'stress' && key === 'durationSeconds')).some(key => JSON.stringify(config[key] ?? ADVANCED_DEFAULTS[key]) !== JSON.stringify(ADVANCED_DEFAULTS[key])); }
