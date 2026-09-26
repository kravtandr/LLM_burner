// Independent deterministic streams keep prompt selection independent of pacing.
export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => { value += 0x6D2B79F5; let n = value; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}
export function intervalMs(rate, pattern, random) { return pattern === 'poisson' ? -Math.log(1 - random()) * 1000 / rate : 1000 / rate; }
export function waitMs(ms, signal) {
  if (signal.aborted || ms <= 0) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms); signal.addEventListener('abort', finish, { once: true });
  });
}
// Each in-flight request gets one completion handler. Timer-driven curve
// updates subscribe temporarily instead of accumulating Promise.then callbacks.
const completionWaiters = new WeakMap();
function subscribeCompletion(task, callback) {
  let state = completionWaiters.get(task);
  if (!state) {
    state = { settled: false, callbacks: new Set() }; completionWaiters.set(task, state);
    const settle = () => { state.settled = true; for (const listener of [...state.callbacks]) listener(); state.callbacks.clear(); };
    void task.then(settle, settle);
  }
  if (state.settled) queueMicrotask(callback);
  else state.callbacks.add(callback);
  return () => state.callbacks.delete(callback);
}
export function waitForSlot(tasks, ms, signal) {
  if (signal.aborted || ms <= 0) return Promise.resolve();
  return new Promise(resolve => {
    let timer, finished = false;
    const unsubscribe = [];
    const finish = () => {
      if (finished) return; finished = true;
      clearTimeout(timer); signal.removeEventListener('abort', finish);
      for (const remove of unsubscribe) remove();
      resolve();
    };
    if (Number.isFinite(ms)) timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    for (const task of tasks) unsubscribe.push(subscribeCompletion(task, finish));
  });
}

// Curve times are seconds relative to the measured phase, never warmup.
export function curveValue(points, time, interpolation = 'linear') {
  if (time <= points[0].time) return points[0].value;
  for (let i = 1; i < points.length; i++) {
    if (time < points[i].time) {
      const a = points[i - 1], b = points[i];
      return interpolation === 'step' ? a.value : a.value + (b.value - a.value) * (time - a.time) / (b.time - a.time);
    }
  }
  return points.at(-1).value;
}

// Invert integrated request rate. Unit mass is constant pacing; exponential
// mass produces an inhomogeneous Poisson process with the same rate curve.
export function nextCurveArrival(points, interpolation, fromSeconds, mass) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const start = Math.max(a.time, fromSeconds);
    if (start >= b.time) continue;
    const slope = interpolation === 'step' ? 0 : (b.value - a.value) / (b.time - a.time);
    const rate = a.value + slope * (start - a.time), width = b.time - start;
    const available = Math.max(0, rate * width + slope * width * width / 2);
    if (available > 0 && mass <= available + 1e-10) {
      const duration = Math.abs(slope) < 1e-12 ? mass / rate : 2 * mass / (rate + Math.sqrt(Math.max(0, rate * rate + 2 * slope * mass)));
      return Math.min(b.time, start + duration);
    }
    mass -= available;
  }
  return Infinity;
}
