import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownToLine, ArrowUpRight, Check, ChevronLeft, ChevronRight, Copy, X } from 'lucide-react';
import './request-details.css';

function JsonPayload({ title, description, value, testId }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text); setCopied(true); setCopyError(false);
      clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 2000);
    } catch { setCopyError(true); }
  }
  return <section className="payload-card">
    <div className="payload-heading"><div><h3>{title}</h3><p>{description}</p></div><button type="button" className="icon-button" aria-label={`Copy ${title.toLowerCase()}`} onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div>
    {copyError && <p role="status" className="payload-copy-error">Copy unavailable. Select the text to copy it manually.</p>}
    <pre tabIndex="0" data-testid={testId}>{text ?? 'No body received.'}</pre>
  </section>;
}

export default function RequestDetails({ runId, request, requests = [], onSelectRequest, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const dialog = useRef(null);
  const close = useRef(null);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError('');
    fetch(`/api/runs/${encodeURIComponent(runId)}/requests/${request.index}`, { signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Could not load request details.');
        if (!controller.signal.aborted) setData(body);
      }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [runId, request.index]);
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; close.current?.focus();
    function keydown(event) {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); }
      if (event.key !== 'Tab') return;
      const items = [...(dialog.current?.querySelectorAll('button:not(:disabled), a[href], summary, [tabindex="0"]') || [])].filter(el => el.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus(); };
  }, []);
  const ordered = [...requests].sort((a, b) => a.index - b.index);
  const position = ordered.findIndex(item => item.index === request.index);
  const details = data?.details;
  const row = data?.request || request;
  const duration = row.durationMs == null ? '—' : `${(row.durationMs / 1000).toFixed(2)} s`;
  return createPortal(<div className="request-inspector-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="request-inspector" role="dialog" aria-modal="true" aria-labelledby="request-inspector-title" ref={dialog}>
      <header className="request-inspector-header"><div><h2 id="request-inspector-title">Request #{String(request.index + 1).padStart(3, '0')}</h2><p>Request payload, response and timing.</p></div><button type="button" ref={close} className="icon-button" aria-label="Close request details" onClick={onClose}><X size={20} /></button></header>
      <div className="request-inspector-content">
        <dl className="request-facts"><div><dt>Status</dt><dd>{row.status}</dd></div><div><dt>HTTP</dt><dd>{row.httpStatus ?? '—'}</dd></div><div><dt>Duration</dt><dd>{duration}</dd></div><div><dt>First token</dt><dd>{row.ttftMs == null ? '—' : `${Math.round(row.ttftMs)} ms`}</dd></div><div><dt>Input / output tokens</dt><dd>{row.inputTokens ?? '—'} / {row.outputTokens ?? '—'}</dd></div><div><dt>Phase / stage</dt><dd>{row.phase || 'measurement'} / {(row.stageIndex ?? 0) + 1}</dd></div></dl>
        {row.error && <p className="request-inspector-notice error-text" role="status">{row.error}</p>}
        {!data && !error && <p role="status" className="request-inspector-notice">Loading request details…</p>}
        {error && <p role="alert" className="request-inspector-notice error-text">{error}</p>}
        {data && !details && <p className="request-inspector-notice">{row.detailStatus === 'limit' ? 'Payload storage reached the 64 MiB limit for this run. Metrics are still available.' : 'Payloads were not saved for this request. Run a new test to inspect its input and output.'}</p>}
        {details && <>
          <div className="request-route"><ArrowUpRight size={16} /><strong>{details.request.method}</strong><code>{details.request.url}</code></div>
          {details.truncated && <p className="request-inspector-notice">The capture size limit was reached. The payload below is partial; benchmark metrics still use the received stream.</p>}
          <div className="request-payloads">
            <JsonPayload title="Input request" description="Sent JSON body · authorization is not stored" value={details.request.body} testId="request-input" />
            <JsonPayload title="Output response" description={details.response.format === 'assembled-sse' ? `Assembled from SSE chunks${details.response.done ? ' · [DONE] received' : ' · no [DONE] marker'}` : 'HTTP response body'} value={details.response.body} testId="request-output" />
          </div>
          <details className="request-metadata"><summary>HTTP metadata</summary><pre>{JSON.stringify({ request: { method: details.request.method, url: details.request.url, headers: details.request.headers }, response: { status: details.response.status, contentType: details.response.contentType, format: details.response.format, done: details.response.done }, truncated: details.truncated }, null, 2)}</pre></details>
        </>}
        <details className="request-metadata"><summary>All request metrics</summary><pre>{JSON.stringify(row, null, 2)}</pre></details>
      </div>
      <footer className="request-inspector-footer"><div className="request-navigation"><button className="icon-button" aria-label="Previous request" disabled={position <= 0} onClick={() => onSelectRequest?.(ordered[position - 1])}><ChevronLeft size={17} /></button><span>{position >= 0 ? `${position + 1} / ${ordered.length} on this page` : 'Saved locally'}</span><button className="icon-button" aria-label="Next request" disabled={position < 0 || position >= ordered.length - 1} onClick={() => onSelectRequest?.(ordered[position + 1])}><ChevronRight size={17} /></button></div><a className="text-link" href={`/api/runs/${encodeURIComponent(runId)}/requests/${request.index}`} download={`request-${request.index + 1}.json`}><ArrowDownToLine size={15} />Download details</a></footer>
    </section>
  </div>, document.body);
}
