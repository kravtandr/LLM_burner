# Расширенный LLM Burner

Запрос: перенести полезные для HTTP endpoint-тестера возможности AIPerf и других открытых benchmark tools; переключаемые простой/расширенный UI. Реализация самостоятельная, исходный код сторонних проектов не копируется. Простой режим сохраняет текущий сценарий. Расширенные настройки активируются только при запуске из расширенного режима; переключение вида уже идущего/сохранённого теста не меняет его параметры.

## Согласованный контракт

Новые config поля с defaults для старой истории:
- loadMode: 'concurrency' | 'rate' (default concurrency)
- requestRate: number 0.1..1000 (default 1); arrivalPattern: 'constant'|'poisson' (constant)
- warmupRequests: integer 0..1000 (0), rampUpSeconds: number 0..600 (0)
- durationSeconds: number 0..3600 (0 means count only). Count always safety upper bound per stage; duration is dispatch deadline, inflight finish normally.
- sweepConcurrency: integer[] max8 each1..128 ([] disables); each stage repeats totalRequests and warmupRequests. Results store stageIndex; progress planned requests sum all stages; metrics global and per-stage.
- prompts: string[] max1000 ([] uses main prompt), datasetSelection: 'round-robin'|'random' (round-robin), randomSeed: integer (42). Dataset uses same system context; no synthetic token-count promises.
- cacheBust: boolean(false): distinct prefix to user prompt, visible exact template in docs; changes cache behavior but does not guarantee cache miss.
- continuousUsage: boolean(false), requires includeUsage. Valid first chunk usage corrects TPOT divisor; firstChunkTokens/decodeTokenCount/tokenTimingMethod persist calculation provenance.
- temperature: number|null (null omit), topP: number|null (null omit), seed: integer|null (null omit).
- sloTtftMs, sloLatencyMs, sloTpotMs: number|null (null disabled).
- inputPricePerMillion, outputPricePerMillion: number|null (null disabled); prices in USD explicitly entered by user, no fetched rates/conversion.

Request result additional fields: ttfoMs (first visible content), ttstMs (interval first->second nonempty content/reasoning chunk, NOT a proven individual token interval), decodeDurationMs (last generated chunk-first), tpotMs=(last-first)/(outputTokens-1) estimate when chunkCount>=2 and outputTokens>1, decodeTps=1000/tpotMs, iclMs=mean intervals, iclMaxMs, chunkCount, bytesReceived, finishReason, reasoningTokens, cachedInputTokens, acceptedPredictionTokens, rejectedPredictionTokens; queueMs supplied by scheduler, phase='warmup'|'measurement', stageIndex.

summarize(results,elapsedMs,config={}) backwards compatible. Ignore warmup. Preserve existing fields. Add inputTokens,inputThroughput,totalThroughput,inputUsageCoverage,reasoningTokens,cachedInputTokens,cacheHitRate,errorRate,cancelRate,successRate,goodputRequestsPerSecond,goodputTokensPerSecond,sloPassed,sloFailed,sloUnknown,sloCoverage,costUsd (only complete input/output usage and provided prices), errorsByType, finishReasons. Ratios 0..1.
metrics.distributions keys: latencyMs, ttftMs, ttfoMs, ttstMs, tpotMs, iclMs, decodeTps, e2eTps, inputTokens, outputTokens, queueMs. Each {count,mean,min,max,stddev,p50,p90,p95,p99}, empty values null except count0. Percentiles nearest rank. ICL distribution is request-mean ICL, not pooled per-chunk intervals. Missing data never zero. Goodput requires all enabled SLO metrics available for qualifying request; unknown separate from failed. Request success only completes after valid SSE termination.

Run fields additional: schemaVersion=2, phase ('warmup','measurement','finished'), plannedRequests, warmupCompleted, warmupTotal, wallElapsedMs (incl warmup), elapsedMs/metrics.elapsedMs measured phase time excluding warmup; stages array {index,concurrency,status,elapsedMs,metrics,completed,startedAt,finishedAt}. Global elapsed is sum of measured phase durations across stages. series includes stageIndex, throughput, elapsedMs, completed. liveActive snapshot includes activeRequests and currentStage. Global timeline excludes warmup.

Frontend: src/advanced.jsx + advanced.css independent components: AdvancedSettings({config,setConfig,disabled}); AdvancedResults({run}); CompareRuns({runs,onClose}) accepts full loaded runs. Parent integrates toggle in App, settings slot into ConfigForm before footer, extra result panels, history compare picker, JSON config import/export without key. Toggle preference only persisted locally. Clear advanced workload badge even when viewing in simple mode. Large tables contained horizontal scroll, no page overflow.

Load behavior: global bounded pool maintains max concurrency; rate mode enforces constant/Poisson dispatch schedule with cap, measuring scheduling lag as queueMs. No unbounded pending promises; dispatch blocks at cap. Ramp increases allowed slots from1 to target. Warmup phase excluded, failure counts visible. Sweeps sequential and stop cancels all remaining stages. Deterministic seeded Poisson/dataset selection. Prompts and all new config validated. Stop interrupts both requests and waits. SQLite per-row+summary transaction and recovery stage/global measured times consistent. Old runs render with unknown extra metrics.

## Work steps
- Metrics/transport + unit SSE fixtures (independent module).
- Advanced UI components using contract (independent files).
- Config/scheduler/stages/storage/export (parent).
- Integrate toggle, presets/import/export/model discovery, comparison and browser regressions.
- Full checks, screenshots, source/formula docs and local app restart without interrupting user run.

## Boundaries
This release focuses text Chat Completions. No claims of full AIPerf parity: GPU/DCGM/Prometheus metrics, Kubernetes operators, distributed workers, multimodal workloads, raw timestamp trace replay, model tokenizer integration, Bayesian search, multi-turn agent workload generation need separate integrations. No fictitious GPU or token-level numbers. Tooltips document chunk/token estimation differences. No third-party code copied, source provenance recorded separately.

## Реализация

Контракт реализован. Методика и ограничения уточнены в README.md, версии источников — upstream-sources.md. Дополнительно включены prefillTps, iclMaxMs, decodeDurationMs, bytesReceived/chunkCount distributions, timingMethods, prediction usage, warmup errors и good request fraction. CSV использует concurrency фактической ступени.
