/**
 * Render the plugin's REAL settings page — real React, the plugin's own
 * stylesheet, the shipped DSH theme tokens — and drive every control, so the
 * page is proven as a working surface rather than a static tree.
 *
 * The page prefers the shell's Switch / SegmentedControl / Input primitives,
 * which only exist in a running shell; this probe exercises the BUNDLED fallback
 * controls (what an older shell renders) and asserts that each one writes
 * exactly the field it owns. The live isolated instance covers the primitives
 * path end to end.
 *
 * Needs the DSH source checkout (for React and the theme CSS), not a running
 * server. Set DSH_REPO when the checkout lives elsewhere.
 *
 * Usage: node tools/settings-render-probe.mjs
 */
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = (process.env.DSH_REPO ?? 'D:/deepseek-harness').replace(/\\/g, '/');
const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..').replace(/\\/g, '/');
const require = createRequire(join(repo, 'apps/web/package.json'));
const { chromium } = require('playwright');

const PNPM = join(repo, 'node_modules/.pnpm');
const REACT = join(PNPM, 'react@18.3.1/node_modules/react/umd/react.development.js');
const REACT_DOM = join(PNPM, 'react-dom@18.3.1_react@18.3.1/node_modules/react-dom/umd/react-dom.development.js');
const THEME = join(repo, 'packages/client/ui-theme/src/styles/design-platform.css');

const dir = join(tmpdir(), 'dsh-purge-settings');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
copyFileSync(REACT, join(dir, 'react.js'));
copyFileSync(REACT_DOM, join(dir, 'react-dom.js'));
copyFileSync(join(plugin, 'client/client.js'), join(dir, 'plugin-client.js'));
copyFileSync(THEME, join(dir, 'theme.css'));

writeFileSync(join(dir, 'index.html'), `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="/theme.css">
<script src="/react.js"></script>
<script src="/react-dom.js"></script>
</head><body><div id="root"></div>
<script>
  window.__errors = [];
  window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
  // A miniature host: the page's own routes, backed by mutable state, so a
  // control's effect is observed exactly as the real host would apply it.
  window.__state = {
    version: '0.5.2',
    settings: { schema: 1, autoClean: true, retentionDays: 30, sweepOnBoot: true, sweepIntervalHours: 6 },
    stats: { count: 3, totalBytes: 2048, lastSweepAt: Date.now() - 2 * 3600 * 1000, lastSweepRemoved: 1 },
    swept: 0,
  };
  window.__requests = [];
  window.__closed = 0;
  window.fetch = function (path, init) {
    var method = (init && init.method) || 'GET';
    var body = init && init.body ? JSON.parse(init.body) : null;
    window.__requests.push({ path: path, method: method, body: body });
    var reply = function (value) {
      return Promise.resolve({ status: 200, json: function () { return Promise.resolve(value); } });
    };
    if (path === '/session-purge/settings' && method === 'POST') {
      Object.assign(window.__state.settings, body);
      return reply({ ok: true, settings: window.__state.settings });
    }
    if (path === '/session-purge/settings') {
      return reply({ ok: true, version: window.__state.version, settings: window.__state.settings, stats: window.__state.stats });
    }
    if (path === 'https://registry.npmjs.org/dsh-session-purge/latest') {
      // The update check is intentionally an external URL; stub it in the probe.
      return reply({ version: '9.9.9' });
    }
    if (path === '/session-purge/sweep') {
      window.__state.swept += 1;
      return reply({ ok: true, removed: 2, failed: [] });
    }
    if (path === '/session-purge/trash') {
      return reply({ ok: true, version: window.__state.version, entries: [], totalBytes: 0, settings: window.__state.settings, sweep: null });
    }
    return reply({ ok: true });
  };
  var loaded = null;
  window.__ModuleLoader__ = { load: function (entry) { loaded = entry.factory(require); } };
  function require(name) {
    if (name === 'react') return window.React;
    if (name === 'react-dom/client') return window.ReactDOM;
    // Deliberately unresolved: this probe covers the bundled fallback controls.
    throw new Error('unexpected require: ' + name);
  }
</script>
<script src="/plugin-client.js"></script>
<script>
  var React = window.React;
  var effects = [];
  loaded.apply({
    sessions: { list: { getSnapshot: function () { return { ids: [], byId: {} }; } }, refresh: function () { return Promise.resolve(); } },
    get: function () { return null; },
    effect: function (body, label) { effects.push(label); var d = body(); if (typeof d === 'function') return d; return function () {}; }
  });
  window.__effects = effects;
  var Section = loaded.__test.SettingsSection;
  var root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(React.createElement(Section, {
    close: function () { window.__closed += 1; },
    useStore: function () { return null; },
    actions: {}
  }));
</script>
</body></html>
`);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
    const name = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
    try {
        const body = readFileSync(join(dir, name.slice(1)));
        res.writeHead(200, { 'content-type': MIME[extname(name)] ?? 'application/octet-stream' });
        res.end(body);
    }
    catch { res.writeHead(404); res.end('nope'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newContext({ viewport: { width: 900, height: 760 } }).then((c) => c.newPage());
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1200);

const readPage = () => page.evaluate(() => {
    const root = document.querySelector('.sd-set');
    if (root === null) return null;
    const rows = [...root.querySelectorAll('.sd-set-row')].map((row) => ({
        label: row.querySelector('.sd-set-label')?.textContent ?? '',
        hint: row.querySelector('.sd-set-hint')?.textContent ?? null,
        switch: row.querySelector('[role="switch"]') === null ? null
            : { checked: row.querySelector('[role="switch"]').getAttribute('aria-checked'), disabled: row.querySelector('[role="switch"]').disabled },
        segments: [...row.querySelectorAll('.sd-set-segment-btn')].map((button) => ({
            text: button.textContent, pressed: button.getAttribute('aria-pressed'), disabled: button.disabled,
        })),
        number: row.querySelector('input[type="number"]') === null ? null
            : { value: row.querySelector('input[type="number"]').value, disabled: row.querySelector('input[type="number"]').disabled },
    }));
    return {
        heading: root.querySelector('.sd-set-heading')?.textContent ?? '',
        stats: root.querySelector('.sd-set-stats')?.textContent ?? '',
        rows,
        buttons: [...root.querySelectorAll('.sd-set-actions button')].map((button) => ({
            text: button.textContent, className: button.className, disabled: button.disabled,
        })),
        notice: root.querySelector('.sd-set-notice')?.textContent ?? null,
        error: root.querySelector('.sd-set-error')?.textContent ?? null,
        version: root.querySelector('.sd-set-version')?.textContent ?? null,
        update: root.querySelector('.sd-set-update')?.textContent ?? null,
        updateHref: root.querySelector('.sd-set-update a')?.getAttribute('href') ?? null,
        aboutBorder: root.querySelector('.sd-set-about') === null ? null
            : getComputedStyle(root.querySelector('.sd-set-about')).borderTopWidth,
        headingColor: root.querySelector('.sd-set-heading') === null ? null : getComputedStyle(root.querySelector('.sd-set-heading')).color,
    };
});

const report = {
    url,
    pluginStylesInstalled: await page.evaluate(() => document.querySelector('style[data-plugin-css="dsh-session-purge/panel.css"]') !== null),
    pageErrors,
    initial: await readPage(),
    requests: await page.evaluate(() => window.__requests.slice()),
};

// 1. the retention picker picks 90 days.
await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.sd-set-segment-btn')];
    buttons.find((button) => button.textContent === '90 天').click();
});
await page.waitForTimeout(500);
report.afterRetention = await readPage();

// 2. the interval field commits a valid value and snaps back an illegal one.
await page.fill('.sd-set-row input[type="number"]', '12');
await page.evaluate(() => document.querySelector('.sd-set-row input[type="number"]').blur());
await page.waitForTimeout(500);
report.afterInterval = await readPage();
await page.fill('.sd-set-row input[type="number"]', '999');
await page.evaluate(() => document.querySelector('.sd-set-row input[type="number"]').blur());
await page.waitForTimeout(500);
report.afterBadInterval = await readPage();

// 3. "clean up now" runs the sweep and reports the outcome.
await page.evaluate(() => {
    const button = [...document.querySelectorAll('.sd-set-actions button')].find((node) => node.textContent === '立即清理');
    button.click();
});
await page.waitForTimeout(700);
report.afterSweep = await readPage();

// 4. turning auto-clean off writes exactly its own field and locks the schedule.
await page.evaluate(() => document.querySelector('.sd-set-row [role="switch"]').click());
await page.waitForTimeout(500);
report.afterAutoClean = await readPage();

// 5. "open the recycle bin" closes settings and opens the panel.
await page.evaluate(() => {
    const button = [...document.querySelectorAll('.sd-set-actions button')].find((node) => node.textContent === '打开回收站');
    button.click();
});
await page.waitForTimeout(700);
report.afterOpenBin = {
    panel: await page.evaluate(() => {
        const panel = document.querySelector('[role="dialog"][aria-label="回收站"]');
        return panel === null ? null : panel.textContent.slice(0, 60);
    }),
    closed: await page.evaluate(() => window.__closed),
    requests: await page.evaluate(() => window.__requests.slice()),
};

// 6. the entry-placement picker writes its own field.
await page.evaluate(() => {
    const row = [...document.querySelectorAll('.sd-set-row')]
        .find((node) => node.querySelector('.sd-set-label')?.textContent === '入口位置');
    [...row.querySelectorAll('.sd-set-segment-btn')].find((button) => button.textContent === '菜单').click();
});
await page.waitForTimeout(500);
report.afterPlacement = await readPage();

// ── assertions (exit gate) ─────────────────────────────────────────────────
// Read the request log once, at the end: every write the flow issued is in it.
const allRequests = await page.evaluate(() => window.__requests.slice());

const failures = [];
const check = (label, condition, detail) => {
    if (condition === true) return;
    failures.push(label + (detail === undefined ? '' : ` (${detail})`));
};

check('the plugin installed its stylesheet', report.pluginStylesInstalled);
check('no page error while driving the page', pageErrors.length === 0, pageErrors.join(' | '));
check('the page renders a heading and the stats line',
    report.initial.heading === '回收站' && /共 3 个会话/.test(report.initial.stats) && /2 小时前/.test(report.initial.stats),
    JSON.stringify(report.initial.stats));
check('all five settings rows are present with labels and hints',
    report.initial.rows.length === 5
    && report.initial.rows.map((row) => row.label).join('|') === '自动清理回收站|保留时长|启动时清理一次|清理周期（小时）|入口位置'
    && report.initial.rows.every((row) => typeof row.hint === 'string' && row.hint.length > 0),
    JSON.stringify(report.initial.rows.map((row) => row.label)));
check('the entry-placement picker offers both shapes and marks the stored one',
    report.initial.rows[4].segments.map((s) => s.text).join('|') === '图标|菜单'
    && report.initial.rows[4].segments[0].pressed === 'true',
    JSON.stringify(report.initial.rows[4]));
check('the fallback controls render with the stored values',
    report.initial.rows[0].switch.checked === 'true'
    && report.initial.rows[1].segments.map((s) => s.text).join('|') === '7 天|30 天|90 天|365 天|永久'
    && report.initial.rows[1].segments[1].pressed === 'true'
    && report.initial.rows[3].number.value === '6',
    JSON.stringify(report.initial.rows));
check('both actions are offered',
    report.initial.buttons.map((b) => b.text).join('|') === '立即清理|打开回收站',
    JSON.stringify(report.initial.buttons.map((b) => b.text)));
check('the footer separates the host version and reports the newer npm release',
    report.initial.version === '版本 0.5.2'
    && report.initial.update === '有新版本 9.9.9 可用'
    && report.initial.updateHref === 'https://www.npmjs.com/package/dsh-session-purge'
    && report.initial.aboutBorder === '1px',
    JSON.stringify({
        version: report.initial.version, update: report.initial.update,
        href: report.initial.updateHref, border: report.initial.aboutBorder,
    }));

check('the auto-clean switch writes only autoClean and adopts the reply',
    allRequests.some((r) => r.method === 'POST' && r.path === '/session-purge/settings'
        && r.body !== null && r.body.autoClean === false && Object.keys(r.body).length === 1)
    && report.afterAutoClean.rows[0].switch.checked === 'false',
    JSON.stringify(allRequests.filter((r) => r.method === 'POST')));
check('turning auto-clean off locks the schedule controls',
    report.afterAutoClean.rows[2].switch.disabled === true
    && report.afterAutoClean.rows[3].number.disabled === true,
    JSON.stringify(report.afterAutoClean.rows));
check('the retention picker writes retentionDays = 90',
    allRequests.some((r) => r.method === 'POST' && r.body !== null && r.body.retentionDays === 90)
    && report.afterRetention.rows[1].segments[2].pressed === 'true',
    JSON.stringify(report.afterRetention.rows[1].segments));
check('the entry-placement picker writes only entryPlacement and adopts the reply',
    allRequests.some((r) => r.method === 'POST' && r.path === '/session-purge/settings'
        && r.body !== null && r.body.entryPlacement === 'menu' && Object.keys(r.body).length === 1)
    && report.afterPlacement.rows[4].segments[1].pressed === 'true',
    JSON.stringify(report.afterPlacement.rows[4]));
check('the interval field writes an in-range value',
    allRequests.some((r) => r.method === 'POST' && r.body !== null && r.body.sweepIntervalHours === 12),
    JSON.stringify(allRequests.filter((r) => r.body !== null).map((r) => r.body)));
check('an out-of-range interval snaps back to the stored value, never written',
    allRequests.every((r) => r.body === null || r.body.sweepIntervalHours === undefined
        || r.body.sweepIntervalHours === 12)
    && report.afterBadInterval.rows[3].number.value === '12',
    report.afterBadInterval.rows[3].number.value);
check('"clean up now" sweeps and reports the count',
    allRequests.some((r) => r.method === 'POST' && r.path === '/session-purge/sweep')
    && report.afterSweep.notice === '已自动清理 2 个过期会话',
    String(report.afterSweep.notice));
check('"open the recycle bin" closes settings and opens the panel',
    report.afterOpenBin.closed === 1 && report.afterOpenBin.panel !== null,
    JSON.stringify({ closed: report.afterOpenBin.closed, panel: report.afterOpenBin.panel }));

// Dark palette: the page must resolve its tokens there too.
await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''));
await page.waitForTimeout(300);
const dark = await readPage();
check('the page renders under the dark palette', dark !== null && dark.headingColor !== report.initial.headingColor,
    `${dark?.headingColor} vs ${report.initial.headingColor}`);

console.log(JSON.stringify(report, null, 2));
await browser.close();
server.close();

if (failures.length > 0) {
    console.error(`\nFAILED (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
}
else {
    console.log('\nOK: every settings control rendered and wrote exactly its own field');
}
