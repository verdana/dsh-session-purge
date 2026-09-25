// Probe: drives the delete flow in the isolated DSH instance and records every
// dialog the plugin renders, so the "two dialogs" report can be traced to a cause.
// Usage: node tools/dialog-probe.mjs http://127.0.0.1:3081
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = 'D:/deepseek-harness';
const require = createRequire(join(repo, 'apps/web/package.json'));
const { chromium } = require('playwright');

const url = process.argv[2] ?? 'http://127.0.0.1:3081';
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const events = [];
page.on('pageerror', (e) => events.push({ kind: 'pageerror', text: e.message }));
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
        events.push({ kind: `console.${m.type()}`, text: m.text() });
    }
});
page.on('response', (r) => {
    if (r.status() >= 400) events.push({ kind: `http.${String(r.status())}`, text: r.url() });
});

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

/** Snapshot every plugin dialog currently mounted. */
const readDialogs = () => page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('.sd-dlg')];
    return {
        count: dialogs.length,
        backdrops: document.querySelectorAll('.sd-dlg-backdrop').length,
        hosts: document.querySelectorAll('.sd-dlg-host').length,
        menuItems: document.querySelectorAll('[data-sd-menu-item]').length,
        texts: dialogs.map((d) => {
            const title = d.querySelector('.sd-dlg-title')?.textContent ?? '';
            const body = [...d.querySelectorAll('.sd-dlg-text,.sd-dlg-cwd,.sd-dlg-note,.sd-dlg-err')]
                .map((n) => n.textContent);
            const buttons = [...d.querySelectorAll('button')].map((b) => b.textContent);
            const rect = d.getBoundingClientRect();
            return { title, body, buttons, rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } };
        }),
    };
});

const anchors = page.locator('button[aria-label^="会话"][aria-label$="的操作"], button[aria-label^="Session actions for"]');
const anchorCount = await anchors.count();
const report = { url, anchorCount, steps: [] };

if (anchorCount === 0) {
    report.note = 'no session rows found in the sidebar';
    report.dom = await page.evaluate(() => ({
        bodyText: document.body.innerText.slice(0, 1200),
        buttons: [...document.querySelectorAll('button')].slice(0, 40).map((b) => (b.getAttribute('aria-label') ?? b.textContent).slice(0, 60)),
        pluginStyles: document.querySelectorAll('style[data-plugin]').length,
        hasPurgeCss: document.querySelector('style[data-plugin-css="dsh-session-purge/panel.css"]') !== null,
    }));
    await page.screenshot({ path: join(repo, '.playwright-mcp/shots/purge-no-rows.png'), fullPage: true });
} else {
    // The ⋯ affordance stays visibility:hidden in this collapsed sidebar (the
    // app's own capture listener only needs the event), so dispatch it directly.
    const anchorInfo = await anchors.first().evaluate((el) => {
        const row = el.closest('li') ?? el.parentElement;
        const style = getComputedStyle(el);
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return {
            ariaLabel: el.getAttribute('aria-label'),
            buttonVisibility: style.visibility,
            buttonDisplay: style.display,
            rowTag: row?.tagName ?? null,
        };
    });
    report.anchorInfo = anchorInfo;
    await page.waitForTimeout(1200);
    const menu = await page.evaluate(() => {
        const menus = [...document.querySelectorAll('div[role="menu"]')];
        return menus.map((m) => ({
            items: [...m.querySelectorAll('button[role="menuitem"]')].map((b) => b.textContent.trim()),
            injected: m.querySelectorAll('[data-sd-menu-item]').length,
        }));
    });
    report.steps.push({ step: 'menu-open', menu, dialogs: await readDialogs() });

    const deleteItem = page.locator('[data-sd-menu-item] button[role="menuitem"]');
    if (await deleteItem.count() === 0) {
        report.note = 'delete item not injected';
    } else {
        await deleteItem.first().click();
        await page.waitForTimeout(1200);
        report.steps.push({ step: 'after-menu-click', dialogs: await readDialogs() });

        const confirm = page.locator('.sd-dlg button.sd-dlg-btn-danger').last();
        await confirm.click();
        await page.waitForTimeout(2500);
        report.steps.push({ step: 'after-confirm', dialogs: await readDialogs(), menuItems: await page.locator('[data-sd-menu-item]').count() });

        await page.screenshot({ path: join(repo, '.playwright-mcp/shots/purge-after-confirm.png') });
    }
}

report.events = events;
writeFileSync(join(repo, 'dsh-session-purge/tools/.dialog-probe.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await browser.close();
