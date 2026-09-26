# Workloads and measurement methodology

[Back to the README](../README.md)

This guide explains how LLM Burner schedules requests and calculates results. Use it when comparing runs or interpreting advanced metrics.

## Advanced workloads


- **Warmup:** separate requests before measurement on each stage; stored but excluded from measured metrics and cost.
- **Concurrency or request rate:** constant concurrency, or a target RPS with constant/Poisson arrivals and a bounded number of active requests. Saturation may reduce achieved RPS; `queueMs` records dispatch lag.
- **Ramp-up:** gradually increases the allowed concurrency from one to the target. In rate mode this changes the concurrency cap, not RPS.
- **Duration:** stops sending new requests when the stage time limit is reached. Active requests drain within their individual timeouts. The request count may remain below its configured maximum.
- **Concurrency sweep:** up to eight sequential stages with separate metrics and a throughput chart. Request count and warmup apply to every stage. Stop cancels remaining stages.
- **Prompt dataset:** a JSON array of strings, entered or imported, selected round-robin or randomly. A seed makes prompt choices and arrival schedules reproducible, not network/model timing.
- **Cache variation:** optional unique prefix on the user prompt. This changes the prompt but cannot guarantee a server cache miss.
- **Sampling:** optional temperature, top_p and model seed.
- **SLO:** TTFT, total latency and TPOT limits; request/token goodput, pass/fail/unknown counts and good request fraction.
- **Detailed metrics:** N, mean, min/max, population standard deviation and p50/p90/p95/p99 across 16 distributions; errors, finish reasons, reasoning/cache/prediction usage and data coverage.
- **Cost estimate:** manually entered USD per million input/output tokens, covering successful measured requests only. Warmup, errors and separate cache pricing are excluded; this is not a provider bill.
- Load presets and configuration import/export without API keys.

### Custom load curve

Enable a custom curve in advanced settings. Edit points as **time in seconds → target load**, choose concurrency or RPS, and select linear or stepped interpolation. The chart previews the saved workload; presets provide starting shapes.

```json
{
  "curveTarget": "concurrency",
  "curveInterpolation": "step",
  "loadCurve": [
    { "time": 0, "value": 1 },
    { "time": 10, "value": 8 },
    { "time": 25, "value": 0 },
    { "time": 35, "value": 4 },
    { "time": 60, "value": 0 }
  ]
}
```

A curve has 2–32 points, starts at time zero, uses strictly increasing times and ends within one hour. Zero pauses new dispatch. The last point's **time** ends dispatch; its value is the endpoint of the last linear segment and has no duration in stepped mode. At least one segment must have positive load.

Concurrency values are integers from 0 to 128. Linear interpolation is rounded down to an active-request limit, updated at segment boundaries and integer crossings (subject to JavaScript timer resolution). Falling limits let active requests finish and block new requests until capacity is available. This is a target limit, not a guarantee of achieved overlap.

RPS values range from 0 to 1000. Scheduling integrates the rate curve over time: one unit of area per constant-paced request, or exponentially distributed units for Poisson arrivals. The first request is scheduled after the first unit, not unconditionally at time zero. The ordinary concurrency field remains the RPS cap; saturation creates dispatch lag. Zero-rate intervals pause dispatch even when previous scheduled requests are delayed.

Curves cannot be combined with a sweep or ramp-up. They run once after warmup. The request-count cap still applies and may end a curve early; an optional API `durationSeconds` limit can shorten it too. Requests already in flight drain after the end. The exact curve is saved in history and JSON/config exports; CSV includes the target load at each request's dispatch (`targetLoad`).

## Measurement methodology


All timing uses monotonic client clocks and includes network/client overhead. Measured time is the sum of measurement phases, including errors, scheduled waits and draining in-flight requests. Warmup is excluded; total wall time is shown separately.

| Metric | Definition |
| --- | --- |
| Input/output/total throughput | Corresponding usage tokens from successful requests / measured time |
| End-to-end request TPS | Output tokens / complete request duration, averaged over requests with usage |
| Requests/s | Successful requests / measured time |
| TTFT | HTTP request start to first nonempty content or reasoning delta |
| TTFO | HTTP request start to first nonempty visible content delta |
| TTST | First-to-second generated chunk interval, not an individual token timestamp |
| Decode duration | Last generated chunk time minus first generated chunk time; trailing usage excluded |
| TPOT | Decode duration / (output tokens − 1), requiring at least two chunks and more than one token |
| Decode TPS | 1000 / TPOT in milliseconds |
| Continuous usage correction | Subtract valid first-chunk token count instead of one; otherwise fall back to the estimate |
| ICL | Mean and maximum intervals between generated chunks within each request |
| Input / TTFT | Client-side prefill estimate, including network and queue time |
| Queue delay | Actual dispatch time minus scheduled dispatch time in rate mode |
| Goodput | Successful requests meeting every enabled SLO / measured time |
| Good request fraction | SLO-passing requests / all completed measured requests, including errors and cancellations |

Distributions include successful measured requests only. Percentiles use nearest rank; standard deviation is the population statistic. ICL distributions use each request's mean, not pooled chunk intervals. Input/output length, received bytes and generated chunk count also have distributions. The timeline shows cumulative throughput based on completed requests, not instantaneous token arrivals.

Tokens come only from provider usage. Chunks are never counted as tokens. Missing usage makes the corresponding aggregate throughput and cost unavailable; known token counts are accompanied by coverage. Optional reasoning/cache/prediction totals require complete coverage of the respective field. Prediction usage is not speculative-decoding step telemetry.

A successful request missing an enabled SLO metric is classified as unknown and excluded from goodput. Goodput is unavailable without configured SLOs. Sweep-wide summaries combine stages; inspect stage metrics as well.

`continuous_usage_stats` is an optional server extension, disabled by default. Not every compatible endpoint accepts it. Even when enabled, chunk timing does not provide individual token timestamps. Calculation provenance is saved in `tokenTimingMethod`. Completion usage may include reasoning tokens according to the provider's accounting.

Cache variation prepends `Benchmark request: <run-id>:<stage-index>:<phase>:<request-index>\n\n` to the user prompt. The original configuration, seed and phase are saved; request details show the actual prompt sent, including this prefix. There are no automatic retries.
