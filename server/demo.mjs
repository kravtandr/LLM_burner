// Synthetic provider for an explicitly selected demo; no external network traffic.
export async function demoFetch(url, options) {
  const body = JSON.parse(options.body);
  const tokens = Math.min(body.max_tokens ?? body.max_completion_tokens, 512);
  const encoder = new TextEncoder();
  const frame = data => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  let timer, emitted = 0, closed = false;
  const stream = new ReadableStream({
    start(controller) {
      const abort = () => { if (!closed) { closed = true; clearTimeout(timer); controller.error(new DOMException('Aborted', 'AbortError')); } };
      if (options.signal.aborted) { abort(); return; }
      options.signal.addEventListener('abort', abort, { once: true });
      const tick = () => {
        if (closed) return;
        emitted += Math.min(16, tokens - emitted);
        controller.enqueue(frame({ choices: [{ index: 0, delta: { content: ' demo' } }], ...(body.stream_options?.continuous_usage_stats ? { usage: { completion_tokens: emitted, prompt_tokens: 42 } } : {}) }));
        if (emitted >= tokens) {
          controller.enqueue(frame({ choices: [{ index: 0, delta: {}, finish_reason: 'length' }] }));
          if (body.stream_options?.include_usage) controller.enqueue(frame({ choices: [], usage: { completion_tokens: tokens, prompt_tokens: 42, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0, accepted_prediction_tokens: 0, rejected_prediction_tokens: 0 } } }));
          controller.enqueue(encoder.encode('data: [DONE]\n\n')); closed = true; controller.close(); options.signal.removeEventListener('abort', abort);
        } else timer = setTimeout(tick, 65 + Math.random() * 30);
      };
      timer = setTimeout(tick, 180 + Math.random() * 140);
    },
    cancel() { closed = true; clearTimeout(timer); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}
