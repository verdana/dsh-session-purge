// Stress probe: a stale hot-reloaded copy of the plugin is simulated by loading
// client.js a SECOND time into the same page (its own observer + own clone of
// the menu item), then driving one delete click. Proves the single-dialog
// invariant holds across duplicate plugin instances.
// Usage: node tools/dialog-probe-double.mjs <authed-url>
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = 'D:/deepseek-harness';
const require = createRequire(join(repo, 'apps/web/package.json'));
const { chromium } = require('playwright');

const url = process.argv[2];
if (url === undefined) throw new Error('usage: node dialog-probe-double.mjs <authed-url>');
const source = readFileSync(join(repo, 'dsh-session-purge/client/client.js'), 'utf8');

const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const events = [];
page.on('pageerror', (e) => events.push({ kind: 'pageerror', text: e.message }));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
for (const label of ['继续', '稍后配置', 'Continue', 'Configure later']) {
    const button = page.getByRole('button', { name: label, exact: true });
    if (await button.count() > 0) {
        await button.first().click();
        await page.waitForTimeout(1200);
    }
}
await page.waitForTimeout(3000);

// Duplicate instance: load the module a second time and run its plugin body.
// (A stale HMR copy is exactly this: a second set of DOM observers + clones.)
const secondId = 'dsh-session-purge-stale';
const installed = await page.evaluate(({ code, id }) => {
    const patched = code.replace('id: "dsh-session-purge"', `id: "${id}"`);
    let factory = null;
    const realLoad = window.__ModuleLoader__.load;
    window.__ModuleLoader__.load = (definition) => { factory = definition.factory; };
    try {
        // eslint-disable-next-line no-new-func
        new Function(patched)();
    }
    catch (error) {
        window.__ModuleLoader__.load = realLoad;
        return `load error: ${String(error && error.message ? error.message : error)}`;
    }
    window.__ModuleLoader__.load = realLoad;
    if (factory === null) return 'factory missing';
    try {
        const mod = factory((name) => {
            if (name === 'react') return window.__DSH_BOOT__?.staticModules?.react;
            if (name === 'react-dom/client') return window.__DSH_BOOT__?.staticModules?.['react-dom/client'];
            return {};
        });
        // Minimal ctx: the client half only uses sessions/locale/effect.
        const ctx = {
            sessions: { list: { getSnapshot: () => null } },
            get: () => null,
            effect: (fn) => { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose(); }; },
        };
        mod.apply(ctx);
        return 'applied';
    }
    catch (error) {
        return `apply error: ${String(error && error.message ? error.message : error)}`;
    }
}, { code: source, id: secondId });
await page.waitForTimeout(2500);

const anchors = page.locator('button[aria-label^="会话"][aria-label$="的操作"], button[aria-label^="Session actions for"]');
const report = { url, secondInstance: installed, anchorCount: await anchors.count(), steps: [] };
const readDialogs = () => page.evaluate(() => ({
    count: document.querySelectorAll('.sd-dlg').length,
    hosts: document.querySelectorAll('.sd-dlg-host').length,
    injectedItems: document.querySelectorAll('[data-sd-menu-item]').length,
    texts: [...document.querySelectorAll('.sd-dlg')].map((d) => d.innerText.replace(/\s+/g, ' ').trim()),
}));

if (report.anchorCount > 0) {
    await anchors.first().evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    await page.waitForTimeout(1200);
    report.steps.push({ step: 'menu-open', dialog: await readDialogs() });
    const items = await page.evaluate(() => [...document.querySelectorAll('[data-sd-menu-item] button[role="menuitem"]')].map((b) => b.textContent.trim()));
    report.steps.push({ step: 'menu-items', items });

    // Plant a competing delete item that belongs to a DIFFERENT plugin instance
    // (its own wrapper + own bubble listener). Before the arbitration fix this
    // opened a second dialog on the same click.
    const planted = await page.evaluate(() => {
        const existing = document.querySelector('[data-sd-menu-item]');
        if (existing === null) return 'no item to clone';
        const clone = existing.cloneNode(true);
        clone.dataset.sdCompetitor = '1';
        clone.addEventListener('click', () => {
            window.__competitorFired = (window.__competitorFired ?? 0) + 1;
        });
        existing.parentElement.appendChild(clone);
        return 'planted';
    });
    report.steps.push({ step: 'plant-competitor', planted });

    const del = page.locator('[data-sd-menu-item] button[role="menuitem"]').first();
    if (await del.count() > 0) {
        await del.click();
        await page.waitForTimeout(1200);
        report.steps.push({
            step: 'after-delete-click',
            dialog: await readDialogs(),
            competitorListenerFired: await page.evaluate(() => window.__competitorFired ?? 0),
        });
    }
}
report.events = events;
writeFileSync(join(repo, 'dsh-session-purge/tools/.dialog-probe-double.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await browser.close();
