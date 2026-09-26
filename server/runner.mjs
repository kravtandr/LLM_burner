import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { normalizeConfig, publicConfig } from './config.mjs';
import { summarize } from './metrics.mjs';
import { requestCompletion } from './transport.mjs';
import { demoFetch } from './demo.mjs';
import { seededRandom, intervalMs, waitMs, waitForSlot } from './scheduling.mjs';

export class Runner {
  constructor(store) { this.store = store; this.active = null; }
  start(input) {
    if (this.active) throw new Error('Уже есть активный тест. Дождитесь завершения или остановите его.');
    const config = normalizeConfig(input);
    const levels = config.sweepConcurrency.length ? config.sweepConcurrency : [config.concurrency];
    const run = {
      schemaVersion: 2, id: randomUUID(), name: config.name || config.model, status: 'running',
      startedAt: new Date().toISOString(), finishedAt: null, config: publicConfig(config),
      elapsedMs: 0, wallElapsedMs: 0, activeRequests: 0, peakConcurrency: 0, results: [], series: [],
      phase: config.warmupRequests ? 'warmup' : 'measurement', currentStage: 0,
      plannedRequests: levels.length * config.totalRequests, warmupCompleted: 0, warmupErrors: 0,
      warmupTotal: levels.length * config.warmupRequests,
      stages: levels.map((concurrency, index) => ({ index, concurrency, status: 'pending', completed: 0, elapsedMs: 0, metrics: summarize([], 0, config), startedAt: null, finishedAt: null })),
    };
    run.metrics = summarize([], 0, config); this.store.save(run);
    const state = { run, config, clock: performance.now(), controller: new AbortController(), promise: null, measuredMs: 0, measurementClock: null, rows: [], stageRows: [], nextIndex: 0, lastComputed: -Infinity };
    this.active = state;
    state.promise = this.execute(state).catch(() => {
      state.controller.abort(); run.status = 'interrupted'; run.phase = 'finished'; run.activeRequests = 0; run.finishedAt = new Date().toISOString();
      this.snapshot(state, true); this.persist(run);
    }).finally(() => { state.config.apiKey = ''; if (this.active === state) this.active = null; });
    return this.get(run.id);
  }
  snapshot(state, force = false) {
    const { run, config } = state;
    const now = performance.now();
    run.wallElapsedMs = now - state.clock;
    const stageElapsed = state.measurementClock == null ? 0 : now - state.measurementClock;
    run.elapsedMs = state.measuredMs + stageElapsed;
    const stage = run.stages[run.currentStage];
    if (state.measurementClock != null) stage.elapsedMs = stageElapsed;
    // Full distributions are sorted at most ~6 times/sec; final/checkpoint recovery is exact.
    if (force || now - state.lastComputed >= 150) {
      run.metrics = summarize(state.rows, run.elapsedMs, config);
      if (stage.status === 'running') stage.metrics = summarize(state.stageRows, stage.elapsedMs, config);
      state.lastComputed = now;
    }
    return run;
  }
  persist(run) { const { results, ...summary } = run; this.store.save(summary); }
  async execute(state) {
    const { run, config, controller } = state;
    for (const stage of run.stages) {
      if (controller.signal.aborted) break;
      run.currentStage = stage.index; state.stageRows = [];
      stage.status = 'running'; stage.startedAt = new Date().toISOString();
      if (config.warmupRequests > 0) {
        run.phase = 'warmup'; this.persist(run);
        await this.executePhase(state, stage, 'warmup', config.warmupRequests);
      }
      if (!controller.signal.aborted) {
        run.phase = 'measurement'; state.measurementClock = performance.now();
        this.persist(run);
        await this.executePhase(state, stage, 'measurement', config.totalRequests);
        stage.elapsedMs = performance.now() - state.measurementClock;
        state.measuredMs += stage.elapsedMs; state.measurementClock = null;
      }
      stage.metrics = summarize(state.stageRows, stage.elapsedMs, config);
      stage.status = controller.signal.aborted ? 'cancelled' : stage.metrics.success ? 'completed' : 'failed';
      stage.finishedAt = new Date().toISOString(); this.snapshot(state, true); this.persist(run);
    }
    for (const stage of run.stages) if (stage.status === 'pending') stage.status = 'cancelled';
    this.snapshot(state, true);
    run.status = controller.signal.aborted ? 'cancelled' : run.metrics.success === 0 ? 'failed' : 'completed';
    run.phase = 'finished'; run.finishedAt = new Date().toISOString(); this.persist(run);
  }
  async executePhase(state, stage, phase, limit) {
    const { run, config, controller } = state;
    const signal = controller.signal;
    const started = performance.now();
    const deadline = phase === 'measurement' && config.durationSeconds > 0 ? started + config.durationSeconds * 1000 : Infinity;
    const arrivalRandom = seededRandom(config.randomSeed + stage.index);
    const promptRandom = seededRandom(config.randomSeed + stage.index + 100003);
    const pending = new Set(); let dispatched = 0, scheduledMs = 0, failure = null;
    const capacity = () => {
      const target = Math.min(stage.concurrency, limit);
      return phase === 'measurement' && config.rampUpSeconds > 0 ? Math.min(target, 1 + Math.floor((performance.now() - started) / (config.rampUpSeconds * 1000) * (target - 1))) : target;
    };
    try {
      while (dispatched < limit && !signal.aborted && performance.now() < deadline) {
        if (pending.size >= capacity()) {
          const target = Math.min(stage.concurrency, limit);
          const nextRamp = phase === 'measurement' && config.rampUpSeconds > 0 && capacity() < target
            ? started + capacity() * config.rampUpSeconds * 1000 / (target - 1) - performance.now() : Infinity;
          await waitForSlot(pending, Math.max(1, Math.min(nextRamp, deadline - performance.now())), signal);
          continue;
        }
        const paced = phase === 'measurement' && config.loadMode === 'rate';
        const due = started + scheduledMs;
        if (paced && due >= deadline) { await waitMs(Math.max(0, deadline - performance.now()), signal); break; }
        while (paced && due > performance.now() && !signal.aborted) await waitMs(due - performance.now(), signal);
        if (signal.aborted || performance.now() >= deadline) break;
        const actualStart = performance.now();
        const index = state.nextIndex++, phaseIndex = dispatched++;
        const queueMs = paced ? Math.max(0, actualStart - due) : 0;
        const promptIndex = config.prompts.length ? (config.datasetSelection === 'random' ? Math.floor(promptRandom() * config.prompts.length) : phaseIndex % config.prompts.length) : null;
        let prompt = promptIndex === null ? config.prompt : config.prompts[promptIndex];
        if (config.cacheBust) prompt = `Benchmark request: ${run.id}:${stage.index}:${phase}:${phaseIndex}\n\n${prompt}`;
        const requestConfig = { ...config, prompt };
        run.activeRequests++;
        if (phase === 'measurement') run.peakConcurrency = Math.max(run.peakConcurrency, run.activeRequests);
        const startOffsetMs = actualStart - state.clock;
        const measurementOffsetMs = phase === 'measurement' ? state.measuredMs + actualStart - state.measurementClock : null;
        const task = (async () => {
          try {
            const result = await requestCompletion(requestConfig, signal, config.demo ? demoFetch : fetch);
            const row = { ...result, index, phase, stageIndex: stage.index, promptIndex, queueMs, startOffsetMs, endOffsetMs: performance.now() - state.clock, measurementOffsetMs, stageEndOffsetMs: phase === 'measurement' ? performance.now() - state.measurementClock : null };
            run.results.push(row);
            if (phase === 'warmup') { run.warmupCompleted++; if (row.status !== 'success') run.warmupErrors++; }
            else { state.rows.push(row); state.stageRows.push(row); stage.completed++; }
            this.snapshot(state);
            if (phase === 'measurement' && (run.series.length === 0 || run.elapsedMs - run.series.at(-1).elapsedMs > 200)) {
              run.series.push({ elapsedMs: run.elapsedMs, throughput: run.metrics.throughput, completed: state.rows.length, stageIndex: stage.index });
              if (run.series.length > 500) run.series = run.series.filter((_, i) => i % 2 === 0);
            }
            this.store.checkpoint(run, row);
          } catch (error) { failure = error; controller.abort(); }
          finally { run.activeRequests--; requestConfig.apiKey = ''; }
        })();
        pending.add(task); void task.then(() => pending.delete(task));
        if (paced) scheduledMs += intervalMs(config.requestRate, config.arrivalPattern, arrivalRandom);
      }
    } finally { await Promise.allSettled([...pending]); }
    if (failure) throw failure;
    this.snapshot(state, true);
    if (phase === 'measurement') {
      run.series.push({ elapsedMs: run.elapsedMs, throughput: run.metrics.throughput, completed: state.rows.length, stageIndex: stage.index });
      if (run.series.length > 500) run.series = run.series.filter((_, i) => i % 2 === 0);
    }
  }
  get(id) { return this.active?.run.id === id ? structuredClone(this.snapshot(this.active)) : this.store.get(id); }
  stop(id) {
    if (this.active?.run.id !== id) throw new Error('Этот тест уже завершён.');
    this.active.run.status = 'stopping'; this.active.controller.abort(); return this.get(id);
  }
  async shutdown() { if (this.active) { this.active.controller.abort(); await this.active.promise; } }
}
