/**
 * Render the REAL dialog component to static markup without a browser. This
 * catches component/runtime mistakes and pins the text hierarchy: labels,
 * values and the emphasized retention value must be separate nodes.
 *
 * Usage: node tools/dialog-ssr-probe.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = (process.env.DSH_REPO ?? 'D:/deepseek-harness').replace(/\\/g, '/');
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../client/client.js'), 'utf8');
const require = createRequire(join(repo, 'apps/web/package.json'));
const React = require('react');
const ReactDOMServer = require('react-dom/server');

const stubRequire = (name) => {
    if (name === 'react') return React;
    if (name === 'react-dom/client') return { createRoot: () => { throw new Error('SSR probe has no DOM'); } };
    throw new Error('unexpected require: ' + name);
};
let loaded = null;
const window = { __ModuleLoader__: { load: (entry) => { loaded = entry.factory(stubRequire); } } };
new Function('window', 'require', source)(window, stubRequire);

const Dialog = loaded.__test.TrashConfirmDialog;
const render = (props = {}) => ReactDOMServer.renderToStaticMarkup(React.createElement(Dialog, Object.assign({
    target: { id: 'session-probe', title: '会话清理策略', cwd: 'D:\\lootboot' },
    policy: '自动清理：保留 30 天',
    onClose: () => {},
}, props)));

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });
const visible = render();
check('mark present', visible.includes('sd-dlg-mark'));
check('title present', visible.includes('sd-dlg-title') && visible.includes('移入回收站'));
check('subtitle present', visible.includes('sd-dlg-subtitle') && visible.includes('可在回收站中随时恢复'));
check('panel present', visible.includes('sd-dlg-panel'));
check('session label present', visible.includes('sd-dlg-overline') && visible.includes('会话'));
check('session name is its own value', visible.includes('sd-dlg-subject-name') && visible.includes('会话清理策略'));
check('two quiet labels', (visible.match(/class="sd-dlg-label"/g) ?? []).length === 2);
check('path is a value', visible.includes('sd-dlg-value sd-dlg-path') && visible.includes('D:\\lootboot'));
check('policy label is split out', visible.includes('>自动清理</dt>') && !visible.includes('自动清理：'));
check('retention is a badge', visible.includes('sd-dlg-badge') && visible.includes('保留 30 天'));
check('badge dot is decorative', visible.includes('sd-dlg-badge-dot') && visible.includes('aria-hidden="true"'));
check('footer actions present', visible.includes('sd-dlg-actions'));
check('primary class preserved', visible.includes('class="sd-dlg-btn sd-dlg-btn-primary"'));
check('warning class preserved', visible.includes('sd-dlg-btn-warn') === false); // only terminal states
check('aria-modal present', visible.includes('aria-modal="true"'));

const off = render({ policy: '自动清理：已关闭' });
check('off policy is muted', off.includes('sd-dlg-badge sd-dlg-badge-muted') && off.includes('已关闭'));
check('off policy has no amber dot', !off.includes('sd-dlg-badge-dot'));

const queued = render({ policy: null, target: { id: 'q', title: '排队会话', cwd: 'D:\\tmp', running: true } });
check('running warning present', queued.includes('sd-dlg-note sd-dlg-note-warn'));

const fail = render({ target: { id: 'x', title: 'x', locateFail: true } });
check('locate failure uses alert copy', fail.includes('sd-dlg-text') && fail.includes('无法定位该会话'));
check('locate failure keeps warn action', fail.includes('sd-dlg-btn sd-dlg-btn-warn'));
check('locate failure has no detail panel', !fail.includes('sd-dlg-panel'));
check('locate failure drops the reversible promise', !fail.includes('sd-dlg-subtitle'));

const failed = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ checks, visibleHtml: visible, failures: failed }, null, 2));
process.exitCode = failed.length === 0 ? 0 : 1;
