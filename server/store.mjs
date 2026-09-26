import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { publicConfig } from './config.mjs';
import { summarize } from './metrics.mjs';

export class Store {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS results (run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, idx INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id, idx));');
    for (const row of this.db.prepare('SELECT id,payload FROM runs').all()) {
      const run = JSON.parse(row.payload);
      if (['running', 'stopping'].includes(run.status)) {
        run.status = 'interrupted'; run.activeRequests = 0; run.finishedAt = new Date().toISOString();
        const results = this.db.prepare('SELECT payload FROM results WHERE run_id=?').all(run.id).map(r => JSON.parse(r.payload));
        if (run.schemaVersion >= 2 && run.stages) {
          run.wallElapsedMs = Math.max(run.wallElapsedMs || 0, ...results.map(r => r.endOffsetMs || 0));
          for (const stage of run.stages) {
            const rows = results.filter(r => r.stageIndex === stage.index && r.phase !== 'warmup');
            stage.elapsedMs = Math.max(stage.elapsedMs || 0, ...rows.map(r => r.stageEndOffsetMs || 0));
            stage.completed = rows.length;
            stage.metrics = summarize(rows, stage.elapsedMs, run.config);
            if (stage.status === 'running') stage.status = 'interrupted';
            else if (stage.status === 'pending') stage.status = 'cancelled';
          }
          run.elapsedMs = run.stages.reduce((n, stage) => n + stage.elapsedMs, 0);
          run.warmupCompleted = results.filter(r => r.phase === 'warmup').length;
          run.warmupErrors = results.filter(r => r.phase === 'warmup' && r.status !== 'success').length;
          run.phase = 'finished';
        } else run.elapsedMs = Math.max(run.elapsedMs || 0, ...results.map(r => r.endOffsetMs || 0));
        run.metrics = summarize(results.filter(r => r.phase !== 'warmup'), run.elapsedMs, run.config);
        this.save(run);
      }
    }
  }
  save(run) {
    const { results, ...record } = run;
    record.config = publicConfig(run.config);
    this.db.prepare('INSERT INTO runs(id, started_at, payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(run.id, run.startedAt, JSON.stringify(record));
    if (results) for (const result of results) this.addResult(run.id, result);
  }
  checkpoint(run, result) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.addResult(run.id, result);
      const { results, ...summary } = run; this.save(summary);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  addResult(id, result) { this.db.prepare('INSERT OR REPLACE INTO results(run_id,idx,payload) VALUES(?,?,?)').run(id, result.index, JSON.stringify(result)); }
  get(id) {
    const row = this.db.prepare('SELECT payload FROM runs WHERE id=?').get(id);
    if (!row) return null;
    return { ...JSON.parse(row.payload), results: this.db.prepare('SELECT payload FROM results WHERE run_id=? ORDER BY idx').all(id).map(r => JSON.parse(r.payload)) };
  }
  list(offset = 0) {
    return this.db.prepare('SELECT payload FROM runs ORDER BY started_at DESC LIMIT 50 OFFSET ?').all(offset).map(r => {
      const run = JSON.parse(r.payload);
      const { prompt, system, prompts, ...config } = run.config;
      return { ...run, config, series: undefined };
    });
  }
  delete(id) { return this.db.prepare('DELETE FROM runs WHERE id=?').run(id).changes > 0; }
  close() { this.db.close(); }
}
