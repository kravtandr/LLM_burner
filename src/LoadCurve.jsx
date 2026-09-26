import { useId } from 'react';
import './load-curve.css';

const number = value => typeof value === 'number' && Number.isFinite(value);
const format = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value);

function validate(points, target, interpolation) {
  const limit = target === 'rate' ? 1000 : 128;
  const errors = points.map((point, index) => ({
    time: !number(point?.time) ? 'Enter a time in seconds.'
      : point.time < 0 || point.time > 3600 ? 'Time must be between 0 and 3,600 seconds.'
        : index === 0 && point.time !== 0 ? 'The first point must start at 0 seconds.'
          : index > 0 && number(points[index - 1]?.time) && point.time <= points[index - 1].time ? 'Each time must be greater than the previous time.' : '',
    value: !number(point?.value) ? 'Enter a load value.'
      : point.value < 0 || point.value > limit ? `Load must be between 0 and ${format(limit)}.`
        : target !== 'rate' && !Number.isInteger(point.value) ? 'Concurrency must be a whole number.' : '',
  }));
  let message = points.length < 2 || points.length > 32 ? 'Use between 2 and 32 points.' : '';
  if (!message && errors.every(error => !error.time && !error.value)) {
    const active = interpolation === 'step' ? points.slice(0, -1) : points;
    if (!active.some(point => point.value > 0)) message = 'The profile must include positive load before it ends.';
  }
  return { errors, message, valid: !message && errors.every(error => !error.time && !error.value) };
}

export function LoadCurveChart({ points = [], target = 'concurrency', interpolation = 'linear' }) {
  const titleId = useId(), descriptionId = useId();
  const list = Array.isArray(points) ? points : [];
  const validation = validate(list, target, interpolation);
  if (!validation.valid) return <div className="load-curve-chart-empty" role="status">Enter a valid profile to preview the load curve.</div>;
  // The terminal point stops dispatch; its value has no interval in step mode.
  const rendered = interpolation === 'step' ? list.map((point, index) => index === list.length - 1 ? { ...point, value: list[index - 1].value } : point) : list;
  const end = list.at(-1).time, peak = Math.max(1, ...rendered.map(point => point.value));
  const left = 48, right = 454, top = 22, bottom = 152;
  const x = time => left + time / end * (right - left);
  const y = value => bottom - value / peak * (bottom - top);
  const path = rendered.map((point, index) => index === 0 ? `M ${x(point.time)} ${y(point.value)}`
    : interpolation === 'step' ? `H ${x(point.time)} V ${y(point.value)}` : `L ${x(point.time)} ${y(point.value)}`).join(' ');
  const unit = target === 'rate' ? 'requests/s' : 'concurrent requests';
  return <figure className="load-curve-chart">
    <svg viewBox="0 0 480 190" role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
      <title id={titleId}>Planned {target === 'rate' ? 'request rate' : 'concurrency'} over time</title>
      <desc id={descriptionId}>{interpolation === 'step' ? 'Step' : 'Linear'} profile. {rendered.map(point => `${format(point.value)} ${unit} at ${format(point.time)} seconds`).join('; ')}. New dispatch ends at {format(end)} seconds.{interpolation === 'step' ? ' The terminal point value has no load interval.' : ''}</desc>
      {[0, 0.5, 1].map(fraction => <g key={fraction}>
        <line className="load-curve-grid" x1={left} x2={right} y1={y(peak * fraction)} y2={y(peak * fraction)} />
        <text className="load-curve-axis" x={left - 9} y={y(peak * fraction) + 4} textAnchor="end">{format(peak * fraction)}</text>
      </g>)}
      {[0, 0.5, 1].map(fraction => <text className="load-curve-axis" key={fraction} x={x(end * fraction)} y={bottom + 25} textAnchor={fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}>{format(end * fraction)}s</text>)}
      <path className="load-curve-fill" d={`${path} L ${right} ${bottom} L ${left} ${bottom} Z`} />
      <path className="load-curve-line" d={path} />
      {rendered.map((point, index) => <circle className="load-curve-point" key={index} cx={x(point.time)} cy={y(point.value)} r="3.5" />)}
    </svg>
    <figcaption><span>{unit}</span><span>Dispatch ends at {format(end)}s</span></figcaption>
  </figure>;
}

export function LoadCurveEditor({ config, setConfig, disabled = false }) {
  const id = useId();
  const points = Array.isArray(config.loadCurve) ? config.loadCurve : [];
  const enabled = points.length > 0;
  const target = config.curveTarget || 'concurrency';
  const interpolation = config.curveInterpolation || 'linear';
  const validation = validate(points, target, interpolation);
  const limit = target === 'rate' ? 1000 : 128;
  const unit = target === 'rate' ? 'Requests / second' : 'Concurrency';
  const update = change => setConfig(previous => ({ ...previous, ...change }));
  function preset(name, nextTarget = target) {
    const configured = nextTarget === 'rate' ? config.requestRate : config.concurrency;
    const peak = Math.min(nextTarget === 'rate' ? 1000 : 128, Math.max(1, number(configured) ? configured : 4));
    const low = nextTarget === 'rate' ? Math.max(0.1, peak / 4) : Math.max(1, Math.floor(peak / 4));
    const profiles = {
      ramp: [{ time: 0, value: 0 }, { time: 45, value: peak }, { time: 60, value: peak }],
      spike: [{ time: 0, value: low }, { time: 20, value: low }, { time: 21, value: peak }, { time: 35, value: peak }, { time: 36, value: low }, { time: 60, value: low }],
      wave: [{ time: 0, value: low }, { time: 15, value: peak }, { time: 30, value: low }, { time: 45, value: peak }, { time: 60, value: low }],
    };
    update({ loadCurve: profiles[name], curveTarget: nextTarget, curveInterpolation: name === 'spike' ? 'step' : 'linear', loadMode: nextTarget, sweepConcurrency: [], rampUpSeconds: 0, durationSeconds: 0 });
  }
  function edit(index, key, text) {
    // Keep invalid drafts in config: a failed edit must never run a previous valid profile.
    update({ loadCurve: points.map((point, current) => current === index ? { ...point, [key]: text === '' ? '' : Number(text) } : point) });
  }
  function addPoint() {
    if (points.length >= 32) return;
    const last = points.at(-1), previous = points.at(-2);
    if (number(last?.time) && last.time >= 3600 && number(previous?.time) && previous.time < last.time) {
      update({ loadCurve: [...points.slice(0, -1), { time: (previous.time + last.time) / 2, value: previous.value }, last] });
    } else update({ loadCurve: [...points, { time: number(last?.time) ? Math.min(3600, last.time + 10) : '', value: number(last?.value) ? last.value : 1 }] });
  }
  return <section className="load-curve-editor" aria-labelledby={`${id}-title`}>
    <div className="load-curve-heading">
      <div><h3 id={`${id}-title`}>Load curve</h3><p>Shape how new requests arrive over time.</p></div>
      <label className="load-curve-toggle"><input type="checkbox" checked={enabled} disabled={disabled} onChange={event => event.target.checked ? preset('ramp') : update({ loadCurve: [] })} aria-label="Enable load curve" /><span aria-hidden="true" /><b>{enabled ? 'On' : 'Off'}</b></label>
    </div>
    {enabled && <fieldset disabled={disabled} className="load-curve-body">
      <legend className="load-curve-sr-only">Load curve settings</legend>
      <div className="load-curve-settings">
        <label><span>Control</span><select aria-label="Control" value={target} onChange={event => update({ curveTarget: event.target.value, loadMode: event.target.value })} ref={node => node?.setCustomValidity(validation.message)} aria-invalid={!!validation.message} aria-describedby={validation.message ? `${id}-error` : undefined}>
          <option value="concurrency">Concurrency</option><option value="rate">Request rate (RPS)</option>
        </select></label>
        <label><span>Between points</span><select aria-label="Between points" value={interpolation} onChange={event => update({ curveInterpolation: event.target.value })}>
          <option value="linear">Linear</option><option value="step">Step</option>
        </select></label>
      </div>
      <div className="load-curve-presets" aria-label="Load curve presets"><span>Presets</span>{['ramp', 'spike', 'wave'].map(name => <button type="button" key={name} onClick={() => preset(name)}>{name[0].toUpperCase() + name.slice(1)}</button>)}</div>
      <LoadCurveChart points={points} target={target} interpolation={interpolation} />
      <div className="load-curve-points" role="group" aria-label="Profile points">
        <div className="load-curve-row load-curve-row-head" aria-hidden="true"><span>Time (seconds)</span><span>{unit}</span><span /></div>
        {points.map((point, index) => <div className="load-curve-point-group" key={index}>
          <div className="load-curve-row">
            {['time', 'value'].map(key => {
              const error = validation.errors[index]?.[key];
              return <input key={key} type="number" required min="0" max={key === 'time' ? 3600 : limit} step={key === 'time' || target === 'rate' ? 'any' : 1} value={point?.[key] ?? ''}
                aria-label={`Point ${index + 1} ${key === 'time' ? 'time in seconds' : unit.toLowerCase()}`} aria-invalid={!!error} aria-describedby={error ? `${id}-${index}-${key}-error` : undefined}
                ref={node => node?.setCustomValidity(error || '')} onChange={event => edit(index, key, event.target.value)} />;
            })}
            <button type="button" className="load-curve-remove" disabled={points.length <= 2 || index === 0} onClick={() => update({ loadCurve: points.filter((_, current) => current !== index) })} aria-label={`Remove point ${index + 1}`} title={index === 0 ? 'The first point starts the profile' : points.length <= 2 ? 'At least two points are required' : `Remove point ${index + 1}`}><span aria-hidden="true">×</span></button>
          </div>
          {['time', 'value'].map(key => validation.errors[index]?.[key] && <p className="load-curve-error" id={`${id}-${index}-${key}-error`} key={key}>{validation.errors[index][key]}</p>)}
        </div>)}
      </div>
      {validation.message && <p className="load-curve-error" id={`${id}-error`} role="alert">{validation.message}</p>}
      <div className="load-curve-add"><button type="button" onClick={addPoint} disabled={points.length >= 32}>+ Add point</button><span>{points.length} / 32 points</span></div>
      <div className="load-curve-notes">
        <p>Zero pauses new requests. {target === 'rate' ? 'The concurrency cap still limits active requests in RPS mode.' : 'A falling limit lets active requests finish. Linear concurrency is rounded down.'}</p>
        <p>The last point ends dispatch. The request-count cap or a shorter duration limit can end the profile early.</p>
        {interpolation === 'step' && <p>In step mode, the last value has no load interval.</p>}
        <p>Enabling a curve clears sweep, ramp-up and duration settings. Keep sweep and ramp-up disabled while using a curve.</p>
      </div>
    </fieldset>}
  </section>;
}
