# LLM Burner

**Find out how fast your LLM endpoint responds—and how it behaves under load.**

LLM Burner is a local web app for benchmarking OpenAI-compatible LLM endpoints. Configure a workload, watch throughput and latency, inspect individual requests, and compare results over time. It runs on your computer and saves test history in SQLite.

- **Benchmark:** run a fixed number of requests, with optional load curves and concurrency sweeps.
- **Stress test:** keep sending requests for a chosen duration, without a request-count limit.
- **Simple or Advanced:** start with the essentials, then reveal scheduling, distributions, SLOs, datasets, and cost estimates.
- **Inspect and compare:** open request/response details, compare 2–4 runs, and export results.

## Quick start

Requires **Node.js 22.13 or newer** and npm.

```bash
git clone https://github.com/kravtandr/LLM_burner.git
cd LLM_burner
npm ci
npm run build
npm start
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310).

To try the interface without a model server, click **Demo test**. Demo runs generate synthetic streaming responses locally, make no external model requests, and are marked in the results.

### Run your first real test

1. Start a model server that exposes streaming OpenAI-compatible Chat Completions.
2. Enter its **Endpoint URL**, for example `http://localhost:1234/v1`. A full `/v1/chat/completions` URL also works.
3. Enter the exact **Model** identifier, or click **Load model list** to discover models. Add an API key if your endpoint requires one.
4. Write a prompt and choose concurrent requests, total requests, maximum output tokens, and a request timeout.
5. Click **Run test**. Inspect **Performance**, then select a request in **Requests** to see its details.

Requests originate from the machine running LLM Burner. The endpoint must be reachable from that machine. LLM Burner does not host or download models.

## Choose a test mode

| | Benchmark | Stress test |
| --- | --- | --- |
| Use it for | Repeatable runs and workload comparisons | Sustained load and stability checks |
| Main stopping condition | Request count per stage | Load duration, from 1 to 3,600 seconds |
| Request-count limit | Required; up to 10,000 per stage | None |
| Concurrency and output-token settings | Yes | Yes |
| Advanced scheduling, datasets, and SLOs | Yes | Yes |
| Custom load curves and concurrency sweeps | Yes | No |

In **Stress test**, the duration clock starts after optional warmup. Once time runs out, new requests stop and active requests finish within their individual timeouts. The interface shows **Finishing active requests**, so the complete run may take longer than the selected duration. Throughput includes that final measurement time.

**Stop test** aborts active requests and cancels the remaining workload. Refreshing or closing the browser does not stop a running test while the local server is running. Only one test can be active at a time.

## Explore the workspace

The dark, English-language interface follows the same flow in both test modes:

**Test settings → Performance → Requests**

Starting a test collapses settings into a progress panel. Expand them whenever you need to inspect the configuration. Benchmark progress follows request count; stress-test progress follows elapsed load time.

### Simple and Advanced

**Simple** exposes the endpoint, model, API key, context, prompt, load settings, output-token limit, and timeout. Advanced workload settings do not silently affect a simple run.

Switch to **Advanced** for:

- **Load scheduling:** target concurrency or requests per second (RPS), constant or Poisson arrivals, warmup, and concurrency ramp-up.
- **Benchmark profiles:** sequential concurrency sweeps and editable load curves with linear or stepped interpolation.
- **Prompt datasets:** enter or import a JSON array of prompts, then select round-robin or seeded random ordering.
- **Generation settings:** optional temperature, `top_p`, model seed, and a unique prompt prefix to vary cache inputs.
- **Service-level objectives (SLOs):** set TTFT, total-latency, or TPOT thresholds and measure goodput.
- **Deeper analysis:** percentile distributions, usage coverage, error categories, finish reasons, and optional USD cost estimates.
- **Reusable configurations:** import or export settings without API keys.

Load curves can pause dispatch at zero, ramp up, or step between targets. Existing requests finish when a target falls. In Benchmark, the request-count cap can end a curve early. See the [workload and measurement guide](docs/measurement-guide.md) for exact scheduling rules and examples.

### Remembered connections

Endpoint URLs and model identifiers are remembered in this browser. Searchable dropdowns include previous entries, saved-run settings, and discovered model names. Last-used values are restored on reload. API keys are not saved in this connection history.

### Request inspection

Select a request number to view its sent JSON, assembled streaming response, HTTP metadata, and timing metrics. Copy or download the details, or move between requests on the current table page.

Streaming responses are assembled into JSON; they are not raw SSE transcripts. Truncated captures and missing details from older runs are explicitly marked.

### History and exports

History keeps run dates, configurations, and results. Search runs, reuse their settings, compare 2–4 runs, or export JSON/CSV. Dates are stored in UTC and displayed in your browser's timezone.

Run exports contain settings and metrics. To export an individual request/response payload, use **Download details** in the request inspector.

## Understand the main metrics

| Metric | What it tells you |
| --- | --- |
| Aggregate throughput | Output tokens from successful requests divided by measured time. Useful for comparing total serving capacity. |
| Per-request TPS | Average output tokens per second over each request's complete duration, including response wait time. |
| TTFT | Time from sending a request to its first nonempty content or reasoning delta. |
| Latency p95 | The duration at or below which 95% of successful measured requests finish. |
| Requests/s | Successful requests divided by measured time. |
| Goodput | Successful requests meeting every enabled SLO divided by measured time. |

Timing is measured by the client and includes network and client overhead. Warmup is excluded. The throughput chart is cumulative, based on completed requests; it is not an instantaneous token-arrival rate.

Token counts come from **provider usage**, never from counting streaming chunks. Missing usage makes the corresponding token throughput and cost unavailable. Missing values appear as a dash, not zero. TPOT and decode TPS are estimates based on chunk timing, not individual token timestamps.

Advanced mode includes TTFO, first-to-second chunk timing, decode duration, inter-chunk latency, queue delay, and p50/p90/p95/p99 distributions. Read the [measurement methodology](docs/measurement-guide.md#measurement-methodology) before comparing numbers with another benchmark.

## Compatibility and limits

LLM Burner supports **streaming text Chat Completions**. The endpoint must implement the relevant OpenAI-compatible API behavior; compatibility varies between servers. API options let you select `max_tokens` or `max_completion_tokens` and request streaming usage. The optional `continuous_usage_stats` extension is disabled by default.

| Setting | Limit |
| --- | --- |
| Concurrent requests | 1–128 |
| Benchmark measured requests | 1–10,000 per stage; at least peak concurrency |
| Stress-test duration | 1–3,600 seconds in the UI; no request-count cap |
| Maximum output tokens | 1–131,072 per request |
| Request timeout | 1–3,600 seconds |
| Warmup | Up to 1,000 requests per stage |
| Concurrency sweep | Up to 8 stages |
| Load curve | 2–32 points, ending within 3,600 seconds |
| Prompt dataset | Up to 1,000 strings; 100,000 characters each and 500,000 total |

Your provider or model may impose lower limits. An output-token limit is a maximum, not a guarantee of response length. There are no automatic retries. High concurrency can also expose limits of the computer generating the load.

Not supported: Responses API, native Anthropic or Ollama protocols, non-streaming requests, multimodal workloads, GPU/DCGM/Prometheus telemetry, distributed load generators, trace replay, or automated saturation search.

## Local data and credentials

The app binds to `127.0.0.1` and is intended for one local user. SQLite data is stored in `data/burner.sqlite` by default.

- **Saved locally:** prompts, endpoint URLs, model names, settings, dates, metrics, and captured request/response payloads. Browser storage also remembers connection history.
- **API keys:** held in memory for requests, omitted from saved configurations, and redacted from captured payloads. Authorization headers are never captured. Imports discard API keys; re-enter them after refresh or reuse.
- **Capture limits:** 256 KiB each for a request and response, and 64 MiB of captured payloads per run. Further requests still retain metrics. Deleting a run deletes its captured payloads too.
- **Recovery:** completed request records survive a restart. Unfinished runs become interrupted; in-flight requests are not resumed.
- **Backup:** stop the server, then copy the data directory. Prompts and responses may contain sensitive information; review exports before sharing them.

To change the port or data directory:

```bash
PORT=4320 DATA_DIR=./my-data npm start
```

## Development

```bash
npm ci
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Development runs the API on port 4310 and Vite on port 5173. Stop any existing `npm start` process first to free the API port.

```bash
# Server tests and production build
npm run check

# Browser tests (install Chromium once)
npx playwright install chromium
npm run test:e2e
```

Tests use local HTTP/SSE fixtures and synthetic demo responses; no external model is required. Browser tests run a separate server on port 4319 and use `test-results/e2e-data`. Build the frontend before running browser tests.

| Path | Responsibility |
| --- | --- |
| `src/` | React UI and styles |
| `server/transport.mjs` | Streaming requests, usage, and timing |
| `server/metrics.mjs` | Metric aggregation and distributions |
| `server/runner.mjs`, `server/scheduling.mjs` | Workload execution and dispatch |
| `server/store.mjs` | SQLite persistence and recovery |
| `server/request-capture.mjs` | Bounded request/response capture and redaction |
| `server/app.mjs` | Local HTTP API |
| `shared/settings.mjs` | Shared defaults and portable settings |
| `tests/` | Server and browser tests |

See [DESIGN.md](DESIGN.md) for the interface design contract.

## References

Workloads and metric definitions draw on **NVIDIA AIPerf**, **GuideLLM**, and **EvalScope**; history and comparison also draw on **llm-api-bench**. LLM Burner is an independent implementation, not a full AIPerf port. These tools are not runtime dependencies.

See [upstream sources and feature mapping](docs/upstream-sources.md) for pinned references and implementation boundaries.
