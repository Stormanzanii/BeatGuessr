import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('research', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const calls = [];
page.on('request', request => {
  if (new URL(request.url()).pathname.startsWith('/api/')) calls.push({ method: request.method(), url: request.url(), body: request.postData() });
});
try {
  await page.goto('https://songspot.net/');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'research/songspot-desktop.png', fullPage: true });
  console.log('Public API requests:', JSON.stringify(calls));
  const facts = await page.evaluate(() => ({ title: document.title,
    storageKeys: Object.keys(localStorage),
    buttons: [...document.querySelectorAll('button')].map(el => ({ text: el.textContent.trim().slice(0, 90), label: el.getAttribute('aria-label') })).filter(x => x.text || x.label)
  }));
  console.log('Page controls:', JSON.stringify(facts));
  await writeFile('research/browser-observations.json', JSON.stringify({ calls, facts }, null, 2));
} finally { await browser.close(); }
