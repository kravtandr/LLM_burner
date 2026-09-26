# LLM Burner

**Find out how fast your LLM endpoint responds—and how it behaves under load.**

LLM Burner is a local web app for benchmarking OpenAI-compatible LLM endpoints. Configure a workload, watch throughput and latency, inspect individual requests, and compare results over time. It runs on your computer and saves test history in SQLite.

- **Benchmark:** run a fixed number of requests, with optional load curves and concurrency sweeps.
- **Stress test:** keep sending requests for a chosen duration, without a request-count limit.
- **Simple or Advanced:** start with the essentials, then reveal scheduling, distributions, SLOs, datasets, and cost estimates.
- **Inspect and compare:** open request/response details, compare 2–4 runs, and export results.
- **Agent control:** connect an MCP client over Streamable HTTP to run and inspect tests.

[Quick start](#quick-start) · [MCP](#mcp-control-tests-from-an-ai-agent) · [Test modes](#choose-a-test-mode) · [Metrics](#understand-the-main-metrics) · [Troubleshooting](#troubleshooting)

## Quick start

Choose either a native Node.js process or Docker Compose. Both serve the same web UI and MCP endpoint. Docker keeps its history in a separate volume; it does not automatically import a native installation's data.

### Run with Node.js

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

### Run with Docker Compose

Requires Docker Engine with Compose v2 or newer, or Docker Desktop. Node.js is not needed on the host for this option.

```bash
git clone https://github.com/kravtandr/LLM_burner.git
cd LLM_burner
docker compose up -d --build --wait
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310). The image builds the frontend, runs Node.js as a non-root user, and includes a health check. The published port is restricted to the host's loopback interface.

If port 4310 is already in use, choose another port:

```bash
PORT=4311 docker compose up -d --build --wait
```

Then open `http://127.0.0.1:4311`. Keep the same `PORT` value for subsequent Compose commands that create or recreate the container. Both container and host use the chosen port so browser-origin validation continues to work.

**Connecting to a model server:** `localhost` inside the container refers to the container itself. For LM Studio or another server running on the Docker host, use `http://host.docker.internal:1234/v1` (replace the port as needed). Compose adds the host gateway mapping for Linux as well. The model server must listen on an interface reachable from Docker; a server bound only to host loopback may be unreachable, particularly on Linux. For a separate machine, use that machine's reachable IP address or hostname.

**History:** the named `burner-data` volume stores `/app/data/burner.sqlite` and survives container recreation and `docker compose down`. It is separate from a native installation's `./data` directory. `docker compose down --volumes` deletes this Docker history.

```bash
docker compose ps                 # Check health
docker compose logs -f            # Follow logs
docker compose down              # Stop; keep history
docker compose up -d --build --wait  # Rebuild after updating the source
```

To back up Docker history, stop the service, copy its data, then start it again:

```bash
docker compose stop
mkdir -p backups
docker compose cp llm-burner:/app/data ./backups/burner-data
docker compose start
```

## MCP: control tests from an AI agent

An MCP server is available at **`http://127.0.0.1:4310/mcp`** whenever the app is running. Use the app's port if you changed it. Connect with the **Streamable HTTP** transport; no separate server process is needed.

Agents can discover models, validate settings, start and stop benchmarks or timed stress tests, read metrics and request details, compare runs, and manage history. MCP and the web UI share one active test and the same SQLite data. Starting a test returns its ID immediately; poll for results. Closing the client does not stop a test.

For clients that accept an `mcpServers` configuration with a `url` field:

```json
{
  "mcpServers": {
    "llm-burner": {
      "url": "http://127.0.0.1:4310/mcp"
    }
  }
}
```

Use `http://127.0.0.1:4311/mcp` if you started Compose with `PORT=4311`. Select Streamable HTTP in clients with an explicit transport setting.

The server exposes **11 tools**: `get_status`, `list_models`, `validate_test_config`, `start_test`, `stop_test`, `list_runs`, `get_run`, `list_requests`, `get_request_details`, `compare_runs`, and `delete_run`.

It uses stateless HTTP POST calls with SSE responses. Opening `/mcp` in a browser returns HTTP 405; connect through an MCP client instead. Access is local, with no separate MCP login. Local clients can control tests and read history; a remote hosted agent cannot connect directly to this localhost address.

See the [MCP setup and tool reference](docs/mcp.md) for the agent workflow, example workloads, access boundaries, and a JavaScript client example.

## Run your first real test

1. Start a model server that exposes streaming OpenAI-compatible Chat Completions.
2. Enter its **Endpoint URL**: for a native app and model server on the same machine, use an address such as `http://localhost:1234/v1`; for the app in Docker and the model server on the host, use `http://host.docker.internal:1234/v1`. A full `/v1/chat/completions` URL also works.
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

Native runs bind to `127.0.0.1`; Docker listens on all interfaces inside its container and publishes only to host loopback. The app is intended for one local user. SQLite data is stored in `data/burner.sqlite` by default, or the named volume when using Compose.

- **Saved locally:** prompts, endpoint URLs, model names, settings, dates, metrics, and captured request/response payloads. Browser storage also remembers connection history.
- **API keys:** held in memory for requests, omitted from saved configurations, and redacted from captured payloads. Authorization headers are never captured. Imports discard API keys; re-enter them after refresh or reuse.
- **Capture limits:** 256 KiB each for a request and response, and 64 MiB of captured payloads per run. Further requests still retain metrics. Deleting a run deletes its captured payloads too.
- **Recovery:** completed request records survive a restart. Unfinished runs become interrupted; in-flight requests are not resumed.
- **Backup:** stop the server, then copy the data directory. Prompts and responses may contain sensitive information; review exports before sharing them.

For a native run, change the port or data directory with:

```bash
PORT=4320 DATA_DIR=./my-data npm start
```

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Port 4310 is already in use | Stop the existing app, or use `PORT=4311` when starting Node.js or Compose. Point the browser and MCP client at the selected port. |
| Docker cannot reach the model server | Use `host.docker.internal` for a server on the host, and make sure its listening interface and firewall allow connections from Docker. |
| Model discovery fails | Check the base URL and API key. If the endpoint does not implement `/models`, enter the model identifier manually. |
| Token throughput shows a dash | The endpoint may not report streaming usage. Enable usage reporting if supported; LLM Burner does not infer tokens from chunks. |
| MCP returns HTTP 405 | Use a Streamable HTTP MCP client with the `/mcp` URL. Browser GET requests and legacy SSE connections are not supported. |
| MCP reports an active test | The UI and all agents share one test slot. Inspect it with `get_status`, wait, or explicitly stop that run. |
| History appears empty after switching to Docker | Native `./data` and the Docker volume are separate databases. Keep the same launch mode and volume to retain the same history. |

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

To verify the Docker setup end to end (requires host Node.js and a running Docker daemon):

```bash
npm run test:docker
# If the smoke-test port is occupied:
DOCKER_TEST_PORT=14311 npm run test:docker
```

This builds an isolated Compose project on port 14310, checks the UI assets and API, runs MCP-driven streaming benchmark and stress workloads against a local fixture through the host gateway, and verifies history after container recreation. It removes its own containers and test volume afterward; it does not touch your regular history. The fixture listens temporarily on a host interface reachable by Docker.

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
| `server/mcp.mjs` | MCP tools and Streamable HTTP transport |
| `shared/settings.mjs` | Shared defaults and portable settings |
| `tests/` | Server, MCP, and browser tests |
| `Dockerfile`, `compose.yaml` | Container build, health check, and persistent volume |
| `scripts/docker-smoke.mjs` | Isolated Docker and MCP integration check |

See [DESIGN.md](DESIGN.md) for the interface design contract.

## References

Workloads and metric definitions draw on **NVIDIA AIPerf**, **GuideLLM**, and **EvalScope**; history and comparison also draw on **llm-api-bench**. LLM Burner is an independent implementation, not a full AIPerf port. These tools are not runtime dependencies.

See [upstream sources and feature mapping](docs/upstream-sources.md) for pinned references and implementation boundaries.

## License

LLM Burner is licensed under the [MIT License](LICENSE). Third-party dependencies retain their respective licenses.
