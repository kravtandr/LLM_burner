import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';

test('stacked settings collapse on start, expand during a run, and requests retain input/output', async ({ page }) => {
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* consume the request body */ }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"id":"fixture-1","model":"inspector-model","choices":[{"index":0,"delta":{"role":"assistant","content":"Detailed "}}]}\n\n');
    setTimeout(() => res.end('data: {"choices":[{"index":0,"delta":{"content":"answer"},"finish_reason":"stop"}],"usage":{"completion_tokens":2,"prompt_tokens":9}}\n\ndata: [DONE]\n\n'), 1300);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.goto('/');
    await page.getByLabel('Endpoint URL').fill(`http://127.0.0.1:${server.address().port}/v1`);
    await page.getByLabel('Model', { exact: true }).fill('inspector-model');
    await page.getByLabel('System context').fill('Inspect the payload');
    await page.getByLabel('User prompt').fill('A detailed request');
    await page.getByLabel('API key').fill('inspector-test-secret');
    await page.getByLabel('Concurrent requests', { exact: true }).fill('1');
    await page.getByLabel('Total requests', { exact: true }).fill('2');
    const settings = await page.locator('.config-panel').boundingBox();
    const performance = await page.locator('.result-panel').boundingBox();
    const requests = await page.locator('.requests-panel').boundingBox();
    expect(performance.y).toBeGreaterThanOrEqual(settings.y + settings.height);
    expect(requests.y).toBeGreaterThanOrEqual(performance.y + performance.height);
    expect(Math.abs(settings.width - performance.width)).toBeLessThan(2);
    await page.getByRole('button', { name: /Run test/ }).click();
    await expect(page.getByRole('button', { name: 'Expand settings' })).toBeVisible();
    await expect(page.getByLabel('User prompt')).toBeHidden();
    await expect(page.getByRole('progressbar', { name: 'Settings run progress' })).toBeVisible();
    await page.getByRole('button', { name: 'Expand settings' }).click();
    await expect(page.getByLabel('User prompt')).toBeVisible();
    await page.getByRole('button', { name: 'Collapse settings' }).click();
    await expect(page.getByTestId('run-status')).toHaveText('Completed');
    await page.getByRole('button', { name: 'View request 1', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Request #001' })).toBeVisible();
    const input = page.getByTestId('request-input'), output = page.getByTestId('request-output');
    await expect(input).toContainText('A detailed request');
    await expect(input).toContainText('Inspect the payload');
    await expect(output).toContainText('Detailed answer');
    await expect(output).toContainText('completion_tokens');
    await expect(page.getByRole('dialog')).not.toContainText('inspector-test-secret');
    await page.getByRole('button', { name: 'Next request', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Request #002' })).toBeVisible();
    await expect(output).toContainText('Detailed answer');
    await expect(page.getByRole('button', { name: 'Next request', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Previous request', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Request #001' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'View request 1', exact: true })).toBeFocused();
    await page.reload();
    await page.getByRole('button', { name: 'View request 1', exact: true }).click();
    await expect(output).toContainText('Detailed answer');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByRole('button', { name: 'Close request details' }).click();
    await page.route('**/api/runs/*/requests/0', route => route.fulfill({ json: { request: { index: 0, status: 'success' }, details: null } }));
    await page.getByRole('button', { name: 'View request 1', exact: true }).click();
    await expect(page.getByText(/Payloads were not saved for this request/)).toBeVisible();
    expect(errors).toEqual([]);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
