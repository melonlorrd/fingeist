// Screenshots every tab and the two dialogs of the app served by the server-mode build (see README), read-only.
// Usage: node shoot.mjs [light|dark] [width] [height]
import {mkdirSync} from 'node:fs';
import {webkit} from 'playwright';

const [scheme = 'dark', width = '1200', height = '800'] = process.argv.slice(2);
const url = process.env.EL_COSTAS_URL ?? 'http://localhost:8080';
const outDir = process.env.EL_COSTAS_SHOTS ?? 'out';
mkdirSync(outDir, {recursive: true});

const browser = await webkit.launch();
const page = await (await browser.newContext({
  viewport: {width: Number(width), height: Number(height)},
  colorScheme: scheme,
})).newPage();

const problems = [];
page.on('pageerror', (error) => problems.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });

const file = (name) => `${outDir}/${scheme}-${width}x${height}-${name}.png`;
const openTab = async (tab) => {
  await page.click(`.topbar nav button:text-is("${tab}")`);
  await page.waitForTimeout(900);
};

await page.goto(url, {waitUntil: 'networkidle'});
await page.waitForSelector('.topbar nav button', {timeout: 15000});

for (const tab of ['Dashboard', 'Ledger', 'Portfolio', 'Categories', 'Settings']) {
  await openTab(tab);
  await page.screenshot({path: file(tab.toLowerCase()), fullPage: true});
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) problems.push(`${tab}: horizontal overflow of ${overflow}px`);
}

await openTab('Ledger');
await page.click('button:text-is("+ Add transaction")');
await page.waitForTimeout(300);
await page.screenshot({path: file('add-dialog')});
await page.keyboard.press('Escape');

await openTab('Categories');
await page.click('button:text-is("+ New category")');
await page.waitForTimeout(300);
await page.screenshot({path: file('new-category-dialog')});
await page.keyboard.press('Escape');

console.log(problems.length ? `Problems:\n${problems.join('\n')}` : `Saved screenshots to ${outDir}/ with no console errors.`);
await browser.close();
