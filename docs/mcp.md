# Control LLM Burner through MCP

[Back to the README](../README.md)

LLM Burner exposes an MCP server so an AI agent can discover models, validate workloads, run benchmarks or timed stress tests, and inspect results. It uses the official [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server) and [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

## Connect

Start LLM Burner normally (`npm start`) or through Docker Compose. No second process or port is required.

| Setup | MCP endpoint |
| --- | --- |
| Default port | `http://127.0.0.1:4310/mcp` |
| Example with `PORT=4311` | `http://127.0.0.1:4311/mcp` |

Select **Streamable HTTP** in your MCP client and enter this URL. Clients that accept an `mcpServers` JSON configuration with a `url` field can use:

```json
{
  "mcpServers": {
    "llm-burner": {
      "url": "http://127.0.0.1:4310/mcp"
    }
  }
}
```

The exact configuration location and transport selector depend on your client. This URL is an MCP endpoint, not a page to open in the browser and not a legacy `/sse` endpoint.

The transport is **stateless**: JSON-RPC calls use HTTP POST, with SSE responses. There are no MCP session IDs, resumable event streams, or standalone GET subscriptions. GET and DELETE return HTTP 405. Clients should poll run status rather than expect push notifications. Both the agent and browser share the same Runner, database, and one-active-test limit.

## Available tools

All tools return a JSON text block plus `structuredContent`. Execution failures return `isError: true`. Input schemas and annotations are exposed through `tools/list`.

| Tool | Arguments | Purpose |
| --- | --- | --- |
| `get_status` | None | Check availability and the active run |
| `list_models` | `endpoint`, optional `apiKey` | Discover model IDs from the endpoint |
| `validate_test_config` | `config` | Validate and normalize a workload without starting it |
| `start_test` | `config` | Start a test; immediately return its run ID |
| `stop_test` | `runId` | Abort that test; leave completed runs unchanged |
| `list_runs` | Optional `offset` | Read history in pages of 50, newest first |
| `get_run` | `runId` | Read settings, status, metrics, stages, and timeline |
| `list_requests` | `runId`, optional `offset`, `limit` | Read request metrics in pages of up to 100 |
| `get_request_details` | `runId`, `index` | Read one captured input/output and its metrics |
| `compare_runs` | `runIds` | Read comparable summaries for 2–4 distinct runs |
| `delete_run` | `runId` | Permanently delete a saved run and its request details |

Offsets and request indices are **zero-based**. Follow `nextOffset` until it is `null`. History omits prompt bodies; `get_run` includes settings but omits individual request rows. Request details may be absent in old runs or truncated by capture limits.

## Agent workflow

1. Call `get_status` before starting. If a test is active, inspect it or wait. Stopping it affects the browser and other agents too.
2. Optionally call `list_models`, then pass a workload to `validate_test_config`.
3. Call `start_test` once and keep `run.id` from the result.
4. Poll `get_run` every 1–2 seconds until its status is terminal (`completed`, `cancelled`, or `interrupted`).
5. Inspect metrics, page through requests, fetch details for failures, or compare saved runs.

`start_test` is **not idempotent**. If a network response is lost, inspect `get_status` and recent `list_runs` before retrying. Disconnecting the MCP client does not stop load. At a duration deadline the scheduler stops new dispatch and drains in-flight requests; `stop_test` aborts them immediately.

### Example benchmark arguments

Pass this object to `validate_test_config` or `start_test`:

```json
{
  "config": {
    "name": "Agent benchmark",
    "endpoint": "http://localhost:1234/v1",
    "model": "qwen27b",
    "prompt": "Explain how a language model generates text.",
    "concurrency": 4,
    "totalRequests": 20,
    "maxTokens": 256,
    "timeoutSeconds": 120
  }
}
```

For a timed stress test, add `"testMode": "stress"`, set `"durationSeconds": 60`, and replace `totalRequests` with `null`. Stress tests cannot combine load curves or concurrency sweeps. All the advanced settings exposed by the UI are available in the configuration schema.

For synthetic local responses, add `"demo": true`; no external model request will be sent. In Docker, a model server on the host usually needs an endpoint such as `http://host.docker.internal:1234/v1`, rather than `localhost`.

### Example JavaScript client

From this repository, where the SDK is installed:

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(
  new URL('http://127.0.0.1:4310/mcp')
));
try {
  const result = await client.callTool({ name: 'get_status', arguments: {} });
  if (result.isError) throw new Error(result.content[0].text);
  console.log(result.structuredContent);
} finally {
  await client.close();
}
```

## Access and data

The MCP endpoint has the same local access boundary as the UI: native runs bind to loopback, and Compose publishes only to host loopback. Host and Origin checks reject foreign websites. There is no separate MCP login or OAuth flow; connected local clients can start load and read or delete history. Remote hosted agents cannot reach this localhost URL directly.

Real tests may incur provider charges. Tool annotations distinguish reads from mutations; your agent client controls approvals. Model prompts, outputs, and provider errors are untrusted data, not instructions for the agent.

API keys are omitted from saved settings and tool results and redacted from captured payloads. However, a key supplied in MCP tool arguments may be recorded by the **client's** conversation or logs. The LLM Burner server cannot control those records. Existing prompt, payload-capture, and export rules still apply.

## Verify

```bash
# Protocol/client integration tests, with temporary SQLite data
node --test tests/mcp.test.mjs

# Container build, MCP-driven workloads, UI/API checks, and persistence
npm run test:docker
```

The Docker smoke test uses an isolated Compose project and a local streaming fixture. It does not send requests to a real model provider or alter the regular history volume.
