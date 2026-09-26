import { test, expect } from '@playwright/test';

test('typed endpoints and models persist without a run and can be selected from dropdowns',async({page})=>{
 await page.goto('/');
 await page.getByLabel('Endpoint URL',{exact:true}).fill('http://localhost:8088/v1');
 await page.getByLabel('Model',{exact:true}).fill('first-model');
 await page.getByLabel('API key',{exact:true}).fill('fixture-key-must-not-persist');
 await page.reload();
 await expect(page.getByLabel('Endpoint URL',{exact:true})).toHaveValue('http://localhost:8088/v1');
 await expect(page.getByLabel('Model',{exact:true})).toHaveValue('first-model');
 await expect(page.getByLabel('API key',{exact:true})).toHaveValue('');
 await page.getByLabel('Endpoint URL',{exact:true}).fill('http://localhost:9099/v1');
 await page.getByLabel('Model',{exact:true}).fill('second-model');
 await page.getByLabel('Test name').click();
 await page.getByRole('button',{name:'Show saved endpoints',exact:true}).click();
 await page.getByRole('option',{name:'http://localhost:8088/v1',exact:true}).click();
 await expect(page.getByLabel('Endpoint URL',{exact:true})).toHaveValue('http://localhost:8088/v1');
 await page.getByRole('button',{name:'Show saved models',exact:true}).click();
 await page.getByRole('option',{name:'first-model',exact:true}).click();
 await expect(page.getByLabel('Model',{exact:true})).toHaveValue('first-model');
 await page.reload();await expect(page.getByLabel('Model',{exact:true})).toHaveValue('first-model');
 const saved=await page.evaluate(()=>JSON.stringify(localStorage));expect(saved).not.toContain('fixture-key-must-not-persist');
 await page.getByRole('button',{name:'Show saved models',exact:true}).click();await expect(page.getByRole('option',{name:'second-model',exact:true})).toBeVisible();
});

test('history supports keyboard search, restores an unblurred draft and tolerates corrupt storage',async({page})=>{
 await page.goto('/');await page.getByLabel('Endpoint URL',{exact:true}).fill('http://localhost:7777/v1');await page.getByLabel('Model',{exact:true}).fill('qwen27b');await page.reload();
 await expect(page.getByLabel('Model',{exact:true})).toHaveValue('qwen27b');
 await page.getByLabel('Model',{exact:true}).fill('qwen');await page.getByLabel('Model',{exact:true}).press('ArrowDown');await page.getByLabel('Model',{exact:true}).press('Enter');
 await expect(page.getByLabel('Model',{exact:true})).toHaveValue('qwen27b');
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Show saved endpoints',exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.evaluate(()=>localStorage.setItem('burner-connection-history','invalid-json'));await page.reload();await expect(page.getByRole('heading',{name:'Benchmark your model'})).toBeVisible();
});
