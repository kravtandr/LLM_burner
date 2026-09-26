import { test, expect } from '@playwright/test';

test('stress tab runs by time without request count and survives refresh, history and reuse', async ({page,request}) => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await page.getByRole('button',{name:'Stress test',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Stress test your model'})).toBeVisible();
  await expect(page.getByLabel('Total requests',{exact:true})).toHaveCount(0);
  await page.getByLabel('Test name').fill('Timed stress fixture');
  await page.getByLabel('Load duration, s').fill('2');
  await page.getByLabel('Concurrent requests',{exact:true}).fill('2');
  await page.getByLabel('Max output tokens').fill('1');
  await page.getByRole('button',{name:'Demo test',exact:true}).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuetext',/s \/ 2 s/);
  await page.reload();await expect(page.getByRole('heading',{name:'Stress test your model'})).toBeVisible();
  await expect(page.getByTestId('run-status')).toHaveText('Completed');
  const id=await page.evaluate(()=>sessionStorage.getItem('burner-selected'));const run=await(await request.get(`/api/runs/${id}`)).json();
  expect(run.config.testMode).toBe('stress');expect(run.config.totalRequests).toBeNull();expect(run.plannedRequests).toBeNull();expect(run.metrics.success).toBeGreaterThan(4);expect(run.elapsedMs).toBeGreaterThanOrEqual(2000);
  await page.getByRole('button',{name:'History',exact:true}).click();await expect(page.getByText(/Stress · 2 s/).first()).toBeVisible();
  await page.getByRole('button',{name:'Timed stress fixture',exact:true}).first().click();await page.getByRole('button',{name:'Reuse settings'}).click();
  await expect(page.getByLabel('Load duration, s')).toHaveValue('2');await expect(page.getByLabel('Total requests',{exact:true})).toHaveCount(0);
  await page.getByRole('switch',{name:'Advanced mode'}).click();await expect(page.getByLabel('Concurrency sweep')).toHaveCount(0);await expect(page.getByRole('checkbox',{name:'Enable load curve'})).toHaveCount(0);
  await page.getByRole('button',{name:'Benchmark',exact:true}).click();await expect(page.getByLabel('Total requests',{exact:true})).toBeVisible();await expect(page.getByLabel('Load duration, s')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('stress duration validation, manual stop and mobile navigation work',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'Stress test',exact:true}).click();
  await page.getByLabel('Load duration, s').fill('0');let started=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/runs'))started++;});
  await page.getByRole('button',{name:'Demo test',exact:true}).click();expect(started).toBe(0);
  await page.getByLabel('Load duration, s').fill('60');await page.getByRole('button',{name:'Demo test',exact:true}).click();await page.getByRole('button',{name:'Stop test',exact:true}).click();
  await expect(page.getByTestId('run-status')).toHaveText('Cancelled');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
