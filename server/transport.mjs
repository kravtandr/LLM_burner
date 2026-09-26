import { performance } from 'node:perf_hooks';

// Metrics deliberately use provider usage, never the number of SSE chunks.
export async function requestCompletion(config, externalSignal, fetcher = fetch) {
  const started = performance.now();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), config.timeoutSeconds * 1000);
  const signal = externalSignal ? AbortSignal.any([externalSignal, timeout.signal]) : timeout.signal;
  const result = { status: 'error', ttftMs: null, ttfoMs: null, ttstMs: null, decodeDurationMs: null, tpotMs: null, decodeTps: null, iclMs: null, iclMaxMs: null, chunkCount: 0, bytesReceived: 0, finishReason: null, reasoningTokens: null, cachedInputTokens: null, acceptedPredictionTokens: null, rejectedPredictionTokens: null, firstChunkTokens: null, decodeTokenCount: null, tokenTimingMethod: 'unavailable', durationMs: 0, outputTokens: null, inputTokens: null, httpStatus: null, error: null, errorType: null };
  let reader, response;
  let firstChunk = null, lastChunk = null;
  const fail = (message, type) => { throw Object.assign(new Error(message), { type }); };
  try {
    const body = { model: config.model, messages: [...(config.system ? [{ role: 'system', content: config.system }] : []), { role: 'user', content: config.prompt }], stream: true, [config.tokenParameter]: config.maxTokens };
    if (config.includeUsage) body.stream_options = { include_usage: true };
    if (config.continuousUsage) body.stream_options = { include_usage: true, continuous_usage_stats: true };
    if (config.temperature != null) body.temperature = config.temperature;
    if (config.topP != null) body.top_p = config.topP;
    if (config.seed != null) body.seed = config.seed;
    response = await fetcher(config.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) }, body: JSON.stringify(body), signal, redirect: 'error' });
    result.httpStatus = response.status;
    // Do not persist provider error bodies: some gateways echo headers or prompts.
    if (!response.ok) fail(`HTTP ${response.status}: ${statusHint(response.status)}`, `http_${response.status}`);
    if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) fail('Эндпоинт не вернул SSE-поток (text/event-stream).', 'invalid_content_type');
    if (!response.body) fail('Пустой ответ сервера.', 'empty_response');
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', done = false, finished = false, seenChoice = false, bytes = 0;
    function parse(frame) {
      const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!data) return;
      if (data.trim() === '[DONE]') { done = true; return; }
      let chunk;
      try { chunk = JSON.parse(data); } catch { fail('Некорректный JSON в SSE-потоке.', 'parse_error'); }
      if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) fail('Некорректное SSE-событие.', 'parse_error');
      if (chunk.error) fail('Провайдер вернул ошибку внутри SSE-потока.', 'provider_error');
      if (chunk.choices != null && !Array.isArray(chunk.choices)) fail('Некорректные choices в SSE-потоке.', 'parse_error');
      const choice = chunk.choices?.find(c => c && typeof c === 'object' && (c.index === 0 || c.index == null));
      if (choice) {
        seenChoice = true;
        const delta = choice.delta;
        const visible = typeof delta?.content === 'string' && delta.content.length > 0;
        if ([delta?.content, delta?.reasoning_content, delta?.reasoning].some(v => typeof v === 'string' && v.length > 0)) {
          const now = performance.now();
          if (firstChunk === null) {
            firstChunk = now;
            result.ttftMs = now - started;
            const count = chunk.usage?.completion_tokens;
            if (Number.isSafeInteger(count) && count >= 0) result.firstChunkTokens = count;
          }
          if (visible && result.ttfoMs === null) result.ttfoMs = now - started;
          if (lastChunk !== null) {
            const gap = now - lastChunk;
            if (result.chunkCount === 1) result.ttstMs = gap;
            result.iclMaxMs = Math.max(result.iclMaxMs ?? 0, gap);
          }
          result.chunkCount++;
          lastChunk = now;
        }
        if (typeof choice.finish_reason === 'string' && choice.finish_reason.length) { finished = true; result.finishReason = (config.apiKey ? choice.finish_reason.split(config.apiKey).join('[redacted]') : choice.finish_reason).slice(0, 128); }
      }
      const usage = chunk.usage;
      for (const [key, value] of [
        ['outputTokens', usage?.completion_tokens], ['inputTokens', usage?.prompt_tokens],
        ['reasoningTokens', usage?.completion_tokens_details?.reasoning_tokens], ['cachedInputTokens', usage?.prompt_tokens_details?.cached_tokens],
        ['acceptedPredictionTokens', usage?.completion_tokens_details?.accepted_prediction_tokens], ['rejectedPredictionTokens', usage?.completion_tokens_details?.rejected_prediction_tokens],
      ]) if (Number.isSafeInteger(value) && value >= 0) result[key] = value;
    }
    // Normalise CRLF only after a full frame so a CR/LF split across reads is safe.
    while (!done) {
      const part = await reader.read();
      if (part.done) { buffer += decoder.decode(); break; }
      bytes += part.value.byteLength;
      result.bytesReceived = bytes;
      if (bytes > 32 * 1024 * 1024) fail('Ответ превысил лимит 32 MiB.', 'response_too_large');
      buffer += decoder.decode(part.value, { stream: true });
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        if (match.index > 1024 * 1024) fail('SSE-событие превысило лимит 1 MiB.', 'response_too_large');
        const frame = buffer.slice(0, match.index).replace(/\r\n/g, '\n');
        buffer = buffer.slice(match.index + match[0].length);
        parse(frame);
        if (done) break;
      }
      if (buffer.length > 1024 * 1024) fail('SSE-событие превысило лимит 1 MiB.', 'response_too_large');
    }
    if (buffer.trim() && !done) parse(buffer.replace(/\r\n/g, '\n'));
    if (!seenChoice || (!done && !finished)) fail('Поток оборвался до завершения ответа.', 'incomplete_stream');
    result.status = 'success';
  } catch (error) {
    if (externalSignal?.aborted) { result.status = 'cancelled'; result.error = 'Остановлено пользователем.'; result.errorType = 'cancelled'; }
    else if (timeout.signal.aborted) { result.error = `Таймаут: ${config.timeoutSeconds} с.`; result.errorType = 'timeout'; }
    else {
      result.errorType = error.type || (error instanceof TypeError ? 'network_error' : 'unknown');
      const message = error instanceof TypeError ? 'Не удалось подключиться к эндпоинту. Проверьте URL, сеть и TLS.' : error.message || 'Ошибка запроса.';
      result.error = config.apiKey ? message.split(config.apiKey).join('[redacted]') : message;
    }
  } finally {
    clearTimeout(timer);
    if (reader) await reader.cancel().catch(() => {});
    else if (response?.body) await response.body.cancel().catch(() => {});
    result.durationMs = performance.now() - started;
    if (firstChunk !== null) result.decodeDurationMs = lastChunk - firstChunk;
    if (result.chunkCount >= 2) {
      result.iclMs = result.decodeDurationMs / (result.chunkCount - 1);
      // Correct a batched first chunk only with opt-in cumulative provider usage.
      // Fallback remains an estimate; neither path provides individual token timestamps.
      if (result.outputTokens > 1) {
        const corrected = config.continuousUsage && result.firstChunkTokens > 0 && result.firstChunkTokens < result.outputTokens;
        result.tokenTimingMethod = corrected ? 'usage-corrected' : 'estimated';
        result.decodeTokenCount = result.outputTokens - (corrected ? result.firstChunkTokens : 1);
        result.tpotMs = result.decodeDurationMs / result.decodeTokenCount;
        const tps = result.tpotMs > 0 ? 1000 / result.tpotMs : null;
        result.decodeTps = Number.isFinite(tps) ? tps : null;
      }
    }
  }
  return result;
}

function statusHint(status) {
  return ({ 400: 'проверьте модель и параметры запроса.', 401: 'проверьте API-ключ.', 403: 'доступ запрещён.', 404: 'проверьте путь эндпоинта и модель.', 429: 'превышен лимит запросов.' })[status] || 'ошибка ответа провайдера.';
}
