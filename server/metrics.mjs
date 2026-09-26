const finite = value => Number.isFinite(value) ? value : null;
const nonnegative = value => Number.isFinite(value) && value >= 0;
const tokenCount = value => Number.isSafeInteger(value) && value >= 0;
const sum = values => finite(values.reduce((total, value) => total + value, 0));
const mean = values => values.length ? finite(values.reduce((total, value) => total + value / values.length, 0)) : null;
const ratio = (count, total) => total ? count / total : 0;
const rate = (count, elapsedMs) => count !== null && nonnegative(elapsedMs) && elapsedMs > 0 ? finite(count * 1000 / elapsedMs) : null;

function distribution(values) {
  const sorted = values.filter(nonnegative).sort((a, b) => a - b);
  const count = sorted.length, average = mean(sorted), max = count ? sorted[count - 1] : null;
  const percentile = fraction => count ? sorted[Math.ceil(count * fraction) - 1] : null;
  // Scale first to avoid overflowing squared deviations for large valid samples.
  const stddev = count ? (max === 0 ? 0 : finite(max * Math.sqrt(mean(sorted.map(value => (value / max - average / max) ** 2))))) : null;
  return { count, mean: average, min: count ? sorted[0] : null, max, stddev, p50: percentile(0.5), p90: percentile(0.9), p95: percentile(0.95), p99: percentile(0.99) };
}

function tally(values) {
  // fromEntries creates own data properties even for a provider's '__proto__' label.
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return Object.fromEntries(counts);
}

export function summarize(results, elapsedMs, config = {}) {
  const measured = results.filter(result => result.phase !== 'warmup');
  const successful = measured.filter(result => result.status === 'success');
  const errors = measured.filter(result => result.status === 'error');
  const cancelled = measured.filter(result => result.status === 'cancelled').length;
  const known = successful.filter(result => tokenCount(result.outputTokens));
  const knownInput = successful.filter(result => tokenCount(result.inputTokens));
  const outputTokens = sum(known.map(result => result.outputTokens));
  const inputTokens = sum(knownInput.map(result => result.inputTokens));
  const completeUsage = successful.length > 0 && successful.length === known.length;
  const completeInputUsage = successful.length > 0 && successful.length === knownInput.length;
  const optionalTotal = key => successful.length > 0 && successful.every(result => tokenCount(result[key])) ? sum(successful.map(result => result[key])) : null;
  const cachedInputTokens = optionalTotal('cachedInputTokens');
  const e2eTps = known.filter(result => nonnegative(result.durationMs) && result.durationMs > 0).map(result => rate(result.outputTokens, result.durationMs));
  const prefillTps = knownInput.filter(result => nonnegative(result.ttftMs) && result.ttftMs > 0).map(result => rate(result.inputTokens, result.ttftMs));
  const distributions = Object.fromEntries(['latencyMs', 'ttftMs', 'ttfoMs', 'ttstMs', 'tpotMs', 'iclMs', 'iclMaxMs', 'decodeDurationMs', 'decodeTps', 'e2eTps', 'prefillTps', 'inputTokens', 'outputTokens', 'queueMs', 'bytesReceived', 'chunkCount'].map(key => [key, distribution(
    key === 'e2eTps' ? e2eTps : key === 'prefillTps' ? prefillTps : successful.map(result => result[key === 'latencyMs' ? 'durationMs' : key]).filter(value => key.endsWith('Tokens') ? tokenCount(value) : nonnegative(value)),
  )]));
  const constraints = [['sloTtftMs', 'ttftMs'], ['sloLatencyMs', 'durationMs'], ['sloTpotMs', 'tpotMs']].filter(([limit]) => nonnegative(config[limit]));
  const passing = [];
  let sloFailed = 0, sloUnknown = 0;
  if (constraints.length) for (const result of successful) {
    if (constraints.some(([, key]) => !nonnegative(result[key]))) sloUnknown++;
    else if (constraints.some(([limit, key]) => result[key] > config[limit])) sloFailed++;
    else passing.push(result);
  }
  const priced = completeUsage && completeInputUsage && nonnegative(config.inputPricePerMillion) && nonnegative(config.outputPricePerMillion);
  return {
    completed: measured.length, success: successful.length, errors: errors.length, cancelled,
    outputTokens, usageCount: known.length, usageCoverage: ratio(known.length, successful.length),
    inputTokens, inputUsageCoverage: ratio(knownInput.length, successful.length),
    throughput: completeUsage ? rate(outputTokens, elapsedMs) : null,
    inputThroughput: completeInputUsage ? rate(inputTokens, elapsedMs) : null,
    totalThroughput: completeUsage && completeInputUsage && outputTokens !== null && inputTokens !== null ? rate(finite(outputTokens + inputTokens), elapsedMs) : null,
    requestTps: distributions.e2eTps.mean,
    requestsPerSecond: rate(successful.length, elapsedMs),
    ttftMs: distributions.ttftMs.mean,
    latencyP50Ms: distributions.latencyMs.p50, latencyP95Ms: distributions.latencyMs.p95, elapsedMs: nonnegative(elapsedMs) ? elapsedMs : null,
    reasoningTokens: optionalTotal('reasoningTokens'), cachedInputTokens,
    acceptedPredictionTokens: optionalTotal('acceptedPredictionTokens'), rejectedPredictionTokens: optionalTotal('rejectedPredictionTokens'),
    timingMethods: tally(successful.map(result => ['usage-corrected', 'estimated'].includes(result.tokenTimingMethod) ? result.tokenTimingMethod : 'unavailable')),
    cacheHitRate: completeInputUsage && inputTokens > 0 && cachedInputTokens !== null && successful.every(result => result.cachedInputTokens <= result.inputTokens) ? cachedInputTokens / inputTokens : null,
    errorRate: ratio(errors.length, measured.length), cancelRate: ratio(cancelled, measured.length), successRate: ratio(successful.length, measured.length),
    sloPassed: passing.length, sloFailed, sloUnknown,
    goodRequestFraction: constraints.length ? ratio(passing.length, measured.length) : null,
    sloCoverage: constraints.length ? ratio(successful.length - sloUnknown, successful.length) : null,
    goodputRequestsPerSecond: constraints.length ? rate(passing.length, elapsedMs) : null,
    goodputTokensPerSecond: constraints.length && passing.every(result => tokenCount(result.outputTokens)) ? rate(sum(passing.map(result => result.outputTokens)), elapsedMs) : null,
    costUsd: priced && inputTokens !== null && outputTokens !== null ? finite((inputTokens * config.inputPricePerMillion + outputTokens * config.outputPricePerMillion) / 1e6) : null,
    errorsByType: tally(errors.map(result => typeof result.errorType === 'string' ? result.errorType : Number.isInteger(result.httpStatus) && result.httpStatus >= 400 ? `http_${result.httpStatus}` : 'unknown')),
    finishReasons: tally(successful.map(result => result.finishReason).filter(value => typeof value === 'string' && value.length)),
    distributions,
  };
}
