# Upstream sources and feature mapping

[Back to the README](../README.md)

The references below were reviewed on September 25, 2026. They informed feature selection, definitions, and formulas. Third-party source code, UI assets, and documentation text were not copied, and these projects are not runtime dependencies. Links point to the reviewed revisions rather than a moving default branch.

| Source | Reviewed revision | Ideas adapted in LLM Burner |
| --- | --- | --- |
| [NVIDIA AIPerf](https://github.com/ai-dynamo/aiperf/tree/62510dc2b2d86a2d7a07be1a4eacdefb03369f89) | `62510dc2b2d86a2d7a07be1a4eacdefb03369f89` · Apache-2.0 | Streaming and usage metrics, warmup, load profiles, SLO goodput, and continuous-usage correction |
| [GuideLLM](https://github.com/vllm-project/guidellm/tree/7f06bd31e919e9a052df554eaac053aff1557697) | `7f06bd31e919e9a052df554eaac053aff1557697` · Apache-2.0 | Latency and throughput comparisons across load profiles and sequential stages |
| [EvalScope](https://github.com/modelscope/evalscope/blob/06b4c67bc37d5482bdcca8b7a3dee335b9e6b5a7/docs/en/user_guides/stress_test/quick_start.md) | `06b4c67bc37d5482bdcca8b7a3dee335b9e6b5a7` · Apache-2.0 | Prompt datasets, concurrency series, detailed results, and distributions |
| [llm-api-bench](https://github.com/idemerge/llm-api-bench/tree/c83e2d796796e06e929b922614ad0cd9c39a3be0) | `c83e2d796796e06e929b922614ad0cd9c39a3be0` · MIT | A standalone web benchmark with history and run comparison |

## AIPerf concepts and local implementation

- [Metrics reference](https://github.com/ai-dynamo/aiperf/blob/62510dc2b2d86a2d7a07be1a4eacdefb03369f89/docs/metrics-reference.md): `server/transport.mjs` captures TTFT, TTFO, TTST, decode duration, and inter-chunk latency. `server/metrics.mjs` aggregates distributions, throughput, usage, and goodput. TPOT and decode TPS are estimates with explicit provenance; chunk intervals are not presented as exact token timestamps.
- [Goodput](https://github.com/ai-dynamo/aiperf/blob/62510dc2b2d86a2d7a07be1a4eacdefb03369f89/docs/tutorials/goodput.md): user-defined TTFT, latency, and TPOT thresholds, with separate pass, fail, and unknown counts.
- [Warmup](https://github.com/ai-dynamo/aiperf/blob/62510dc2b2d86a2d7a07be1a4eacdefb03369f89/docs/tutorials/warmup.md): a separate phase before each stage, excluded from measured time, metrics, and cost estimates.
- [Request rate and concurrency](https://github.com/ai-dynamo/aiperf/blob/62510dc2b2d86a2d7a07be1a4eacdefb03369f89/docs/tutorials/request-rate-concurrency.md) and [arrival patterns](https://github.com/ai-dynamo/aiperf/blob/62510dc2b2d86a2d7a07be1a4eacdefb03369f89/docs/tutorials/arrival-patterns.md): target concurrency or bounded RPS scheduling with constant/Poisson intervals, reproducible schedule seeds, and dispatch-lag measurements.
- [Ramping](https://github.com/ai-dynamo/aiperf/blob/62510dc2b2d86a2d7a07be1a4eacdefb03369f89/docs/tutorials/ramping.md) and [sweeps](https://github.com/ai-dynamo/aiperf/blob/62510dc2b2d86a2d7a07be1a4eacdefb03369f89/docs/tutorials/sweeps.md): a local concurrency ramp and sequential concurrency stages. LLM Burner does not implement every AIPerf load mode or search algorithm.

## Differences and boundaries

- One local Node.js process runs one active test with up to 128 concurrent requests. This is not a distributed load generator.
- Only streaming text Chat Completions are supported. There is no GPU/DCGM/Prometheus telemetry, multimodal load, trace replay, multi-turn agent workload, DNS/TLS/TTFB profiling, or automated SLO saturation search.
- Token counts come from provider usage. There is no tokenizer-based synthetic length control; an output limit does not guarantee a particular response length.
- TPOT uses the interval between the first and last generated chunks, excluding trailing usage events. Continuous usage is opt-in; client overhead is not subtracted.
- Inter-chunk latency percentiles describe per-request mean intervals, not pooled intervals from every chunk. Errors and warmup are excluded from distributions.
- Reasoning, cache, and accepted/rejected prediction usage depend on provider reporting. Prediction-token usage is not speculative-decoding step telemetry.
- Good request fraction includes errors and cancellations in its denominator. Requests missing required SLO metrics are unknown and excluded from goodput. Results from different benchmark tools need aligned definitions before they can be compared.
- A unique prompt prefix varies input but does not disable server-side prefix caching. Cost estimates cover successful measured requests using manually entered USD prices.

The Simple/Advanced interface, local SQLite history, configuration export without API keys, request inspector, timed stress tests, and comparison of 2–4 runs are implemented directly in LLM Burner. See the [measurement guide](measurement-guide.md) for exact local definitions.
