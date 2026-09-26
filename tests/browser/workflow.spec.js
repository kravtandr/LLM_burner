import { test, expect } from '@playwright/test';
test('demo run survives refresh, appears in history, restores settings and exports', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Испытайте свою модель' })).toBeVisible();
  await page.getByLabel('Название теста').fill('Проверка интерфейса');
  await page.getByLabel('Всего запросов', { exact: true }).fill('8');
  await page.getByLabel('Параллельные запросы', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Демо-тест', exact: true }).click();
  await expect(page.getByText('Синтетические данные', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('run-status')).toHaveText('Завершён', { timeout: 20000 });
  await expect(page.getByTestId('success-count')).toHaveText('8');
  await expect(page.getByTestId('throughput-value')).not.toHaveText('—');
  await page.getByRole('button', { name: 'История', exact: true }).click();
  await expect(page.getByRole('button', { name: /Проверка интерфейса/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /Проверка интерфейса/ }).first().click();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'JSON', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
  await page.getByRole('button', { name: 'Повторить параметры' }).click();
  await expect(page.getByLabel('Название теста')).toHaveValue('Проверка интерфейса');
  await expect(page.getByLabel('API-ключ')).toHaveValue('');
});

test('mobile layout has no horizontal overflow and can stop a test', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Испытайте свою модель' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Всего запросов', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Демо-тест', exact: true }).click();
  await page.getByRole('button', { name: 'Остановить тест' }).click();
  await expect(page.getByTestId('run-status')).toHaveText('Остановлен');
});

test('real HTTP endpoint receives configured messages and limits; history preserves them', async ({ page }) => {
  const { createServer } = await import('node:http');
  const received = []; let active = 0, peak = 0;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received.push(JSON.parse(Buffer.concat(chunks)));
    active++; peak = Math.max(peak, active);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"index":0,"delta":{"content":"Привет"}}]}\n\n');
    setTimeout(() => { active--; res.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":20,"prompt_tokens":10}}\n\ndata: [DONE]\n\n'); }, 70);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto('/');
    await page.getByLabel('Название теста').fill('Локальный HTTP fixture');
    await page.getByLabel('Endpoint URL').fill(`http://127.0.0.1:${server.address().port}/v1`);
    await page.getByLabel('Модель', { exact: true }).fill('fixture-model');
    await page.getByLabel('API-ключ').fill('not-a-real-key');
    await page.getByLabel('Системный контекст').fill('Тестовый контекст');
    await page.getByLabel('Текст запроса').fill('Тестовый вопрос');
    await page.getByLabel('Параллельные запросы', { exact: true }).fill('2');
    await page.getByLabel('Всего запросов', { exact: true }).fill('4');
    await page.getByLabel('Макс. output токенов').fill('32');
    await page.getByText('Совместимость API', { exact: true }).click();
    await page.getByLabel('Параметр лимита токенов').selectOption('max_completion_tokens');
    await page.getByRole('button', { name: /Запустить тест/ }).click();
    await expect(page.getByTestId('run-status')).toHaveText('Завершён');
    await expect(page.getByTestId('success-count')).toHaveText('4');
    expect(peak).toBe(2); expect(received).toHaveLength(4);
    expect(received[0].max_completion_tokens).toBe(32);
    expect(received[0].messages).toEqual([{ role: 'system', content: 'Тестовый контекст' }, { role: 'user', content: 'Тестовый вопрос' }]);
    await page.getByRole('button', { name: 'История', exact: true }).click();
    await page.getByRole('button', { name: 'Локальный HTTP fixture', exact: true }).first().click();
    await expect(page.getByTestId('success-count')).toHaveText('4');
    await page.getByText('Параметры этого замера', { exact: true }).click();
    await expect(page.locator('.saved-config pre').first()).toHaveText('Тестовый контекст');
    await page.reload();
    await expect(page.getByLabel('API-ключ')).toHaveValue('');
    await expect(page.getByLabel('Параллельные запросы', { exact: true })).toHaveValue('2');
    expect(errors).toEqual([]);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
