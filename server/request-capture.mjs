const CAPTURE_BYTES = 256 * 1024;
const bytes = text => Buffer.byteLength(text, 'utf8');
const prefix = (text, limit) => new TextDecoder().decode(Buffer.from(text).subarray(0, Math.max(0, limit)), { stream: true });

// Only assembled text is retained: keeping raw SSE fragments could reveal a secret
// split over several events even after redacting each event separately.
export function createRequestCapture(config) {
  const secret = typeof config.apiKey === 'string' ? config.apiKey : '';
  const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedSecret = secret ? new RegExp(secret.split('').map(character => `(?:${escapeRegExp(character)}|\\\\u${character.charCodeAt(0).toString(16).padStart(4, '0')})`).join(''), 'gi') : null;
  let urlSecret = secret;
  try { urlSecret = encodeURIComponent(secret); } catch { /* A malformed Unicode key cannot be URI encoded. */ }
  let truncated = false, responseBytes = 0, responseClipped = false;
  let request = null, rawHttp = '', providerError;
  const message = { role: 'assistant', content: '' };
  const tools = new Map();
  const response = { status: null, contentType: null, format: 'assembled-sse', done: false };
  const body = { choices: [{ index: 0, message, finish_reason: null }] };

  function redactString(text, partial = false) {
    if (!secret) return text;
    let clean = text.replace(escapedSecret, '[redacted]');
    // Also cover credentials echoed as JSON-escaped strings or URL parameters.
    for (const encoded of [JSON.stringify(secret).slice(1, -1), urlSecret]) {
      if (encoded !== secret) clean = clean.split(encoded).join('[redacted]');
    }
    if (partial) {
      // A bounded or failed stream can stop halfway through a secret. Remove the
      // unfinished suffix before anything leaves this module.
      for (let length = Math.min(secret.length - 1, clean.length); length > 0; length--) {
        if (clean.endsWith(secret.slice(0, length))) return `${clean.slice(0, -length)}[redacted fragment]`;
      }
    }
    return clean;
  }

  function redact(value, partial = false, depth = 0) {
    if (typeof value === 'string') return redactString(value, partial);
    if (value == null || typeof value !== 'object') return value;
    if (depth > 32) { truncated = true; return '[Nested content omitted]'; }
    if (Array.isArray(value)) return value.map(item => redact(item, partial, depth + 1));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [redactString(key), redact(item, partial, depth + 1)]));
  }

  function bounded(envelope) {
    if (bytes(JSON.stringify(envelope)) <= CAPTURE_BYTES) return envelope;
    truncated = true;
    const serialized = JSON.stringify(envelope.body);
    let low = 0, high = serialized.length;
    const preview = end => ({ ...envelope, body: { capture_truncated: true, preview: serialized.slice(0, end) } });
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (bytes(JSON.stringify(preview(middle))) <= CAPTURE_BYTES) low = middle;
      else high = middle - 1;
    }
    return preview(low);
  }

  function take(text) {
    if (typeof text !== 'string' || !text.length) return '';
    if (responseClipped) return '';
    const remaining = CAPTURE_BYTES - responseBytes;
    if (bytes(text) <= remaining) { responseBytes += bytes(text); return text; }
    truncated = true; responseClipped = true;
    const kept = prefix(text, remaining);
    responseBytes += bytes(kept);
    return kept;
  }

  function append(object, key, value) {
    if (typeof value === 'string') object[key] = (object[key] || '') + take(value);
  }

  return {
    request(value) {
      request = bounded(redact({ method: 'POST', url: config.endpoint, headers: { 'Content-Type': 'application/json' }, body: value }));
    },
    response(value) {
      response.status = value.status;
      response.contentType = value.headers.get('content-type');
    },
    done() { response.done = true; },
    httpStart() { response.format = 'http-body'; },
    httpText(text) { rawHttp += take(text); },
    markTruncated() { truncated = true; responseClipped = true; },
    get full() { return responseClipped; },
    chunk(chunk) {
      for (const key of ['id', 'model', 'object', 'created', 'system_fingerprint', 'service_tier']) {
        if (body[key] === undefined && typeof chunk[key] === 'string') body[key] = take(chunk[key]);
        else if (body[key] === undefined && Number.isFinite(chunk[key])) body[key] = chunk[key];
      }
      if (chunk.error) {
        // Error metadata has its own small allowance within the shared response budget.
        const serialized = JSON.stringify(redact(chunk.error));
        const kept = take(serialized);
        try { providerError = JSON.parse(kept); } catch { providerError = kept; }
      }
      const choice = Array.isArray(chunk.choices) ? chunk.choices.find(item => item && (item.index === 0 || item.index == null)) : null;
      if (choice) {
        const delta = choice.delta;
        append(message, 'content', delta?.content);
        append(message, 'reasoning_content', delta?.reasoning_content ?? delta?.reasoning);
        append(message, 'refusal', delta?.refusal);
        if (typeof choice.finish_reason === 'string') body.choices[0].finish_reason = take(choice.finish_reason);
        if (delta?.function_call) {
          message.function_call ||= { name: '', arguments: '' };
          append(message.function_call, 'name', delta.function_call.name);
          append(message.function_call, 'arguments', delta.function_call.arguments);
        }
        if (Array.isArray(delta?.tool_calls)) for (const part of delta.tool_calls) {
          if (!part || !Number.isInteger(part.index) || part.index < 0 || part.index >= 128 || responseClipped) { truncated = true; continue; }
          if (!tools.has(part.index)) tools.set(part.index, { id: '', type: 'function', function: { name: '', arguments: '' } });
          const tool = tools.get(part.index);
          append(tool, 'id', part.id);
          append(tool.function, 'name', part.function?.name);
          append(tool.function, 'arguments', part.function?.arguments);
        }
      }
      // Preserve known numeric usage without retaining arbitrary provider metadata.
      if (chunk.usage && typeof chunk.usage === 'object') {
        body.usage ||= {};
        for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) if (Number.isSafeInteger(chunk.usage[key]) && chunk.usage[key] >= 0) body.usage[key] = chunk.usage[key];
        for (const [key, fields] of [['prompt_tokens_details', ['cached_tokens', 'audio_tokens']], ['completion_tokens_details', ['reasoning_tokens', 'audio_tokens', 'accepted_prediction_tokens', 'rejected_prediction_tokens']]]) {
          for (const field of fields) {
            const count = chunk.usage[key]?.[field];
            if (Number.isSafeInteger(count) && count >= 0) { body.usage[key] ||= {}; body.usage[key][field] = count; }
          }
        }
      }
    },
    finish(success) {
      if (tools.size) message.tool_calls = [...tools.entries()].sort(([a], [b]) => a - b).map(([, tool]) => tool);
      if (providerError !== undefined) body.error = providerError;
      let capturedBody = body;
      if (response.format === 'http-body') {
        capturedBody = rawHttp;
        // In incomplete JSON, an escaped secret may itself be cut mid-escape.
        // Conservatively discard the final possible credential span in that case.
        if (secret && responseClipped && /\\u[0-9a-f]{0,4}/i.test(rawHttp.slice(-secret.length * 6))) capturedBody = rawHttp.slice(0, Math.max(0, rawHttp.length - secret.length * 6));
        if (response.done && !responseClipped) { try { capturedBody = JSON.parse(rawHttp); } catch { /* Keep non-JSON provider text. */ } }
      }
      const capturedResponse = bounded(redact({ ...response, body: capturedBody }, responseClipped || !success && !response.done));
      return { request, response: capturedResponse, truncated };
    },
  };
}
