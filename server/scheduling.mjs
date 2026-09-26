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
export function waitForSlot(tasks, ms, signal) {
  if (signal.aborted || ms <= 0) return Promise.resolve();
  return new Promise(resolve => {
    let timer;
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    if (Number.isFinite(ms)) timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    for (const task of tasks) void task.then(finish, finish);
  });
}
