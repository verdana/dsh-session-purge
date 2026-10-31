/**
 * 入口形态的实机探针：图标 → 菜单 → 图标，一次跑完。
 *
 * 覆盖的是**契约面**（上游槽位真的接上了），而不是纯函数：
 *   1. 图标形态：工作区行有 glyph，全局面板列里没有「回收站」；
 *   2. 设置页切到「菜单」：导航行立刻出现、弹窗被关掉、行排在「自动化任务」之后；
 *   3. 点行进入整页：`aria-current`、标题、列表、行宽（> 900px）、无遮罩；
 *   4. 折叠轨道：行还在，只剩 glyph、不渲染文字；
 *   5. 切回「图标」：页面退出、导航行移除、glyph 回到工作区行、设置已落盘。
 *
 * 前置条件：隔离实例处于「图标」形态（默认），且 `~` 下至少有一个会话。
 * 探针会往回收站里放一条会话，结束时复原它。
 *
 * 用法：node tools/entry-placement-probe.mjs "http://127.0.0.1:3199/?token=..."
 * 依赖：playwright（从 DSH 仓库的 apps/web 解析，和 bin-live-probe.mjs 同一约定）。
 */
import { createRequire } from 'node:module';

const require = createRequire(process.env.DSH_WEB_PACKAGE ?? 'D:/deepseek-harness/apps/web/package.json');
const { chromium } = require('playwright');

const url = process.argv[2];
if (url === undefined) {
    throw new Error('usage: node tools/entry-placement-probe.mjs "http://127.0.0.1:<port>/?token=..."');
}

const failures = [];
const check = (label, ok, detail) => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  (${detail})`}`);
    if (!ok) failures.push(label);
};

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (error) => console.log('  PAGEERROR: ' + error.message));

try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(3_000);
    for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
    }

    const panelNav = page.locator('nav[aria-label="全局面板"], nav[aria-label="Global panels"]').first();
    await panelNav.waitFor({ state: 'visible', timeout: 30_000 });

    // ── 1. 起点必须是图标形态 ───────────────────────────────────────────────
    const headerIcon = page.locator('button[aria-label="回收站"], button[aria-label="Recycle bin"]').first();
    await headerIcon.waitFor({ state: 'visible', timeout: 20_000 });
    check('起点是图标形态', (await headerIcon.evaluate((el) => el.closest('nav') === null)));
    check('此时导航列里没有回收站', (await panelNav.locator('button[aria-label="回收站"]').count()) === 0);

    // ── 2. 图标 → 菜单（通过设置页，不刷新页面）────────────────────────────
    await headerIcon.click();
    const policyBtn = page.locator('.sd-bin-policy-btn').first();
    await policyBtn.waitFor({ state: 'visible', timeout: 15_000 });
    await policyBtn.click();

    const dialog = page.locator('[role="dialog"]').first();
    await dialog.waitFor({ state: 'visible', timeout: 20_000 });
    await dialog.locator('nav button').filter({ hasText: /^回收站$|^Recycle bin$/ }).first().click();
    await page.waitForTimeout(700);

    const placementRow = dialog.locator('.sd-set-row').filter({ hasText: /入口位置|Entry position/ }).first();
    check('设置页有「入口位置」一行', (await placementRow.count()) === 1);
    await placementRow.locator('button').filter({ hasText: /^菜单$|^Menu$/ }).first().click();
    await page.waitForTimeout(1_500);

    const menuRow = panelNav.locator('button[aria-label="回收站"]').first();
    check('切到菜单后导航行立刻出现', await menuRow.isVisible());
    check('弹窗已被关掉', (await page.locator('.sd-bin-card, .sd-bin-mask').count()) === 0);

    const rows = await panelNav.locator('button[aria-label]').evaluateAll((els) =>
        els.map((el) => el.getAttribute('aria-label')));
    check('排在自动化任务之后、更多之前',
        rows.indexOf('回收站') === rows.indexOf('自动化任务') + 1, JSON.stringify(rows));
    check('展开态渲染文字标签', ((await menuRow.textContent()) || '').includes('回收站'));

    for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
    }

    // ── 3. 往回收站里放一条真实会话，再看页面 ──────────────────────────────
    const sessionRow = page.locator('button[aria-label^="会话"]').first();
    if ((await sessionRow.count()) === 0) throw new Error('这个实例里没有可移入的会话');
    await sessionRow.locator('xpath=ancestor::*[self::li or self::div][1]').hover().catch(() => {});
    await sessionRow.click({ force: true });
    await page.waitForTimeout(900);
    await page.getByRole('menuitem', { name: /移入回收站|Move to recycle bin/ }).click();
    await page.waitForTimeout(900);
    await page.locator('.sd-dlg-actions button').last().click();
    await page.waitForTimeout(2_200);

    await menuRow.click();
    const binPage = page.locator('.sd-bin-page').first();
    await binPage.waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(1_000);

    check('点击进入回收站页面', await binPage.isVisible());
    check('侧边栏行进入选中态', (await menuRow.getAttribute('aria-current')) === 'page');
    check('页面标题是回收站',
        ((await page.locator('.sd-bin-page-title').first().textContent()) || '').trim() === '回收站');
    check('没有弹窗遮罩', (await page.locator('.sd-bin-mask, .sd-bin-card').count()) === 0);

    // 标题必须和 shell 自己的全局页面同字号（插件页实测 20px / 500 / 28px）。
    const titleMetrics = await page.evaluate(() => {
        const style = getComputedStyle(document.querySelector('.sd-bin-page-title'));
        return { size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight };
    });
    check('标题与插件页同字号', titleMetrics.size === '20px' && titleMetrics.weight === '500'
        && titleMetrics.lineHeight === '28px', JSON.stringify(titleMetrics));

    // 滚动只能来自页面本身：列表再长也不许自建滚动容器（否则会出现第二条滚动条）。
    const scrollOwners = await page.evaluate(() => {
        const pageEl = document.querySelector('.sd-bin-page');
        const list = document.querySelector('.sd-bin-page .sd-bin-list');
        return {
            pageOverflow: getComputedStyle(pageEl).overflowY,
            listOverflow: list === null ? null : getComputedStyle(list).overflowY,
        };
    });
    check('列表不自建滚动条', scrollOwners.listOverflow === null || scrollOwners.listOverflow === 'visible',
        JSON.stringify(scrollOwners));
    check('页面是唯一滚动容器', scrollOwners.pageOverflow === 'auto', String(scrollOwners.pageOverflow));

    const pageBox = await binPage.boundingBox();
    check('页面占满中间栏', pageBox !== null && pageBox.width > 900, JSON.stringify(pageBox));

    const rowCount = await page.locator('.sd-bin-page .sd-bin-row').count();
    check('页面里有条目', rowCount >= 1, `rows=${rowCount}`);
    const rowBox = await page.locator('.sd-bin-page .sd-bin-row').first().boundingBox();
    check('行宽用满页面（远宽于 760px 弹窗）', rowBox !== null && rowBox.width > 900, JSON.stringify(rowBox));

    await page.screenshot({ path: process.env.TEMP ? `${process.env.TEMP}/entry-page-rows.png` : 'entry-page-rows.png' });

    // ── 4. 折叠轨道只剩图标 ────────────────────────────────────────────────
    await page.locator('button[aria-label="收起侧边栏"], button[aria-label="Collapse sidebar"]').first().click();
    await page.waitForTimeout(1_200);
    const railBox = await menuRow.boundingBox();
    check('折叠后行仍在且只剩 glyph', railBox !== null && railBox.width < 40, JSON.stringify(railBox));
    check('折叠后不渲染文字', ((await menuRow.textContent()) || '').trim() === '');
    await page.locator('button[aria-label="打开侧边栏"], button[aria-label="Open sidebar"]').first().click();
    await page.waitForTimeout(900);

    // ── 5. 复原刚才那条，再切回图标 ────────────────────────────────────────
    const restore = page.locator('.sd-bin-page .sd-bin-row button')
        .filter({ hasText: /^复原$|^Restore$/ }).first();
    if ((await restore.count()) > 0) {
        await restore.click();
        await page.waitForTimeout(2_000);
        check('页面里的「复原」可用', (await page.locator('.sd-bin-page .sd-bin-row').count()) === 0);
    }

    await page.locator('.sd-bin-policy-btn').first().click();
    await dialog.waitFor({ state: 'visible', timeout: 20_000 });
    await dialog.locator('nav button').filter({ hasText: /^回收站$|^Recycle bin$/ }).first().click();
    await page.waitForTimeout(700);
    await dialog.locator('.sd-set-row').filter({ hasText: /入口位置|Entry position/ }).first()
        .locator('button').filter({ hasText: /^图标$|^Icon$/ }).first().click();
    await page.waitForTimeout(2_000);

    check('切回图标后页面退出', (await page.locator('.sd-bin-page').count()) === 0);
    check('菜单行已移除', (await panelNav.locator('button[aria-label="回收站"]').count()) === 0);
    check('glyph 回到工作区行',
        (await page.locator('button[aria-label="回收站"]').first()
            .evaluate((el) => el.closest('nav') === null)));

    const persisted = await page.evaluate(async () => {
        const response = await fetch('/session-purge/settings', { headers: { accept: 'application/json' } });
        return response.ok ? (await response.json()).settings.entryPlacement : 'HTTP ' + response.status;
    });
    check('设置已落盘', persisted === 'icon', String(persisted));
} catch (error) {
    failures.push('threw: ' + error.message);
    console.log('  THREW: ' + error.stack);
} finally {
    await browser.close();
}

console.log(failures.length === 0 ? '\nALL PASS' : `\n${failures.length} FAILED: ${failures.join(' | ')}`);
process.exit(failures.length === 0 ? 0 : 1);
