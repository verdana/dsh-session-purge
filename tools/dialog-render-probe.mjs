/**
 * Render the plugin's REAL dialog component — real React, the plugin's own
 * stylesheet, the shipped DSH theme tokens — and report the computed colours of
 * both the confirmation (danger) and the success report. Exit-gate for the
 * dialog variants: catches a wrong token, a typo'd class name, or a variant that
 * silently never applies. Complements the static assertions in
 * helpers.test.mjs, which cannot see computed styles.
 *
 * Needs the DSH source checkout (for React and the theme CSS), not a running
 * server. Set DSH_REPO when the checkout lives elsewhere.
 *
 * Usage: node tools/dialog-render-probe.mjs
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

const dir = join(tmpdir(), 'dsh-purge-dialog');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
copyFileSync(REACT, join(dir, 'react.js'));
copyFileSync(REACT_DOM, join(dir, 'react-dom.js'));
copyFileSync(join(plugin, 'client/client.js'), join(dir, 'plugin-client.js'));
// The shipped theme variables, so --dsw-alias-state-* resolve to real colours.
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
  // The client half is a browser module bundle: capture what it registers.
  var loaded = null;
  window.__ModuleLoader__ = { load: function (entry) { loaded = entry.factory(require); } };
  function require(name) {
    if (name === 'react') return window.React;
    if (name === 'react-dom/client') return window.ReactDOM;
    throw new Error('unexpected require: ' + name);
  }
</script>
<script src="/plugin-client.js"></script>
<script>
  var React = window.React;
  var ReactDOM = window.ReactDOM;
  // Drive the plugin's real apply() so its own stylesheet is installed the same
  // way the app installs it (ctx.effect -> insertStyles -> a <style> in head),
  // instead of duplicating the CSS here.
  var effects = [];
  loaded.apply({
    sessions: { list: { getSnapshot: function () { return { ids: [], byId: {} }; } } },
    get: function () { return null; },
    effect: function (body, label) { effects.push(label); var d = body(); if (typeof d === 'function') return d; return function () {}; }
  });
  window.__effects = effects;
  var Dialog = loaded.__test.DeleteConfirmDialog;
  var root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(React.createElement('div', null,
    React.createElement(Dialog, {
      key: 'confirm',
      target: { id: 'session-probe', title: '探测会话', cwd: 'D:\\\\some\\\\project' },
      onClose: function () {}
    }),
    React.createElement(Dialog, {
      key: 'success',
      target: { id: 'session-probe', title: '探测会话' },
      onClose: function () {}
    })
  ));
  // Second render pass: one dialog already finished (the success report).
  window.__finishSecond = function () {
    root.render(React.createElement('div', null,
      React.createElement(Dialog, { key: 'confirm', target: { id: 's1', title: '探测会话' }, onClose: function () {} }),
      React.createElement(Dialog, { key: 'success', target: { id: 's2', title: '另一个会话' }, onClose: function () {} })
    ));
  };
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
const port = server.address().port;
const url = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newContext({ viewport: { width: 900, height: 700 } }).then((c) => c.newPage());
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1200);

const readDialogs = () => page.evaluate(() => [...document.querySelectorAll('.sd-dlg')].map((d) => {
    const icon = d.querySelector('.sd-dlg-title .sd-icon');
    const buttons = [...d.querySelectorAll('.sd-dlg-actions button')];
    return {
        className: d.className,
        ariaLabel: d.getAttribute('aria-label'),
        title: d.querySelector('.sd-dlg-title span:last-child')?.textContent ?? '',
        body: [...d.querySelectorAll('.sd-dlg-text,.sd-dlg-cwd,.sd-dlg-note,.sd-dlg-err')].map((n) => n.textContent),
        iconColor: icon === null ? null : getComputedStyle(icon).color,
        iconPath: icon?.querySelector('path')?.getAttribute('d') ?? null,
        buttons: buttons.map((b) => ({ text: b.textContent, className: b.className, background: getComputedStyle(b).backgroundColor })),
    };
}));
const readTokens = () => page.evaluate(() => {
    const s = getComputedStyle(document.body);
    return {
        success: s.getPropertyValue('--dsw-alias-state-success-primary').trim(),
        error: s.getPropertyValue('--dsw-alias-state-error-primary').trim(),
    };
});

const report = {
    url,
    pluginStylesInstalled: await page.evaluate(() => document.querySelector('style[data-plugin-css="dsh-session-purge/panel.css"]') !== null),
    pluginEffects: await page.evaluate(() => window.__effects),
    pageErrors,
    light: { tokens: await readTokens(), dialogs: await readDialogs() },
};

// The success report only exists once a delete completes, so drive the dialog's
// own confirm handler with a stubbed success reply from the host route.
await page.evaluate(async () => {
    const realFetch = window.fetch;
    window.fetch = async () => ({ json: async () => ({ ok: true, mode: 'deleted', name: '探测会话' }) });
    const buttons = [...document.querySelectorAll('.sd-dlg')][0].querySelectorAll('.sd-dlg-actions button');
    buttons[buttons.length - 1].click();
    await new Promise((r) => setTimeout(r, 600));
    window.fetch = realFetch;
});
await page.waitForTimeout(800);
report.light.afterConfirm = await readDialogs();

// The same assertions under the dark palette: the theme file carries both blocks
// (`body[data-ds-dark-theme]`), and a token that only resolves in one of them
// would ship half-broken.
await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''));
await page.waitForTimeout(400);
report.dark = { tokens: await readTokens(), dialogs: await readDialogs() };

console.log(JSON.stringify(report, null, 2));
await browser.close();
server.close();
