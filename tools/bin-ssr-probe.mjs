/**
 * Render the real recycle-bin page and dialog fallback to static markup.
 * Catches component/runtime mistakes and pins the page hierarchy: an eyebrow,
 * a 20px title, a count pill, a subtitle, labelled fields, a full id, and one
 * quiet policy chip.
 *
 * Usage: node tools/bin-ssr-probe.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
new Function('window', 'require', source)({
    __ModuleLoader__: { load: (entry) => { loaded = entry.factory(stubRequire); } }
}, stubRequire);

const { binStore, TrashPage, TrashPanelHost } = loaded.__test;
const fullId = '01J8Z9K3M4N5P6Q7R8S9T0V1W2';
const now = Date.now();
const entries = [
    { id: fullId, title: '会话清理策略', cwd: 'D:\\lootboot', deletedAt: new Date(now - 2 * 3600e3).toISOString(), sizeBytes: 1_450_000 },
    { id: '02AAAAAAAAAAAAAAAAAAAA', title: 'Weekly sync', cwd: 'D:\\tmp\\a', deletedAt: new Date(now - 3 * 86400e3).toISOString(), sizeBytes: 0 },
    { id: '03BBBBBBBBBBBBBBBBBBBB', title: '', deletedAt: new Date(now - 40 * 86400e3).toISOString(), sizeBytes: 22_000_000 }
];
const settings = { autoClean: true, retentionDays: 30 };
const prep = (patch) => binStore.set(Object.assign({
    open: true, phase: 'ready', entries, totalBytes: 23_450_000,
    settings, visible: 50, busyId: null, rowErrors: {}, notice: null,
    error: null, confirm: null, sweep: null
}, patch));
const page = () => ReactDOMServer.renderToStaticMarkup(React.createElement(TrashPage));
const host = () => ReactDOMServer.renderToStaticMarkup(React.createElement(TrashPanelHost));
const count = (s, needle) => s.split(needle).length - 1;

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });

prep({});
const p = page();
check('page eyebrow present', p.includes('sd-bin-page-eyebrow') && p.includes('已删除会话'));
check('page title is its own token', /class="sd-bin-page-title"[^>]*>回收站</.test(p));
check('page count pill', p.includes('sd-bin-page-title-row') && p.includes('3 个会话'));
check('page subtitle present', p.includes('sd-bin-page-sub') && p.includes('可在保留期内随时复原'));
check('page size is a labelled value', p.includes('sd-bin-page-size-label') && p.includes('占用'));
check('page footer carries the irreversible hint', p.includes('永久删除不可恢复'));
check('page has one quiet policy chip', count(p, 'sd-bin-policy-chip') === 1 && p.includes('自动清理：保留 30 天'));
check('page row fields are labelled', count(p, 'sd-bin-field-label') >= 6);
check('page id is complete', p.includes(fullId));
check('page does not truncate the id', !p.includes('01J8Z9K3M4N5P6Q7…'));
check('page head carries no icon', !p.includes('<svg'));
check('page has no undefined text', !p.includes('undefined') && !p.includes('[object Object]'));

const h = host();
check('dialog head has mark, title and subtitle', h.includes('sd-bin-head-mark') && h.includes('sd-bin-head-title') && h.includes('sd-bin-head-sub'));
check('dialog head title is 回收站', /class="sd-bin-head-title"[^>]*>回收站</.test(h));
check('dialog subtitle states reversibility', h.includes('可随时复原'));
check('dialog has one policy chip', count(h, 'sd-bin-policy-chip') === 1);
check('dialog footer keeps stats', h.includes('sd-bin-footer') && h.includes('共 3 个会话') && h.includes('占用'));
check('dialog id is short and mono', h.includes('sd-bin-field-mono') && h.includes('01J8Z9K3M4N5P6Q7…'));
check('dialog does not print the full id', !h.includes(fullId));
check('dialog offers restore and purge', h.includes('sd-bin-row-actions') && h.includes('复原') && h.includes('永久删除'));
check('dialog has no undefined text', !h.includes('undefined') && !h.includes('[object Object]'));

prep({ entries: [], totalBytes: 0 });
const empty = page();
check('empty page names the state', empty.includes('sd-bin-empty') && empty.includes('回收站是空的'));
check('empty page explains recovery', empty.includes('删除的会话会先放到这里'));

prep({ phase: 'loading', entries: [], totalBytes: 0 });
const loading = host();
check('loading dialog shows a status', loading.includes('sd-bin-status') && loading.includes('正在读取回收站'));

prep({ phase: 'failed', entries: [], totalBytes: 0 });
const failed = host();
check('failed dialog offers a retry', failed.includes('读取回收站失败') && failed.includes('重试'));

prep({});
const dirty = host();
const expiring = page();
check('dialog with an expiring row shows the amber pill', dirty.includes('sd-bin-row-warn') || expiring.includes('sd-bin-row-warn'));

prep({ confirm: { kind: 'purge', id: fullId, name: '会话清理策略', busy: false, error: null } });
const confirm = host();
check('confirm strip is marked dangerous', confirm.includes('sd-bin-confirm') && confirm.includes('sd-dlg-btn-danger'));

const failures = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ checks, failures }, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
