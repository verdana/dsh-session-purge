/**
 * Live end-to-end probe for the recycle bin (milestone M2), run against an
 * ISOLATED dsh instance — never the user's own server.
 *
 * It drives the real shell and asserts the things only a real shell can show:
 * that the fourth icon lands beside the workspace-row icons without being
 * clipped, that the panel opens over the app without navigating, and that
 * trashing and restoring a session move the sidebar row back and forth WITHOUT
 * a page reload (the `sessions.refresh()` re-baseline).
 *
 * Setup:
 *   pwsh -NoProfile -File tools/probe-setup.ps1
 *   $env:DSH_HOME = '<repo>\.probe-home'
 *   dsh --profile web --no-open --port 3081 --host 127.0.0.1
 *
 * Usage: node tools/bin-live-probe.mjs "http://127.0.0.1:3081/?token=..."
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = (process.env.DSH_REPO ?? 'D:/deepseek-harness').replace(/\\/g, '/');
const require = createRequire(join(repo, 'apps/web/package.json'));
const { chromium } = require('playwright');

const url = process.argv[2];
if (url === undefined) {
    throw new Error('usage: node tools/bin-live-probe.mjs <url-with-token>');
}

const shots = join(tmpdir(), 'dsh-bin-live');
mkdirSync(shots, { recursive: true });

const failures = [];
const notes = [];
const check = (label, condition, detail) => {
    if (condition === true) {
        console.log(`  PASS  ${label}`);
        return true;
    }
    console.log(`  FAIL  ${label}${detail === undefined ? '' : `  (${detail})`}`);
    failures.push(label);
    return false;
};
const note = (message) => {
    notes.push(message);
    console.log(`  note  ${message}`);
};

const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error.message)));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
// First-run onboarding, when this home has not seen it yet.
for (const label of ['继续', '稍后配置', 'Continue', 'Configure later']) {
    const button = page.getByRole('button', { name: label, exact: true });
    if (await button.count() > 0) {
        await button.first().click().catch(() => {});
        await page.waitForTimeout(900);
    }
}
await page.waitForTimeout(1500);

// The start gate ("log in / add an API key") is not what this probe tests, but it
// covers the whole app with a modal mask, so a click on any sidebar icon times out
// with "mask intercepts pointer events". Escape closes it without touching state;
// a home that already has usable credentials never shows it.
for (const label of ['开始使用', 'Get started']) {
    const gate = page.locator(`[role="dialog"][aria-label="${label}"]`);
    if (await gate.count() > 0) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(600);
    }
}

// ── 1. the sidebar entry ───────────────────────────────────────────────────

const sidebar = await page.evaluate(() => {
    const slot = document.querySelector('[data-sd-trash-slot]');
    if (slot === null) return { present: false };
    const button = slot.querySelector('button');
    const previous = slot.previousElementSibling;
    // Geometry: is the injected button actually painted, or clipped by an
    // ancestor that still caps the header cluster?
    const rect = button.getBoundingClientRect();
    let clippedBy = null;
    let ancestor = slot.parentElement;
    while (ancestor !== null && ancestor !== document.body) {
        const style = getComputedStyle(ancestor);
        if ((style.overflowX === 'hidden' || style.overflowY === 'hidden') &&
            ancestor.getBoundingClientRect().right < rect.right - 1) {
            clippedBy = {
                tag: ancestor.tagName,
                maxWidth: style.maxWidth,
                right: ancestor.getBoundingClientRect().right,
            };
            break;
        }
        ancestor = ancestor.parentElement;
    }
    const cluster = slot.parentElement;
    return {
        present: true,
        ariaLabel: button.getAttribute('aria-label'),
        previousLabel: previous === null ? null : previous.getAttribute('aria-label'),
        iconTag: button.querySelector('svg') === null ? null : 'svg',
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        clusterMaxWidth: cluster === null ? null : getComputedStyle(cluster).maxWidth,
        clippedBy,
        entryCount: document.querySelectorAll('[data-sd-trash-slot]').length,
    };
});
check('the sidebar entry is injected exactly once', sidebar.present && sidebar.entryCount === 1,
    JSON.stringify(sidebar));
check('it is a real icon button with an accessible name',
    sidebar.ariaLabel === '回收站' || sidebar.ariaLabel === 'Recycle bin',
    String(sidebar.ariaLabel));
check('it sits immediately after the add-workspace icon',
    ['添加工作区', 'Add workspace'].includes(sidebar.previousLabel), String(sidebar.previousLabel));
check('it is actually painted, not clipped by the 60px header cap',
    sidebar.clippedBy === null && sidebar.width > 0 && sidebar.height > 0,
    JSON.stringify({ clippedBy: sidebar.clippedBy, width: sidebar.width }));
await page.screenshot({ path: join(shots, '01-sidebar.png'), clip: { x: 0, y: 0, width: 420, height: 420 } });

// ── 2. the panel opens over the app, and closes again ──────────────────────

await page.click('[data-sd-trash-slot] button');
await page.waitForTimeout(900);
const urlBefore = page.url();
const panel = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="回收站"], [role="dialog"][aria-label="Recycle bin"]');
    return dialog === null ? null : {
        text: dialog.textContent,
        modal: document.querySelectorAll('[data-sd-trash-slot]').length,
    };
});
check('clicking the icon opens the panel', panel !== null);
check('the panel shows the empty state on a fresh bin',
    panel !== null && /回收站是空的|recycle bin is empty/i.test(panel.text), panel?.text?.slice(0, 80));
check('opening the panel does not navigate', page.url() === urlBefore);
// The shell caps a modal card at 380px; the bin deliberately doubles it so a
// session title is not a sliver of ellipsis.
const panelWidth = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="回收站"], [role="dialog"][aria-label="Recycle bin"]');
    return dialog === null ? null : Math.round(dialog.getBoundingClientRect().width);
});
check('the panel is widened past the shell modal default (>= 700px)',
    panelWidth !== null && panelWidth >= 700, `${panelWidth}px`);
await page.screenshot({ path: join(shots, '02-panel-empty.png') });

await page.keyboard.press('Escape');
await page.waitForTimeout(600);
const closed = await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="回收站"], [role="dialog"][aria-label="Recycle bin"]') === null);
check('Escape closes the panel', closed);

// ── 3. move a session to the bin from its row menu ─────────────────────────

const rowInfo = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button[aria-label]')];
    const triggers = buttons.filter((button) => {
        const label = button.getAttribute('aria-label') ?? '';
        return /^会话“.+”的操作$/.test(label) || /^Session actions for .+$/.test(label);
    });
    const titleOf = (label) => label.replace(/^会话“/, '').replace(/”的操作$/, '')
        .replace(/^Session actions for /, '');
    const first = triggers[0];
    return {
        count: triggers.length,
        labels: triggers.slice(0, 3).map((button) => button.getAttribute('aria-label')),
        // Rows can share a display title, so the flow counts them instead of
        // asserting on a title.
        firstTitle: first === undefined ? null : titleOf(first.getAttribute('aria-label')),
        firstTitleCount: first === undefined ? 0
            : triggers.filter((button) => titleOf(button.getAttribute('aria-label')) === titleOf(first.getAttribute('aria-label'))).length,
    };
});
check('session rows with an action menu are present', rowInfo.count > 0, JSON.stringify(rowInfo));

let trashedTitle = null;
if (rowInfo.count > 0) {
    // The row's ⋯ affordance stays `visibility:hidden` until hover (the app's own
    // capture listener only needs the event), so the click is dispatched
    // directly — the same route tools/dialog-probe.mjs uses.
    const opened = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button[aria-label]')];
        const triggers = buttons.filter((button) => {
            const label = button.getAttribute('aria-label') ?? '';
            return /^会话“.+”的操作$/.test(label) || /^Session actions for .+$/.test(label);
        });
        const visible = triggers.find((button) => button.getClientRects().length > 0);
        const target = visible ?? triggers[0];
        if (target === undefined) return null;
        const label = target.getAttribute('aria-label');
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return label;
    });
    trashedTitle = String(opened).replace(/^会话“/, '').replace(/”的操作$/, '')
        .replace(/^Session actions for /, '');
    await page.waitForTimeout(900);
    const menuItem = await page.evaluate(() => {
        const items = [...document.querySelectorAll('div[role="menu"] button[role="menuitem"]')];
        const match = items.find((item) => /移入回收站|Move to recycle bin/.test(item.textContent ?? ''));
        if (match === undefined) return null;
        const style = getComputedStyle(document.body);
        return {
            text: match.textContent,
            color: getComputedStyle(match).color,
            inlineColor: match.style.color,
            warnToken: style.getPropertyValue('--dsw-alias-state-warn-primary').trim(),
            errorToken: style.getPropertyValue('--dsw-alias-state-error-primary').trim(),
        };
    });
    check('the row menu offers "move to recycle bin"', menuItem !== null, JSON.stringify(menuItem));
    check('the item is tinted with the warning token, not the destructive one',
        menuItem !== null && menuItem.inlineColor.includes('state-warn-primary')
        && colorDistance(menuItem.color, menuItem.warnToken) < colorDistance(menuItem.color, menuItem.errorToken),
        JSON.stringify(menuItem));

    if (menuItem !== null) {
        await page.evaluate(() => {
            const items = [...document.querySelectorAll('div[role="menu"] button[role="menuitem"]')];
            const match = items.find((item) => /移入回收站|Move to recycle bin/.test(item.textContent ?? ''));
            match?.click();
        });
        await page.waitForTimeout(900);
        const confirm = await page.evaluate(() => {
            const dialog = document.querySelector('.sd-dlg');
            if (dialog === null) return null;
            const confirmButton = dialog.querySelector('.sd-dlg-btn-primary');
            return {
                title: dialog.querySelector('.sd-dlg-title span:last-child')?.textContent ?? '',
                body: dialog.textContent,
                confirmClass: confirmButton === null ? null : confirmButton.className,
                confirmText: confirmButton === null ? null : confirmButton.textContent,
            };
        });
        check('a confirmation dialog explains the move',
            confirm !== null && /移入回收站|Move to recycle bin/.test(confirm.body ?? ''),
            JSON.stringify(confirm)?.slice(0, 120));
        check('its confirming button is the neutral variant',
            confirm !== null && confirm.confirmClass === 'sd-dlg-btn sd-dlg-btn-primary',
            String(confirm?.confirmClass));
        await page.screenshot({ path: join(shots, '03-confirm.png') });

        await page.click('.sd-dlg-btn-primary');
        await page.waitForTimeout(2000);
        const afterTrash = await page.evaluate((title) => {
            const buttons = [...document.querySelectorAll('button[aria-label]')];
            const triggers = buttons.filter((button) => {
                const label = button.getAttribute('aria-label') ?? '';
                return /^会话“.+”的操作$/.test(label) || /^Session actions for .+$/.test(label);
            });
            const titleOf = (label) => label.replace(/^会话“/, '').replace(/”的操作$/, '')
                .replace(/^Session actions for /, '');
            const dialog = document.querySelector('.sd-dlg');
            const toast = document.querySelector('.sd-toast');
            return {
                remaining: triggers.filter((button) => titleOf(button.getAttribute('aria-label')) === title).length,
                dialogOpen: dialog !== null,
                toastRole: toast?.getAttribute('role') ?? null,
                toastText: toast?.querySelector('.sd-toast-text')?.textContent ?? null,
                toastAction: toast?.querySelector('.sd-toast-action')?.textContent ?? null,
            };
        }, trashedTitle);
        check('the trashed session leaves the sidebar without a reload',
            afterTrash.remaining === rowInfo.firstTitleCount - 1,
            `${rowInfo.firstTitleCount} -> ${afterTrash.remaining} rows titled "${trashedTitle}"`);
        check('the confirmation dialog is gone once the move lands',
            afterTrash.dialogOpen === false);
        // Success reports as a toast, not a second modal: role=alert, the move,
        // and the bin one click away on the banner itself.
        check('a toast reports the move, with the bin as its action',
            afterTrash.toastRole === 'alert'
            && /已移入回收站|Moved .* to the recycle bin/.test(afterTrash.toastText ?? '')
            && /打开回收站|Open recycle bin/.test(afterTrash.toastAction ?? ''),
            JSON.stringify(afterTrash));
        await page.screenshot({ path: join(shots, '03-confirm.png') });

        // The banner's own action opens the bin — the same next step the old
        // success dialog offered, minus the mandatory click. (The sidebar
        // icon's open path is section 2's assertion.)
        await page.click('.sd-toast-action');
        await page.waitForTimeout(1200);
        const listed = await page.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"][aria-label="回收站"], [role="dialog"][aria-label="Recycle bin"]');
            if (dialog === null) return null;
            const rows = [...dialog.querySelectorAll('.sd-bin-row')].map((row) => ({
                title: row.querySelector('.sd-bin-row-title')?.textContent ?? '',
                meta: [...row.querySelectorAll('.sd-bin-row-meta span')].map((span) => span.textContent),
                actions: [...row.querySelectorAll('button')].map((button) => button.textContent),
            }));
            const restore = [...dialog.querySelectorAll('button')].find((button) =>
                /^(复原|Restore)$/.test(button.textContent ?? ''));
            const titleNode = dialog.querySelector('.sd-bin-row-title');
            return {
                rows,
                hasRestore: restore !== undefined,
                text: dialog.textContent,
                dialogWidth: Math.round(dialog.getBoundingClientRect().width),
                titleWidth: titleNode === null ? null : Math.round(titleNode.getBoundingClientRect().width),
            };
        });
        check('the bin lists the moved session', listed !== null && listed.rows.length >= 1,
            JSON.stringify(listed?.rows ?? null));
        check('the row shows its title and the restore action',
            listed !== null && listed.hasRestore === true
            && listed.rows.some((row) => row.title === trashedTitle || row.title.length > 0),
            JSON.stringify(listed?.rows ?? null));
        check('a listed title gets real room in the real shell (>= 500px)',
            listed !== null && listed.titleWidth !== null && listed.titleWidth >= 500,
            JSON.stringify({ dialog: listed?.dialogWidth, title: listed?.titleWidth }));
        await page.screenshot({ path: join(shots, '04-bin-listed.png') });

        await page.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"][aria-label="回收站"], [role="dialog"][aria-label="Recycle bin"]');
            const restore = [...dialog.querySelectorAll('button')].find((button) =>
                /^(复原|Restore)$/.test(button.textContent ?? ''));
            restore?.click();
        });
        await page.waitForTimeout(2500);
        const afterRestore = await page.evaluate((title) => {
            const dialog = document.querySelector('[role="dialog"][aria-label="回收站"], [role="dialog"][aria-label="Recycle bin"]');
            const binRows = dialog === null ? []
                : [...dialog.querySelectorAll('.sd-bin-row-title')].map((node) => node.textContent);
            const buttons = [...document.querySelectorAll('button[aria-label]')];
            const triggers = buttons.filter((button) => {
                const label = button.getAttribute('aria-label') ?? '';
                return /^会话“.+”的操作$/.test(label) || /^Session actions for .+$/.test(label);
            });
            const titleOf = (label) => label.replace(/^会话“/, '').replace(/”的操作$/, '')
                .replace(/^Session actions for /, '');
            return {
                binRows,
                rowCount: triggers.filter((button) => titleOf(button.getAttribute('aria-label')) === title).length,
            };
        }, trashedTitle);
        check('restoring removes the entry from the bin',
            !afterRestore.binRows.includes(trashedTitle), JSON.stringify(afterRestore.binRows));
        check('the session row comes back without a reload',
            afterRestore.rowCount === rowInfo.firstTitleCount,
            `${afterRestore.rowCount} rows titled "${trashedTitle}"`);
        await page.screenshot({ path: join(shots, '05-restored.png') });
    }
}

// ── 5. the settings page (M3) ──────────────────────────────────────────────

// The bin panel is still open after the restore above; its policy line is the
// in-app route into the settings page, so using it asserts that route too.
const openedSettings = await page.evaluate(() => {
    const policy = document.querySelector('.sd-bin-policy-btn');
    if (policy === null) return { policy: false };
    policy.click();
    return { policy: true, label: policy.textContent };
});
check('the panel policy line is a working route into settings', openedSettings.policy === true,
    JSON.stringify(openedSettings));
await page.waitForTimeout(1200);

await page.evaluate(() => {
    const target = [...document.querySelectorAll('[role="dialog"] button')]
        .find((button) => button.textContent.trim() === '回收站');
    if (target !== undefined) target.click();
});
await page.waitForTimeout(1200);

const settingsPage = await page.evaluate(() => {
    const root = document.querySelector('.sd-set');
    if (root === null) return null;
    return {
        heading: root.querySelector('.sd-set-heading')?.textContent ?? '',
        stats: root.querySelector('.sd-set-stats')?.textContent ?? '',
        rows: [...root.querySelectorAll('.sd-set-row')].map((row) => ({
            label: row.querySelector('.sd-set-label')?.textContent ?? '',
            switch: row.querySelector('[role="switch"]') === null ? null
                : row.querySelector('[role="switch"]').getAttribute('aria-checked'),
            tabs: [...row.querySelectorAll('[role="tab"]')].map((tab) => ({
                text: tab.textContent, selected: tab.getAttribute('aria-selected'),
            })),
            number: row.querySelector('input[type="number"]') === null
                ? null : row.querySelector('input[type="number"]').value,
        })),
        buttons: [...root.querySelectorAll('.sd-set-actions button')].map((button) => button.textContent),
        primitives: root.querySelector('[role="tablist"]') !== null,
        version: root.querySelector('.sd-set-version')?.textContent ?? null,
        footerBorder: root.querySelector('.sd-set-about') === null ? null
            : getComputedStyle(root.querySelector('.sd-set-about')).borderTopWidth,
        navIcon: (() => {
            const row = [...document.querySelectorAll('[role="dialog"] nav button')]
                .find((button) => button.textContent.trim() === '回收站');
            if (row === undefined) return null;
            const svg = row.querySelector('svg');
            return {
                marker: row.getAttribute('data-sd-settings-nav'),
                svgDisplay: svg === null ? null : getComputedStyle(svg).display,
                glyphWidth: getComputedStyle(row, '::before').width,
            };
        })(),
    };
});
check('the settings page is reachable from the shell nav', settingsPage !== null);
check('it renders the four rows with the shell primitives',
    settingsPage !== null && settingsPage.rows.length === 4 && settingsPage.primitives === true,
    JSON.stringify(settingsPage?.rows?.map((row) => row.label)));
check('it shows the live stats line',
    settingsPage !== null && /共 \d+ 个会话/.test(settingsPage.stats), String(settingsPage?.stats));
check('the nav row carries the bin glyph instead of the shell gear',
    settingsPage !== null && settingsPage.navIcon !== null
    && settingsPage.navIcon.marker === 'trash'
    && settingsPage.navIcon.svgDisplay === 'none'
    && settingsPage.navIcon.glyphWidth === '16px',
    JSON.stringify(settingsPage?.navIcon));
check('the footer shows the running host version behind a rule',
    settingsPage !== null && /^版本 \d+\.\d+\.\d+/.test(settingsPage.version ?? '')
    && settingsPage.footerBorder === '1px',
    JSON.stringify({ version: settingsPage?.version, border: settingsPage?.footerBorder }));
await page.screenshot({ path: join(shots, '06-settings.png') });

const readPersisted = () => page.evaluate(async () => (await fetch('/session-purge/settings')).json());

// Toggle auto-clean off, then read what the host actually stored.
await page.evaluate(() => {
    document.querySelectorAll('.sd-set-row')[0].querySelector('[role="switch"]').click();
});
await page.waitForTimeout(900);
let persisted = await readPersisted();
check('the auto-clean switch persists through the host', persisted.settings.autoClean === false,
    JSON.stringify(persisted.settings));
check('turning it off locks the schedule controls in the real shell too',
    await page.evaluate(() => {
        const rows = document.querySelectorAll('.sd-set-row');
        return rows[2].querySelector('[role="switch"]').disabled === true
            && rows[3].querySelector('input[type="number"]').disabled === true;
    }));

// Retention through the row's menu (trigger, then the 90-day option).
await page.click('.sd-set-row .sd-set-trigger');
await page.waitForTimeout(250);
await page.evaluate(() => {
    const option = [...document.querySelectorAll('.sd-set-option')]
        .find((node) => node.textContent.trim() === '90 天');
    if (option !== undefined) option.click();
});
await page.waitForTimeout(900);
persisted = await readPersisted();
check('the retention picker persists 90 days', persisted.settings.retentionDays === 90,
    JSON.stringify(persisted.settings));

// Turn auto-clean back on so the interval field is editable again.
await page.evaluate(() => {
    document.querySelectorAll('.sd-set-row')[0].querySelector('[role="switch"]').click();
});
await page.waitForTimeout(900);
// Fill focuses the field; Enter is the component's other commit path (blur only
// fires on a focused element, so a programmatic blur would be a no-op).
const intervalInput = page.locator('.sd-set-row input[type="number"]');
await intervalInput.fill('12');
await intervalInput.press('Enter');
await page.waitForTimeout(900);
persisted = await readPersisted();
check('the sweep interval persists a new value', persisted.settings.sweepIntervalHours === 12,
    JSON.stringify(persisted.settings));

// Run the sweep from the page and read the reported outcome.
await page.evaluate(() => {
    const button = [...document.querySelectorAll('.sd-set-actions button')]
        .find((node) => node.textContent === '立即清理' || node.textContent === '处理中…');
    if (button !== undefined) button.click();
});
await page.waitForTimeout(1500);
const sweepNotice = await page.evaluate(() =>
    document.querySelector('.sd-set-notice')?.textContent ?? null);
check('"clean up now" reports its outcome on the page',
    sweepNotice !== null && /清理|保持|关闭/.test(sweepNotice), String(sweepNotice));

// And the page's own way back into the bin.
await page.evaluate(() => {
    const button = [...document.querySelectorAll('.sd-set-actions button')]
        .find((node) => node.textContent === '打开回收站');
    if (button !== undefined) button.click();
});
await page.waitForTimeout(1200);
const binFromSettings = await page.evaluate(() =>
    document.querySelector('[role="dialog"][aria-label="回收站"], [role="dialog"][aria-label="Recycle bin"]') !== null);
check('the settings page offers a way back to the bin', binFromSettings === true);
await page.screenshot({ path: join(shots, '07-bin-from-settings.png') });

// ── 6. permanent delete and emptying the bin (AC-10) ───────────────────────

/** Move one session to the bin through its row menu; returns its title. */
async function moveFirstSessionToBin() {
    const label = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button[aria-label]')];
        const triggers = buttons.filter((button) => {
            const text = button.getAttribute('aria-label') ?? '';
            return /^会话“.+”的操作$/.test(text) || /^Session actions for .+$/.test(text);
        });
        const target = triggers.find((button) => button.getClientRects().length > 0) ?? triggers[0];
        if (target === undefined) return null;
        const value = target.getAttribute('aria-label');
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return value;
    });
    await page.waitForTimeout(900);
    await page.evaluate(() => {
        const items = [...document.querySelectorAll('div[role="menu"] button[role="menuitem"]')];
        items.find((item) => /移入回收站|Move to recycle bin/.test(item.textContent ?? ''))?.click();
    });
    await page.waitForTimeout(900);
    await page.click('.sd-dlg-btn-primary');
    await page.waitForTimeout(2000);
    // The success report stays open on purpose; dismiss it for the next step.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    return String(label).replace(/^会话“/, '').replace(/”的操作$/, '')
        .replace(/^Session actions for /, '');
}

/** The panel dialog element's accessible name is localised; both are accepted. */
const BIN_DIALOG = '[role="dialog"][aria-label="回收站"], [role="dialog"][aria-label="Recycle bin"]';

async function ensureBinOpen() {
    const open = await page.evaluate((selector) => document.querySelector(selector) !== null, BIN_DIALOG);
    if (open) return;
    await page.click('[data-sd-trash-slot] button');
    await page.waitForTimeout(1200);
}

/** What the host actually holds, read through the page's own origin. */
const binEntryCount = () => page.evaluate(async () => {
    const body = await (await fetch('/session-purge/trash')).json();
    return body.entries.length;
});

/** Click one named action inside a titled row. */
const clickBinRowAction = (title, action) => page.evaluate(([wanted, label]) => {
    const dialog = document.querySelector('[role="dialog"][aria-label="回收站"], [role="dialog"][aria-label="Recycle bin"]');
    const row = [...dialog.querySelectorAll('.sd-bin-row')].find((candidate) =>
        candidate.querySelector('.sd-bin-row-title')?.textContent === wanted);
    if (row === undefined) return false;
    const button = [...row.querySelectorAll('button')].find((candidate) => candidate.textContent === label);
    if (button === undefined) return false;
    button.click();
    return true;
}, [title, action]);

await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Permanent delete: it must ask first, then remove exactly that entry.
const purgedTitle = await moveFirstSessionToBin();
await ensureBinOpen();
check('a listed row offers permanent delete', await clickBinRowAction(purgedTitle, '真实删除'),
    purgedTitle);
await page.waitForTimeout(500);
const purgeConfirm = await page.evaluate(() =>
    document.querySelector('.sd-bin-confirm-text')?.textContent ?? null);
check('permanent delete asks for confirmation and says it is final',
    purgeConfirm !== null && /不可恢复|cannot be undone/.test(purgeConfirm), String(purgeConfirm));
const purgeConfirmButton = await page.evaluate(() =>
    document.querySelector('.sd-bin-confirm .sd-dlg-btn-danger')?.textContent ?? null);
check('the confirmation button affirms with "确定", not a second "真实删除"',
    purgeConfirmButton === '确定', String(purgeConfirmButton));
await page.screenshot({ path: join(shots, '09-purge-confirm.png') });
await page.evaluate(() => document.querySelector('.sd-bin-confirm .sd-dlg-btn-danger')?.click());
await page.waitForTimeout(1500);
check('permanent delete removes the entry from the host', (await binEntryCount()) === 0);
check('and from the panel', await page.evaluate((title) =>
    ![...document.querySelectorAll('.sd-bin-row-title')].some((node) => node.textContent === title), purgedTitle));

// Emptying the bin through its own confirmation.
const emptiedTitle = await moveFirstSessionToBin();
await ensureBinOpen();
check('the bin holds the new entry', (await binEntryCount()) === 1);
await page.evaluate(() => document.querySelector('.sd-bin-link')?.click());
await page.waitForTimeout(500);
const emptyConfirm = await page.evaluate(() =>
    document.querySelector('.sd-bin-confirm-text')?.textContent ?? null);
check('emptying states the count before doing it',
    emptyConfirm !== null && /永久删除全部 1 个会话|Permanently delete all 1 sessions/.test(emptyConfirm),
    String(emptyConfirm));
const emptyConfirmButton = await page.evaluate(() =>
    document.querySelector('.sd-bin-confirm .sd-dlg-btn-danger')?.textContent ?? null);
check('emptying also affirms with "确定"', emptyConfirmButton === '确定', String(emptyConfirmButton));
await page.evaluate(() => document.querySelector('.sd-bin-confirm .sd-dlg-btn-danger')?.click());
await page.waitForTimeout(1800);
check('emptying clears the bin on the host', (await binEntryCount()) === 0);
check('and shows the empty state', await page.evaluate((title) => {
    const dialog = document.querySelector('[role="dialog"][aria-label="回收站"], [role="dialog"][aria-label="Recycle bin"]');
    const stillThere = [...document.querySelectorAll('.sd-bin-row-title')].some((node) => node.textContent === title);
    return !stillThere && /回收站是空的|recycle bin is empty/i.test(dialog?.textContent ?? '');
}, emptiedTitle));
await page.screenshot({ path: join(shots, '08-bin-emptied.png') });

// Leave the isolated home as we found it (auto-clean on, 30 days, 6 hours).
await page.evaluate(async () => {
    await fetch('/session-purge/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ autoClean: true, retentionDays: 30, sweepIntervalHours: 6 }),
    });
});

check('no uncaught page error during the whole flow', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();

console.log(`\nscreenshots: ${shots}`);
for (const message of notes) console.log(`note: ${message}`);
if (failures.length > 0) {
    console.error(`\nFAILED (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
}
else {
    console.log('\nOK: sidebar entry, panel, move-to-bin, restore, purge, empty and the settings page all verified live');
}

/**
 * Squared RGB distance between two colour strings. Accepts both `rgb(...)` (a
 * computed value) and `#rrggbb` (a raw token — a third-party theme such as Nord
 * overrides the tokens with hex). Infinity when either side is unparseable.
 */
function colorDistance(left, right) {
    const parse = (value) => {
        const text = String(value ?? '').trim();
        const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(text);
        if (rgb !== null) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
        const hex = /^#([0-9a-f]{6})$/i.exec(text);
        if (hex !== null) {
            const number = parseInt(hex[1], 16);
            return [(number >> 16) & 0xff, (number >> 8) & 0xff, number & 0xff];
        }
        return null;
    };
    const a = parse(left);
    const b = parse(right);
    if (a === null || b === null) return Number.POSITIVE_INFINITY;
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}
