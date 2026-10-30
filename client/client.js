window.__ModuleLoader__.load({ id: "dsh-session-purge", factory: (require) => {

	var module = { exports: {} };
	var exports = module.exports;
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	var React = require("react");
	var ReactDOMClient = require("react-dom/client");

	// ── optional UI primitives ───────────────────────────────────────────────
	// `@deepseek-ai/dsh-client-ui-primitives` is a platform seed word: the shell
	// already holds the one instance, so requiring it adds no dependency. This
	// plugin also runs against older shells, so every use is guarded and falls
	// back to the plugin's own styles rather than failing to render.
	var primitives = null;
	try {
		var loadedPrimitives = require("@deepseek-ai/dsh-client-ui-primitives");
		if (loadedPrimitives !== null && typeof loadedPrimitives === "object") {
			primitives = loadedPrimitives;
		}
	} catch (e) {
		primitives = null;
	}

	/** One primitive component by name, or null when this shell does not ship it. */
	function primitive(name) {
		if (primitives === null) return null;
		var value = primitives[name];
		return typeof value === "function" ? value : null;
	}

	// ── dictionaries ─────────────────────────────────────────────────────────
	var DICTS = {
		zh: {
			"menu.trashSession": "移入回收站",
			"dialog.cwd": "目录：{cwd}",
			"dialog.trash.title": "移入回收站",
			"dialog.trash.target": "将把「{name}」移入回收站，可随时复原。",
			"dialog.trash.policy": "回收站自动清理：保留 {days} 天",
			"dialog.trash.policyOff": "回收站自动清理：已关闭",
			"dialog.trash.done": "已移入回收站「{name}」。",
			"dialog.trash.openBin": "打开回收站",
			"dialog.trash.queued": "该会话暂驻内存，已转为重启后移入回收站。",
			"dialog.locateFail": "无法定位该会话，请重试或刷新页面后再试。",
			"bin.title": "回收站",
			"bin.count": "{n} 个会话",
			"bin.empty.title": "回收站是空的",
			"bin.empty.hint": "删除的会话会先放到这里，可在保留期内随时复原。",
			"bin.untitled": "未命名会话",
			"bin.deletedAt": "删除于 {when}",
			"bin.expiring": "将在下次自动清理时删除",
			"bin.restore": "复原",
			"bin.purge": "真实删除",
			// The affirmative button of the inline confirmation row (the row text
			// already states the consequence, so the button only says "yes").
			"bin.confirm": "确定",
			"bin.purging": "删除中…",
			"bin.restored": "已复原「{name}」",
			"bin.restoreHint": "已复原，刷新页面（Ctrl+Shift+R）后可见",
			"bin.restoreConflict": "该会话已存在，无法复原",
			"bin.restoreMissingCwd": "原始目录已不存在，复原后可能不会显示在列表中",
			"bin.confirmPurge": "永久删除「{name}」？不可恢复。",
			"bin.confirmEmpty": "永久删除全部 {n} 个会话（共 {size}）？不可恢复。",
			"bin.emptyAll": "清空回收站",
			"bin.cancel": "取消",
			"bin.loadMore": "加载更多",
			"bin.loading": "正在读取回收站…",
			"bin.loadFailed": "读取回收站失败",
			"bin.retry": "重试",
			"bin.footer": "共 {n} 个会话 · 占用 {size}",
			"bin.emptyPartial": "有 {n} 个会话未能删除，已保留在列表中",
			"bin.swept": "已自动清理 {n} 个过期会话",
			"bin.policyOn": "自动清理：保留 {days} 天",
			"bin.policyOff": "自动清理：已关闭",
			"bin.openFailed": "无法打开回收站，请稍后重试",
			"bin.close": "关闭",
			"bin.settingsHint": "打开左下角账号菜单 → 设置 → 回收站",
			"settings.section": "回收站",
			"settings.autoClean": "自动清理回收站",
			"settings.autoCleanHint": "关闭后回收站不再自动删除任何条目，只能手动清理。",
			"settings.retention": "保留时长",
			"settings.retentionHint": "超过保留期的条目会在下一次清理时被永久删除。",
			"settings.retention.forever": "永久",
			"settings.retention.days": "{n} 天",
			"settings.sweepOnBoot": "启动时清理一次",
			"settings.sweepOnBootHint": "每次启动 dsh web 时按保留期清理一次。",
			"settings.sweepInterval": "清理周期（小时）",
			"settings.sweepIntervalHint": "1–168 小时；改完立即生效，无需重启。",
			"settings.stats": "共 {n} 个会话 · 占用 {size} · 最近清理：{when}",
			"settings.never": "从未",
			"settings.sweepNow": "立即清理",
			"settings.openBin": "打开回收站",
			"settings.saveFailed": "设置保存失败，请重试",
			"settings.unavailable": "暂时读不到回收站设置，请重试",
			"settings.version": "版本 {version}",
			"settings.upToDate": "已是最新版本",
			"settings.updateAvailable": "有新版本 {version} 可用",
			"settings.viewOnNpm": "在 npm 上查看",
			"row.locked": "该会话正在运行——请先停止或等它完成，再移入回收站",
			"row.trash": "移入回收站",
			"row.cancel": "取消",
			"row.working": "处理中…",
			"sidebar.trash": "回收站",
			"sidebar.trashWithCount": "回收站（{n}）",
			"time.justNow": "刚刚",
			"time.minutes": "{n} 分钟前",
			"time.hours": "{n} 小时前",
			"time.days": "{n} 天前",
			"error.live": "会话正在运行——请先停止或等它完成，再移入回收站",
			"error.busy": "会话正在后台整理（压缩/收尾），请稍等几秒再试",
			"error.held": "暂无法安全释放该会话，已转为重启后移入回收站",
			"error.already": "该会话已在回收站中",
			"error.unknown": "未找到该会话的记录（磁盘上可能已不存在）",
			"error.rm": "文件操作失败（文件可能被占用，请稍后重试）",
			"error.storage": "存储服务暂时不可用，请稍后重试",
			"error.unavailable": "运行时缺少所需服务",
			"error.invalid": "无效的会话标识",
			"error.unsupported": "存储后端不支持该操作，或无法确认会话目录",
			"error.conflict": "该会话已存在，无法复原",
			"error.duplicate": "回收站里已有该会话，但目录仍在磁盘上；请先复原或永久删除回收站中的那条",
			"error.origin": "拒绝跨源请求",
			"error.bad-request": "请求格式错误",
			"error.too-large": "请求内容过大",
			"error.internal": "内部错误",
			"error.fallback": "操作失败"
		},
		en: {
			"menu.trashSession": "Move to recycle bin",
			"dialog.cwd": "Folder: {cwd}",
			"dialog.trash.title": "Move to recycle bin",
			"dialog.trash.target": "“{name}” will be moved to the recycle bin. You can restore it later.",
			"dialog.trash.policy": "Auto-clean: keep for {days} days",
			"dialog.trash.policyOff": "Auto-clean: off",
			"dialog.trash.done": "Moved “{name}” to the recycle bin.",
			"dialog.trash.openBin": "Open recycle bin",
			"dialog.trash.queued": "This session is resident in memory; it will move to the recycle bin on restart.",
			"dialog.locateFail": "Could not locate this session — retry or reload the page.",
			"bin.title": "Recycle bin",
			"bin.count": "{n} sessions",
			"bin.empty.title": "The recycle bin is empty",
			"bin.empty.hint": "Deleted sessions land here and can be restored until the retention period ends.",
			"bin.untitled": "Untitled session",
			"bin.deletedAt": "Deleted {when}",
			"bin.expiring": "Will be removed by the next auto-clean",
			"bin.restore": "Restore",
			"bin.purge": "Delete permanently",
			"bin.confirm": "Confirm",
			"bin.purging": "Deleting…",
			"bin.restored": "Restored “{name}”",
			"bin.restoreHint": "Restored — refresh the page (Ctrl+Shift+R) to see it",
			"bin.restoreConflict": "That session already exists and cannot be restored",
			"bin.restoreMissingCwd": "The original folder no longer exists; the restored session may not appear in the list",
			"bin.confirmPurge": "Permanently delete “{name}”? This cannot be undone.",
			"bin.confirmEmpty": "Permanently delete all {n} sessions ({size})? This cannot be undone.",
			"bin.emptyAll": "Empty the recycle bin",
			"bin.cancel": "Cancel",
			"bin.loadMore": "Load more",
			"bin.loading": "Reading the recycle bin…",
			"bin.loadFailed": "Could not read the recycle bin",
			"bin.retry": "Retry",
			"bin.footer": "{n} sessions · {size}",
			"bin.emptyPartial": "{n} session(s) could not be deleted and stay in the list",
			"bin.swept": "Auto-cleaned {n} expired sessions",
			"bin.policyOn": "Auto-clean: keep {days} days",
			"bin.policyOff": "Auto-clean: off",
			"bin.openFailed": "Could not open the recycle bin — try again",
			"bin.close": "Close",
			"bin.settingsHint": "Open the account menu (bottom left) → Settings → Recycle bin",
			"settings.section": "Recycle bin",
			"settings.autoClean": "Auto-clean the recycle bin",
			"settings.autoCleanHint": "When off, nothing is deleted automatically — only manual clean-up runs.",
			"settings.retention": "Retention period",
			"settings.retentionHint": "Entries older than this are permanently deleted by the next sweep.",
			"settings.retention.forever": "Forever",
			"settings.retention.days": "{n} days",
			"settings.sweepOnBoot": "Sweep once at startup",
			"settings.sweepOnBootHint": "Run one retention sweep each time dsh web starts.",
			"settings.sweepInterval": "Sweep interval (hours)",
			"settings.sweepIntervalHint": "1–168 hours; takes effect immediately, no restart.",
			"settings.stats": "{n} sessions · {size} · last swept: {when}",
			"settings.never": "never",
			"settings.sweepNow": "Clean up now",
			"settings.openBin": "Open the recycle bin",
			"settings.saveFailed": "Could not save the setting — try again",
			"settings.unavailable": "The recycle-bin settings are temporarily unavailable — retry",
			"settings.version": "Version {version}",
			"settings.upToDate": "Up to date",
			"settings.updateAvailable": "Version {version} is available",
			"settings.viewOnNpm": "View on npm",
			"row.locked": "This session is running — stop it (or let it finish) before moving it to the bin",
			"row.trash": "Move to recycle bin",
			"row.cancel": "Cancel",
			"row.working": "Working…",
			"sidebar.trash": "Recycle bin",
			"sidebar.trashWithCount": "Recycle bin ({n})",
			"time.justNow": "just now",
			"time.minutes": "{n} min ago",
			"time.hours": "{n} h ago",
			"time.days": "{n} days ago",
			"error.live": "Session is running — stop it (or let it finish), then retry",
			"error.busy": "Session is settling background work; retry in a few seconds",
			"error.held": "Could not release this session safely; queued for the bin on restart",
			"error.already": "That session is already in the recycle bin",
			"error.unknown": "Session record not found (it may already be gone from disk)",
			"error.rm": "File operation failed (files may be locked; retry shortly)",
			"error.storage": "Session storage is temporarily unavailable; retry shortly",
			"error.unavailable": "Required runtime service is missing",
			"error.invalid": "Invalid session id",
			"error.unsupported": "Storage backend does not support this operation, or the session directory could not be proven",
			"error.conflict": "That session already exists and cannot be restored",
			"error.duplicate": "This session is already in the bin, but its folder is still on disk; restore it or permanently delete the bin entry first",
			"error.origin": "Cross-origin request rejected",
			"error.bad-request": "Malformed request",
			"error.too-large": "Request body is too large",
			"error.internal": "Internal error",
			"error.fallback": "Operation failed"
		}
	};

	var ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.2h11"/><path d="M6.4 4.2V3c0-.44.36-.8.8-.8h1.6c.44 0 .8.36.8.8v1.2"/><path d="M4 4.2l.55 8.9c.03.5.45.9.96.9h4.98c.5 0 .93-.4.96-.9L12 4.2"/><path d="M6.6 7v4.4M9.4 7v4.4"/></svg>';
	/** Same slot, same weight: a tick for the terminal "it worked" state. */
	var OK_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2 8.6l3.1 3.1 6.5-7.3"/></svg>';

	// ── settings nav icon ───────────────────────────────────────────────────
	//
	// The shell derives a settings nav glyph from the section id and falls back
	// to a gear for every community id (`ui-settings-general` navIcon); the
	// `settings.section` contract carries `id`/`order`/`label` but no icon. The
	// plugin therefore marks its own nav row in the DOM and paints the bin glyph
	// through a CSS mask: the shell's gear stays untouched for React to own and
	// is hidden only while our marker is present. The SVG is the exact
	// `IconTrashOutlineRegular` geometry at the shell's nav-icon weight (Medium,
	// 1px stroke), so it sits beside the other settings glyphs without looking
	// borrowed or slightly too bold.
	var SETTINGS_NAV_ATTR = "data-sd-settings-nav";
	var NAV_ICON_MASK = "url(\"data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22none%22%20stroke%3D%22black%22%20stroke-width%3D%221%22%3E%3Cpath%20d%3D%22M1.28149%203.88831H14.7187%22%2F%3E%3Cpath%20d%3D%22M5.41602%203.88833V2.47962C5.41602%202.29282%205.52492%202.11366%205.71876%201.98157C5.9126%201.84948%206.17551%201.77527%206.44964%201.77527H9.55053C9.82466%201.77527%2010.0876%201.84948%2010.2814%201.98157C10.4753%202.11366%2010.5842%202.29282%2010.5842%202.47962V3.88833%22%2F%3E%3Cpath%20d%3D%22M2.57349%203.88831L3.19366%2013.2943C3.21937%2013.5502%203.33952%2013.7872%203.53065%2013.9593C3.72178%2014.1313%203.97016%2014.2259%204.22729%2014.2246H11.7728C12.0299%2014.2259%2012.2783%2014.1313%2012.4694%2013.9593C12.6605%2013.7872%2012.7807%2013.5502%2012.8064%2013.2943L13.4266%203.88831%22%2F%3E%3Cpath%20d%3D%22M6.44946%206.98926V11.1238%22%2F%3E%3Cpath%20d%3D%22M9.55054%206.98926V11.1238%22%2F%3E%3C%2Fsvg%3E\")";

	var CSS = [
		".sd-icon{display:inline-flex;align-items:center;flex:none}",
		".sd-dlg-host{position:fixed;inset:0;z-index:2200;pointer-events:none}",
		".sd-dlg-backdrop{position:fixed;inset:0;z-index:2200;background:rgba(0,0,0,.32);pointer-events:auto}",
		".sd-dlg{position:fixed;z-index:2201;left:50%;top:50%;transform:translate(-50%,-50%);width:340px;max-width:calc(100vw - 32px);background:var(--dsw-alias-bg-overlay,#1c2030);border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.35);padding:16px;pointer-events:auto}",
		".sd-dlg-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e8ecff);display:flex;align-items:center;gap:8px}",
		".sd-dlg-title .sd-icon{color:var(--dsw-alias-state-warn-primary,#e5a000)}",
		".sd-dlg-text{margin-top:10px;font-size:12px;line-height:1.65;color:var(--dsw-alias-label-primary,#e8ecff);word-break:break-word}",
		".sd-dlg-cwd{margin-top:6px;font-size:11px;color:var(--dsw-alias-label-secondary,#8a93a6);word-break:break-all}",
		".sd-dlg-note{margin-top:8px;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary,#8a93a6)}",
		".sd-dlg-note-warn{color:var(--dsw-alias-state-warn-primary,#e5a000)}",
		".sd-dlg-err{margin-top:8px;font-size:11px;line-height:1.6;color:var(--dsw-alias-state-error-primary,#ff8080);word-break:break-word}",
		".sd-dlg-actions{margin-top:14px;display:flex;justify-content:flex-end;gap:8px}",
		".sd-dlg-btn{height:28px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.32));background:transparent;color:var(--dsw-alias-label-secondary,#8a93a6);font-size:12px;cursor:pointer;white-space:nowrap}",
		".sd-dlg-btn:hover{color:var(--dsw-alias-label-primary,#e8ecff);border-color:var(--dsh-alias-label-secondary,#8a93a6)}",
		".sd-dlg-btn:disabled{opacity:.55;cursor:default}",
		".sd-dlg-btn-danger{background:var(--dsw-alias-state-error-primary,#e5484d);border-color:transparent;color:#fff;font-weight:600}",
		".sd-dlg-btn-danger:hover{color:#fff;filter:brightness(1.08)}",
		// A completed move is reported by a top-center toast, not a modal (the
		// confirmation is the only click worth demanding; the host's own archive
		// toast is the convention this follows). The hold drives the fade's
		// delay through the custom property, so unmount and fade cannot drift.
		"@keyframes sd-toast-in{from{opacity:0;transform:translate(-50%,-10px)}to{opacity:1;transform:translate(-50%,0)}}",
		"@keyframes sd-toast-out{from{opacity:1}to{opacity:0}}",
		".sd-toast{position:fixed;top:18px;left:50%;transform:translate(-50%,0);z-index:2300;display:flex;align-items:center;gap:8px;max-width:min(520px,calc(100vw - 32px));background:var(--dsw-alias-bg-overlay,#1c2030);border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.35);padding:10px 14px;animation:sd-toast-in .22s ease-out both,sd-toast-out .8s ease-in var(--sd-toast-hold,6000ms) both;pointer-events:none}",
		".sd-toast .sd-toast-icon{display:flex;flex:none;color:var(--dsw-alias-state-success-primary,#22c55e)}",
		".sd-toast .sd-toast-text{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-primary,#e8ecff);word-break:break-word}",
		".sd-toast .sd-toast-action{pointer-events:auto;flex:none;background:none;border:none;padding:0;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary,#e8ecff);font-weight:600;cursor:pointer;white-space:nowrap;text-decoration:underline}",
		".sd-toast .sd-toast-action:hover{filter:brightness(1.12)}",
		// Moving a session to the bin is reversible, so the confirming button is
		// neutral rather than danger-red — the destructive colour now belongs to
		// the bin's own "delete permanently" action.
		".sd-dlg-btn-primary{background:var(--dsw-alias-bg-overlay-2,rgba(127,127,127,.18));border-color:transparent;color:var(--dsw-alias-label-primary,#e8ecff);font-weight:600}",
		".sd-dlg-btn-primary:hover{color:var(--dsw-alias-label-primary,#e8ecff);filter:brightness(1.12)}",
		// The queued / nothing-located terminals keep the amber warning look: they
		// are neither a success nor a destructive confirmation.
		".sd-dlg-btn-warn{background:var(--dsw-alias-state-warn-primary,#e5a000);border-color:transparent;color:#1b1b1b;font-weight:600}",
		".sd-dlg-btn-warn:hover{color:#1b1b1b;filter:brightness(1.06)}",
		// ── recycle bin ──────────────────────────────────────────────────────
		".sd-trash-entry{display:inline-flex;align-items:center;flex:none}",
		".sd-bin-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#8a93a6);border-radius:6px;cursor:pointer}",
		".sd-bin-iconbtn:hover{background:var(--dsw-alias-bg-overlay-2,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#e8ecff)}",
		".sd-bin-root{position:fixed;inset:0;z-index:2300;pointer-events:none}",
		".sd-bin-mask{position:fixed;inset:0;z-index:2300;background:rgba(0,0,0,.32);pointer-events:auto}",
		".sd-bin-card{position:fixed;z-index:2301;left:50%;top:50%;transform:translate(-50%,-50%);width:760px;max-width:calc(100vw - 32px);max-height:calc(100vh - 96px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay,#1c2030);border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.35);padding:16px;pointer-events:auto}",
		// The shell's Modal card is `min(380px, 100%)` — a third of what a session
		// list needs, and the reason titles used to be squeezed into ellipses. The
		// doubled class raises specificity so the override cannot lose a
		// stylesheet-order race with the shell's own CSS.
		".sd-bin-modal.sd-bin-modal{width:min(760px,100%)}",
		".sd-bin-head{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e8ecff)}",
		".sd-bin-head .sd-icon{color:var(--dsw-alias-label-secondary,#8a93a6)}",
		".sd-bin-head-count{font-size:11px;font-weight:400;color:var(--dsw-alias-label-secondary,#8a93a6)}",
		".sd-bin-head-close{margin-left:auto;padding:2px 6px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#8a93a6);font-size:14px;line-height:1;cursor:pointer}",
		".sd-bin-head-close:hover{background:var(--dsw-alias-bg-overlay-2,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#e8ecff)}",
		// The panel body has to own a layout context, or the list below has no
		// definite height to overflow against: as a plain block child of the card
		// it would size itself to its own content, `flex:1 1 auto` on the list
		// would be inert, and rows past the fold would simply be clipped instead
		// of scrollable. Being the card's shrinkable flex item (`min-height:0` is
		// what actually allows it to be shorter than its content) is what passes
		// a real height budget down to the list.
		".sd-bin-body{display:flex;flex-direction:column;min-height:0;flex:1 1 auto;overflow:hidden}",
		// `min-height` keeps a short list from collapsing to nothing; `max-height`
		// is the seatbelt for hosts whose Modal caps its card without handing the
		// constraint down to our children — the shell's own card stops at 380px,
		// but that bound does not necessarily reach this node. 280px is the room
		// reserved off a full viewport for everything that must stay visible with
		// the list: the card padding, the head row, the footer and any notice or
		// confirm strip.
		".sd-bin-list{margin-top:10px;min-height:56px;max-height:calc(100vh - 280px);overflow:auto;overscroll-behavior:contain;flex:1 1 auto}",
		".sd-bin-row{display:flex;align-items:flex-start;gap:10px;padding:8px 4px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18))}",
		".sd-bin-row:last-child{border-bottom:none}",
		".sd-bin-row-main{flex:1 1 auto;min-width:0}",
		".sd-bin-row-title{font-size:12px;color:var(--dsw-alias-label-primary,#e8ecff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
		".sd-bin-row-meta{margin-top:3px;display:flex;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary,#8a93a6)}",
		// One long project path must not turn a row into three lines.
		".sd-bin-row-meta > span{max-width:26ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
		".sd-bin-row-warn{margin-top:4px;font-size:11px;color:var(--dsw-alias-state-warn-primary,#e5a000)}",
		".sd-bin-row-err{margin-top:4px;font-size:11px;color:var(--dsw-alias-state-error-primary,#ff8080);word-break:break-word}",
		".sd-bin-row-actions{display:flex;align-items:center;gap:6px;flex:none}",
		".sd-bin-empty{padding:30px 12px;text-align:center;font-size:12px;color:var(--dsw-alias-label-primary,#e8ecff)}",
		".sd-bin-empty-hint{margin-top:6px;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary,#8a93a6)}",
		".sd-bin-status{padding:16px 12px;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary,#8a93a6)}",
		".sd-bin-notice{margin-top:8px;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary,#8a93a6)}",
		".sd-bin-error{margin-top:8px;font-size:11px;line-height:1.6;color:var(--dsw-alias-state-error-primary,#ff8080);word-break:break-word}",
		".sd-bin-confirm{margin-top:8px;display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;background:rgba(229,72,77,.12);font-size:11px;color:var(--dsw-alias-label-primary,#e8ecff)}",
		".sd-bin-confirm-text{flex:1 1 auto;line-height:1.6;word-break:break-word}",
		".sd-bin-footer{margin-top:10px;display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:11px;color:var(--dsw-alias-label-secondary,#8a93a6)}",
		// Stats + policy take a full row of their own, so a narrow modal never
		// breaks a phrase in half; the action row follows.
		".sd-bin-footer-left{flex:1 1 100%;min-width:0;line-height:1.7}",
		".sd-bin-footer-actions{display:flex;align-items:center;gap:8px;flex:none;margin-left:auto}",
		".sd-bin-link{padding:0;border:none;background:transparent;color:var(--dsw-alias-state-error-primary,#ff8080);font-size:11px;cursor:pointer;white-space:nowrap}",
		".sd-bin-policy-btn{padding:0;border:none;background:transparent;color:inherit;font-size:11px;cursor:pointer}",
		".sd-bin-policy-btn:hover{color:var(--dsw-alias-label-primary,#e8ecff);text-decoration:underline}",
		// A quiet chevron is the affordance: a dotted underline at 11px reads as
		// clutter rather than as "this goes somewhere".
		".sd-bin-policy-chevron{margin-left:2px;font-size:10px;opacity:.7}",
		// ── settings page ────────────────────────────────────────────────────
		".sd-set{display:flex;flex-direction:column;gap:14px;max-width:600px;font-size:12px;color:var(--dsw-alias-label-primary,#e8ecff)}",
		".sd-set-heading{font-size:13px;font-weight:600}",
		".sd-set-stats{font-size:11px;line-height:1.7;color:var(--dsw-alias-label-secondary,#8a93a6)}",
		".sd-set-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}",
		".sd-set-row-main{flex:1 1 auto;min-width:0}",
		".sd-set-label{font-size:12px;line-height:1.5}",
		".sd-set-hint{margin-top:3px;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary,#8a93a6)}",
		".sd-set-control{flex:none;display:flex;align-items:center;gap:8px;padding-top:1px}",
		".sd-set-segment{display:inline-flex;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.32));border-radius:8px;overflow:hidden}",
		".sd-set-segment-btn{height:26px;padding:0 10px;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#8a93a6);font-size:11px;cursor:pointer;white-space:nowrap}",
		".sd-set-segment-btn + .sd-set-segment-btn{border-left:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18))}",
		".sd-set-segment-btn[aria-pressed=true]{background:var(--dsw-alias-bg-overlay-2,rgba(127,127,127,.18));color:var(--dsw-alias-label-primary,#e8ecff);font-weight:600}",
		".sd-set-segment-btn:disabled{opacity:.55;cursor:default}",
		".sd-set-number{width:76px;height:26px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.32));background:transparent;color:var(--dsw-alias-label-primary,#e8ecff);font-size:12px}",
		".sd-set-number:disabled{opacity:.55}",
		".sd-set-switch{position:relative;width:34px;height:18px;padding:0;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.32));background:transparent;cursor:pointer}",
		".sd-set-switch span{position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-label-secondary,#8a93a6);transition:left .12s ease}",
		".sd-set-switch[aria-checked=true]{background:var(--dsw-alias-state-success-primary,#22c55e);border-color:transparent}",
		".sd-set-switch[aria-checked=true] span{left:17px;background:#fff}",
		".sd-set-switch:disabled{opacity:.55;cursor:default}",
		".sd-set-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
		".sd-set-notice{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary,#8a93a6)}",
		".sd-set-error{font-size:11px;line-height:1.6;color:var(--dsw-alias-state-error-primary,#ff8080)}",
		// The footer closes the page: version (from the host, not this bundle) and
		// the npm update check, separated from the controls by a rule.
		".sd-set-about{margin-top:2px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));display:flex;flex-direction:column;gap:4px;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary,#8a93a6)}",
		".sd-set-version{font-variant-numeric:tabular-nums}",
		".sd-set-link{color:var(--dsw-alias-brand-primary,#4c8dff);text-decoration:none}",
		".sd-set-link:hover{text-decoration:underline}",
		// The settings nav glyph: hide the shell's gear and paint the bin in its
		// place. Both rules only apply while the marker below is present.
		"[data-sd-settings-nav=\"trash\"] > svg{display:none}",
		"[data-sd-settings-nav=\"trash\"]::before{content:\"\";flex:none;width:16px;height:16px;background-color:currentColor;-webkit-mask:" + NAV_ICON_MASK + " center/16px 16px no-repeat;mask:" + NAV_ICON_MASK + " center/16px 16px no-repeat}",
		".sd-bin-link:hover{text-decoration:underline}",
		".sd-bin-more{display:block;width:100%;height:26px;margin-top:8px;border-radius:8px;border:1px dashed var(--dsw-alias-border-l2,rgba(127,127,127,.32));background:transparent;color:var(--dsw-alias-label-secondary,#8a93a6);font-size:11px;cursor:pointer}",
		".sd-bin-more:hover{color:var(--dsw-alias-label-primary,#e8ecff)}"
	].join("\n");

	function insertStyles() {
		var tagId = "dsh-session-purge/panel.css";
		if (typeof document === "undefined") return function () {};
		var existing = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]");
		if (existing !== null) return function () {};
		var tag = document.createElement("style");
		tag.dataset.plugin = "dsh-session-purge";
		tag.dataset.pluginCss = tagId;
		tag.textContent = CSS;
		document.head.appendChild(tag);
		return function () { tag.remove(); };
	}

	// ── recycle-bin helpers ──────────────────────────────────────────────────
	//
	// The bin is a modal over the app, so it owns its own state instead of
	// living in a slot store: one module-level store, subscribed by the sidebar
	// entry (for the count in its tooltip) and by the panel itself.

	/** Entries shown before the panel offers "load more". */
	var BIN_PAGE_SIZE = 50;
	/** Sidebar anchor labels, in priority order (the add-workspace icon first). */
	var TRASH_ANCHOR_LABELS = [
		["添加工作区", "Add workspace"],
		["视图选项", "View options"]
	];

	/** 12.4 MB / 812 KB — no locale-dependent formatting surprises. */
	function formatBytes(bytes) {
		if (typeof bytes !== "number" || !isFinite(bytes) || bytes <= 0) return "0 B";
		var units = ["B", "KB", "MB", "GB", "TB"];
		var value = bytes;
		var unit = 0;
		while (value >= 1024 && unit < units.length - 1) {
			value = value / 1024;
			unit++;
		}
		var text = unit === 0
			? String(Math.round(value))
			: value.toFixed(1).replace(/\.0$/, "");
		return text + " " + units[unit];
	}

	/** "删除于 3 天前" — the relative half of an entry's timestamps. */
	function formatRelativeTime(iso, now) {
		var at = typeof iso === "string" ? Date.parse(iso) : NaN;
		if (!isFinite(at)) return "";
		var reference = typeof now === "number" ? now : Date.now();
		var seconds = Math.max(0, Math.floor((reference - at) / 1000));
		if (seconds < 60) return tr("time.justNow");
		if (seconds < 3600) return tr("time.minutes", { n: Math.floor(seconds / 60) });
		if (seconds < 86400) return tr("time.hours", { n: Math.floor(seconds / 3600) });
		return tr("time.days", { n: Math.floor(seconds / 86400) });
	}

	function shortSessionId(id) {
		if (typeof id !== "string") return "";
		return id.length > 16 ? id.slice(0, 16) + "…" : id;
	}

	/** The row title: the captured display title, or a neutral placeholder. */
	function displayTitle(entry) {
		if (entry !== null && entry !== undefined &&
			typeof entry.title === "string" && entry.title.trim() !== "") {
			return entry.title;
		}
		return tr("bin.untitled");
	}

	/** Minimal external store: actions replace state, components re-render. */
	function createStore(initial) {
		var state = initial;
		var listeners = [];
		return {
			get: function () { return state; },
			set: function (patch) {
				state = Object.assign({}, state, patch);
				var current = listeners.slice();
				for (var i = 0; i < current.length; i++) {
					try { current[i](); } catch (e) {}
				}
			},
			subscribe: function (listener) {
				listeners.push(listener);
				return function () {
					listeners = listeners.filter(function (candidate) { return candidate !== listener; });
				};
			}
		};
	}

	function useStore(store) {
		var pair = React.useState(store.get());
		var setState = pair[1];
		React.useEffect(function () {
			setState(store.get());
			return store.subscribe(function () { setState(store.get()); });
		}, [store]);
		return pair[0];
	}

	/** The one bin state every surface reads. */
	var binStore = createStore({
		open: false,
		phase: "idle",          // idle | loading | ready | failed
		entries: [],
		totalBytes: 0,
		settings: null,
		sweep: null,
		notice: null,
		error: null,
		visible: BIN_PAGE_SIZE,
		busyId: null,
		rowErrors: {},
		confirm: null           // { kind: 'purge' | 'empty', id?, name?, busy?, error? }
	});

	/** The retention line shown in the panel footer and the confirm dialog. */
	function binPolicyText() {
		var settings = binStore.get().settings;
		if (settings === null || settings === undefined) return null;
		if (settings.autoClean !== true || !(settings.retentionDays > 0)) return tr("bin.policyOff");
		return tr("bin.policyOn", { days: settings.retentionDays });
	}

	/**
	 * Re-baseline the host-authoritative session list, so a restored session
	 * appears (and a trashed one disappears) without a page reload. `refresh()`
	 * only exists on newer shells; a missing one is reported to the caller as
	 * null, which the caller turns into the "refresh the page" hint.
	 */
	function refreshSessions() {
		try {
			if (sessionsService !== null && typeof sessionsService.refresh === "function") {
				return sessionsService.refresh() || null;
			}
		} catch (e) {}
		return null;
	}

	/** One JSON request against this plugin's own host routes. */
	function binRequest(path, options) {
		var init = Object.assign({ cache: "no-store" }, options || {});
		if (init.body !== undefined && init.headers === undefined) {
			init.headers = { "content-type": "application/json" };
		}
		return fetch(path, init).then(function (response) {
			return response.json().catch(function () { return null; }).then(function (body) {
				return { status: response.status, body: body };
			});
		});
	}

	/** Error text for one refusal code, never the raw key. */
	function binErrorText(code) {
		return tr("error." + (typeof code === "string" && code !== "" ? code : "fallback"));
	}

	/** Load (or reload) the bin contents and the policy that governs them. */
	function refreshBin() {
		binStore.set({ phase: binStore.get().phase === "idle" ? "loading" : binStore.get().phase });
		return binRequest("/session-purge/trash").then(function (result) {
			var body = result.body;
			if (result.status !== 200 || body === null || body.ok !== true) {
				binStore.set({ phase: "failed", error: tr("bin.loadFailed") });
				return;
			}
			var previousSweep = binStore.get().sweep;
			var notice = null;
			// The host sweeps on its own schedule: report what it removed while
			// the panel was closed instead of silently changing the list.
			if (previousSweep !== null && body.sweep !== undefined && body.sweep !== null &&
				typeof body.sweep.lastSweepAt === "number" &&
				typeof previousSweep.lastSweepAt === "number" &&
				body.sweep.lastSweepAt > previousSweep.lastSweepAt &&
				body.sweep.lastSweepRemoved > 0) {
				notice = tr("bin.swept", { n: body.sweep.lastSweepRemoved });
			}
			binStore.set({
				phase: "ready",
				entries: Array.isArray(body.entries) ? body.entries : [],
				totalBytes: typeof body.totalBytes === "number" ? body.totalBytes : 0,
				settings: body.settings !== undefined ? body.settings : null,
				sweep: body.sweep !== undefined ? body.sweep : null,
				error: null,
				notice: notice !== null ? notice : binStore.get().notice
			});
			rememberVersion(body);
		}, function () {
			binStore.set({ phase: "failed", error: tr("bin.loadFailed") });
		});
	}

	function openTrashPanel() {
		binStore.set({ open: true, confirm: null, notice: null, rowErrors: {} });
		void refreshBin();
	}

	function closeTrashPanel() {
		binStore.set({ open: false, confirm: null });
	}

	/**
	 * Compose the report shown after a successful restore. Kept pure so the
	 * copy can be pinned by the unit tests without a DOM.
	 * @param body - the host's `/session-purge/restore` response.
	 * @param entry - the bin entry that was restored.
	 * @param refreshed - result of re-baselining the session list; null when it failed.
	 * @returns the text for the success toast.
	 */
	function restoreNoticeText(body, entry, refreshed) {
		var text = tr("bin.restored", { name: displayTitle(entry) });
		if (body !== null && body !== undefined && body.cwdMissing === true) {
			text = text + " · " + tr("bin.restoreMissingCwd");
		} else if (refreshed === null) {
			text = tr("bin.restoreHint");
		}
		return text;
	}

	/** Restore one entry, report it by toast, then re-baseline the session list. */
	function restoreBinEntry(entry) {
		binStore.set({ busyId: entry.id, error: null, notice: null });
		return binRequest("/session-purge/restore", {
			method: "POST",
			body: JSON.stringify({ sessionId: entry.id })
		}).then(function (result) {
			var body = result.body;
			if (body === null || body.ok !== true) {
				var rowErrors = Object.assign({}, binStore.get().rowErrors);
				rowErrors[entry.id] = binErrorText(body !== null && body !== undefined ? body.code : null);
				binStore.set({ busyId: null, rowErrors: rowErrors });
				return;
			}
			var entries = binStore.get().entries.filter(function (candidate) {
				return candidate.id !== entry.id;
			});
			var refreshed = refreshSessions();
			// The toast is the single report for a completed restore: the row is
			// already gone from the panel, so repeating the same sentence inside
			// it would just compete with the banner for the same news.
			var text = restoreNoticeText(body, entry, refreshed);
			binStore.set({ busyId: null, entries: entries, notice: null });
			showToast(text);
		}, function () {
			binStore.set({ busyId: null, error: tr("bin.loadFailed") });
		});
	}

	function requestBinPurge(entry) {
		binStore.set({ confirm: { kind: "purge", id: entry.id, name: displayTitle(entry), busy: false, error: null } });
	}

	function requestBinEmpty() {
		var state = binStore.get();
		binStore.set({
			confirm: {
				kind: "empty",
				count: state.entries.length,
				size: formatBytes(state.totalBytes),
				busy: false,
				error: null
			}
		});
	}

	function cancelBinConfirm() {
		var confirm = binStore.get().confirm;
		if (confirm !== null && confirm.busy === true) return;
		binStore.set({ confirm: null });
	}

	/**
	 * Sum the sizes the host reported for these rows.
	 *
	 * The footer's byte count comes from the last full read, so every list edit
	 * has to recompute it from the rows that remain — otherwise "共 N 个会话 ·
	 * 占用 X" keeps advertising space that a purge has already reclaimed.
	 */
	function totalOfRows(entries) {
		var total = 0;
		for (var i = 0; i < entries.length; i++) {
			if (typeof entries[i].sizeBytes === "number" && entries[i].sizeBytes > 0) {
				total += entries[i].sizeBytes;
			}
		}
		return total;
	}

	function confirmBinAction() {
		var confirm = binStore.get().confirm;
		if (confirm === null || confirm.busy === true) return;
		var path = confirm.kind === "purge" ? "/session-purge/purge" : "/session-purge/empty";
		var payload = confirm.kind === "purge" ? { sessionId: confirm.id } : { confirm: true };
		binStore.set({ confirm: Object.assign({}, confirm, { busy: true, error: null }) });
		// Returned so callers (and the tests) can await the outcome.
		return binRequest(path, { method: "POST", body: JSON.stringify(payload) }).then(function (result) {
			var body = result.body;
			if (body === null || body.ok !== true) {
				binStore.set({
					confirm: Object.assign({}, confirm, {
						busy: false,
						error: binErrorText(body !== null && body !== undefined ? body.code : null)
					})
				});
				return;
			}
			if (confirm.kind === "empty") {
				// "Emptied" is a batch, and a batch can partly fail: the host names
				// every entry it could not remove in `failed` (ok:true only means the
				// request ran). Clearing the list regardless would hide those rows
				// until the panel is reopened, so keep exactly the ones it reported.
				var failedCodes = {};
				var failedList = Array.isArray(body.failed) ? body.failed : [];
				for (var f = 0; f < failedList.length; f++) {
					var failure = failedList[f];
					if (failure === null || failure === undefined) continue;
					if (typeof failure.trashId !== "string") continue;
					failedCodes[failure.trashId] = failure.code;
				}
				// Nothing failed → the whole list is gone. Otherwise keep exactly the
				// rows the host named.
				var kept = [];
				if (failedList.length > 0) {
					kept = binStore.get().entries.filter(function (candidate) {
						// An entry that cannot be matched to the report is kept: a row
						// that stays visible is recoverable, one that disappears is not.
						if (typeof candidate.trashId !== "string") return true;
						return failedCodes[candidate.trashId] !== undefined;
					});
				}
				var rowErrors = Object.assign({}, binStore.get().rowErrors);
				for (var k = 0; k < kept.length; k++) {
					var code = failedCodes[kept[k].trashId];
					if (code !== undefined) rowErrors[kept[k].id] = binErrorText(code);
				}
				binStore.set({
					confirm: null,
					entries: kept,
					totalBytes: totalOfRows(kept),
					rowErrors: rowErrors,
					notice: kept.length > 0 ? tr("bin.emptyPartial", { n: kept.length }) : null
				});
				return;
			}
			var entries = binStore.get().entries.filter(function (candidate) {
				return candidate.id !== confirm.id;
			});
			binStore.set({ confirm: null, entries: entries, totalBytes: totalOfRows(entries) });
		}, function () {
			binStore.set({
				confirm: Object.assign({}, confirm, { busy: false, error: tr("bin.loadFailed") })
			});
		});
	}

	// ── settings page state ──────────────────────────────────────────────────
	//
	// The page owns one small store; the host route is the single source of
	// truth, so every accepted write replaces the local copy with what the host
	// actually stored — which is also how clamping and validation become visible.

	/** Retention choices, in display order (0 = keep forever). */
	var RETENTION_CHOICES = [7, 30, 90, 365, 0];
	var SWEEP_INTERVAL_MIN = 1;
	var SWEEP_INTERVAL_MAX = 168;
	/** The published package's "latest" document; the only network call the page makes. */
	var UPDATE_REGISTRY_URL = "https://registry.npmjs.org/dsh-session-purge/latest";
	var UPDATE_CHECK_TIMEOUT_MS = 5000;
	var NPM_PACKAGE_URL = "https://www.npmjs.com/package/dsh-session-purge";

	var settingsStore = createStore({
		phase: "idle",     // idle | loading | ready | failed
		settings: null,
		stats: null,
		version: null,     // the RUNNING HOST's version, reported by its routes
		update: null,      // { latest, newer, same } once the npm check resolves
		saving: null,      // the field being written, or "sweep"
		error: null,
		notice: null
	});

	/** Whether the one-shot npm check has been started (it must not repeat). */
	var updateCheckStarted = false;

	/** Keep the version the host reports, from whichever route answered first. */
	function rememberVersion(body) {
		if (body === null || body === undefined) return;
		var value = body.version;
		if (typeof value !== "string" || value === "") return;
		if (settingsStore.get().version !== value) settingsStore.set({ version: value });
	}

	/**
	 * Parse "1.2.3" / "v1.2.3-beta.1" into a numeric core and an optional
	 * prerelease tag. Returns null for anything that is not version-shaped, so
	 * a malformed registry reply can never raise a false update hint.
	 */
	function versionParts(value) {
		if (typeof value !== "string") return null;
		var text = value.trim().replace(/^v/i, "");
		if (text === "") return null;
		var pieces = text.split("-");
		var coreText = pieces[0].split(".");
		if (coreText.length < 1 || coreText.length > 4) return null;
		var core = [];
		for (var i = 0; i < coreText.length; i++) {
			if (!/^\d+$/.test(coreText[i])) return null;
			core.push(parseInt(coreText[i], 10));
		}
		return { core: core, pre: pieces.length > 1 ? pieces.slice(1).join("-") : null };
	}

	/** Semver-ish ordering: -1 / 0 / 1, or null when either side is unparsable. */
	function compareVersions(left, right) {
		var a = versionParts(left);
		var b = versionParts(right);
		if (a === null || b === null) return null;
		var length = Math.max(a.core.length, b.core.length);
		for (var i = 0; i < length; i++) {
			var x = i < a.core.length ? a.core[i] : 0;
			var y = i < b.core.length ? b.core[i] : 0;
			if (x !== y) return x < y ? -1 : 1;
		}
		if (a.pre === b.pre) return 0;
		// A release is newer than any prerelease of the same core version.
		if (a.pre === null) return 1;
		if (b.pre === null) return -1;
		return a.pre < b.pre ? -1 : 1;
	}

	/**
	 * Ask the npm registry for the latest published version, once per page load.
	 *
	 * This is deliberately best-effort: the settings page must never wait on it,
	 * and every failure mode (offline, blocked, CSP, a malformed reply) leaves
	 * the footer with just the version line. It only runs in a real page, so the
	 * DOM-free unit tests never touch the network.
	 */
	function checkForUpdate(current) {
		if (updateCheckStarted) return null;
		if (typeof document === "undefined" || typeof fetch !== "function") return null;
		if (typeof current !== "string" || current === "") return null;
		updateCheckStarted = true;
		var controller = typeof AbortController === "function" ? new AbortController() : null;
		var timer = controller === null ? null : setTimeout(function () {
			try { controller.abort(); } catch (e) {}
		}, UPDATE_CHECK_TIMEOUT_MS);
		function finish(payload) {
			if (timer !== null) clearTimeout(timer);
			var latest = payload !== null && typeof payload === "object" && typeof payload.version === "string"
				? payload.version
				: null;
			if (latest === null) return;
			var order = compareVersions(latest, current);
			if (order === null) return;
			settingsStore.set({ update: { latest: latest, newer: order > 0, same: order === 0 } });
		}
		fetch(UPDATE_REGISTRY_URL, {
			cache: "no-store",
			signal: controller === null ? undefined : controller.signal
		}).then(function (response) {
			if (response === null || response === undefined || response.ok === false) return null;
			return response.json().catch(function () { return null; });
		}).then(finish, function () { finish(null); });
		return null;
	}

	/** Start the check if this page load has both a version and no result yet. */
	function maybeCheckForUpdate() {
		var state = settingsStore.get();
		if (updateCheckStarted || state.update !== null) return null;
		return checkForUpdate(state.version);
	}

	/** The retention label for one choice. */
	function retentionLabel(days) {
		return days === 0
			? tr("settings.retention.forever")
			: tr("settings.retention.days", { n: days });
	}

	/** The segmented options the host's retention choices render as. */
	function retentionOptions() {
		var options = [];
		for (var i = 0; i < RETENTION_CHOICES.length; i++) {
			options.push({ value: String(RETENTION_CHOICES[i]), label: retentionLabel(RETENTION_CHOICES[i]) });
		}
		return options;
	}

	/** "最近清理：3 小时前" — "从未" until the host has swept once. */
	function lastSweepText(stats) {
		if (stats === null || stats === undefined || typeof stats.lastSweepAt !== "number") {
			return tr("settings.never");
		}
		return formatRelativeTime(new Date(stats.lastSweepAt).toISOString());
	}

	function refreshSettings() {
		settingsStore.set({ phase: settingsStore.get().phase === "ready" ? "ready" : "loading" });
		return binRequest("/session-purge/settings").then(function (result) {
			var body = result.body;
			// Even a failed read may carry the host's version (the route includes
			// it in its error body), so the footer can stay truthful.
			rememberVersion(body);
			if (result.status !== 200 || body === null || body.ok !== true) {
				settingsStore.set({ phase: "failed", error: tr("settings.unavailable") });
				return;
			}
			settingsStore.set({
				phase: "ready",
				settings: body.settings,
				stats: body.stats !== undefined ? body.stats : null,
				error: null
			});
			// The bin panel's policy line reads the same policy.
			binStore.set({ settings: body.settings });
		}, function () {
			settingsStore.set({ phase: "failed", error: tr("settings.unavailable") });
		});
	}

	function saveSetting(field, value) {
		var patch = {};
		patch[field] = value;
		settingsStore.set({ saving: field, error: null, notice: null });
		return binRequest("/session-purge/settings", {
			method: "POST",
			body: JSON.stringify(patch)
		}).then(function (result) {
			var body = result.body;
			if (body === null || body.ok !== true) {
				settingsStore.set({ saving: null, error: tr("settings.saveFailed") });
				return;
			}
			settingsStore.set({ saving: null, settings: body.settings, error: null });
			binStore.set({ settings: body.settings });
			// A sweep may have moved under this write; re-read the stats cheaply.
			void refreshSettings();
		}, function () {
			settingsStore.set({ saving: null, error: tr("settings.saveFailed") });
		});
	}

	function runSweepNow() {
		settingsStore.set({ saving: "sweep", error: null, notice: null });
		return binRequest("/session-purge/sweep", { method: "POST", body: JSON.stringify({}) })
			.then(function (result) {
				var body = result.body;
				if (body === null || body.ok !== true) {
					settingsStore.set({ saving: null, error: tr("settings.saveFailed") });
					return;
				}
				settingsStore.set({
					saving: null,
					notice: body.skipped === "disabled"
						? tr("bin.policyOff")
						: tr("bin.swept", { n: body.removed })
				});
				void refreshBin();
				void refreshSettings();
			}, function () {
				settingsStore.set({ saving: null, error: tr("settings.saveFailed") });
			});
	}

	// ── opening the settings shell from the bin ──────────────────────────────
	//
	// Upstream exposes no documented way for a plugin to open the settings
	// panel, so the plugin presses the shell's own launcher exactly as a user
	// would. Two launcher generations exist:
	//   ≤ 0.2.0  a visible sidebar button whose accessible name is 设置 / Settings
	//   0.2.1+   the account menu (账号菜单 / Account menu) occupies the shell's
	//            `settings.launcher` slot and Settings is a row inside it
	//            (dsh-client-ui-settings-account); the direct button is gone, so
	//            the search becomes two-step: open the account menu, then press
	//            its Settings row.
	// A shell that offers neither degrades to a hint, never to a dead click.

	var SETTINGS_TRIGGER_LABELS = ["设置", "Settings"];
	var ACCOUNT_MENU_LABELS = ["账号菜单", "Account menu"];
	var SETTINGS_MENU_ITEM_LABELS = ["设置", "Settings"];

	/** The first candidate that is visible, outside a menu, and labelled. Pure. */
	function pickLabeledButton(candidates, labels) {
		for (var i = 0; i < candidates.length; i++) {
			var candidate = candidates[i];
			if (candidate.visible !== true || candidate.inMenu === true) continue;
			if (labels.indexOf(candidate.label) !== -1) return candidate.index;
		}
		return -1;
	}

	/**
	 * The index of the settings row in one menu's labels, or -1. Pure.
	 *
	 * Exact equality, not the prefix tolerance the session-row verbs use: a
	 * different row that merely starts with 设置 (设置工作区…) must never be
	 * pressed. The account menu's own row label is exactly 设置 / Settings.
	 * @param labels - labels from {@link menuItemLabels}, in DOM order.
	 * @returns the matching row index, or -1.
	 */
	function pickSettingsMenuItem(labels) {
		if (!Array.isArray(labels)) return -1;
		for (var i = 0; i < labels.length; i++) {
			if (SETTINGS_MENU_ITEM_LABELS.indexOf(labels[i]) !== -1) return i;
		}
		return -1;
	}

	/** Find one visible, non-menu button by accessible name, or null. */
	function findLabeledTrigger(labels) {
		if (typeof document === "undefined") return null;
		var buttons = document.querySelectorAll("button[aria-label]");
		var candidates = [];
		for (var i = 0; i < buttons.length; i++) {
			candidates.push({
				index: i,
				label: buttons[i].getAttribute("aria-label"),
				visible: isVisibleElement(buttons[i]),
				inMenu: typeof buttons[i].closest === "function" && buttons[i].closest('[role="menu"]') !== null
			});
		}
		var picked = pickLabeledButton(candidates, labels);
		return picked < 0 ? null : buttons[picked];
	}

	function findSettingsTrigger() {
		return findLabeledTrigger(SETTINGS_TRIGGER_LABELS);
	}

	function findAccountMenuTrigger() {
		return findLabeledTrigger(ACCOUNT_MENU_LABELS);
	}

	/**
	 * Press the settings row of whichever menu is open now.
	 * @returns whether a row was found and clicked.
	 */
	function clickSettingsMenuItem() {
		if (typeof document === "undefined") return false;
		var menus = document.querySelectorAll('div[role="menu"]');
		for (var m = 0; m < menus.length; m++) {
			var labels = menuItemLabels(menus[m]);
			var index = pickSettingsMenuItem(labels);
			if (index < 0) continue;
			var buttons = menus[m].querySelectorAll('button[role="menuitem"]');
			if (index >= buttons.length) continue;
			buttons[index].click();
			return true;
		}
		return false;
	}

	/**
	 * Open the settings shell through the 0.2.1 account menu.
	 *
	 * The menu is a portal mounted on the commit after its trigger click, so the
	 * row cannot be pressed synchronously; retry on timers for a short window
	 * instead of guessing one frame. Returns whether a trigger was found at all.
	 * @returns whether the account-menu path was attempted.
	 */
	function openSettingsViaAccountMenu() {
		var trigger = findAccountMenuTrigger();
		if (trigger === null) return false;
		closeTrashPanel();
		trigger.click();
		var attempts = 0;
		function attempt() {
			if (clickSettingsMenuItem()) return;
			attempts++;
			if (attempts < 10) {
				setTimeout(attempt, 50);
				return;
			}
			// The menu never exposed a Settings row: say so on the next panel open
			// instead of leaving the click silent.
			binStore.set({ notice: tr("bin.settingsHint") });
		}
		setTimeout(attempt, 0);
		return true;
	}

	function openSettingsFromBin() {
		var trigger = findSettingsTrigger();
		if (trigger !== null) {
			closeTrashPanel();
			trigger.click();
			return;
		}
		if (openSettingsViaAccountMenu()) return;
		binStore.set({ notice: tr("bin.settingsHint") });
	}

	function baseName(p) {
		if (typeof p !== "string" || p === "") return "";
		var parts = p.split("/").filter(function (x) { return x !== ""; });
		return parts.length > 0 ? parts[parts.length - 1] : p;
	}

	// ── session identification helpers ───────────────────────────────────────
	// The upstream session-row menu is built inside dsh-client-ui-workspace and
	// exposes no extension point this plugin can reach, so we work at the DOM
	// level: a capture-phase click listener resolves which session's ⋯ button was
	// pressed (React fiber walk with an aria-label fallback), and a
	// MutationObserver adds the delete item once the menu portal mounts it.
	//
	// Two upstream generations must both work (tools/helpers.test.mjs pins the
	// captured label sets):
	//   ≤ 0.1.5  the menu renders exactly 重命名 / 分叉会话 / 归档会话, plain labels
	//   0.1.7+   it renders 置顶会话 / 重命名 / 分叉会话 / 归档会话, every verb
	//            carrying a keyboard-shortcut keycap that joins the button's
	//            textContent, and plugin-registered rows may follow that block.
	//   0.2.1+   the block gains a trailing 复制 Session ID / Copy Session ID row
	//            (no keycap); it is an extra row to the ordered-subsequence match,
	//            so detection and the archive anchor are unaffected.
	// So detection matches the three built-in verbs as an ordered subsequence
	// (instead of an exact three-item list) and the new row is anchored right
	// after the archive row, keeping it inside the built-in block.

	/** React instance key on a DOM node ("__reactFiber$<random>"), any React 17+. */
	function fiberOf(el) {
		if (el === null || el === undefined || typeof el !== "object") return null;
		var keys = Object.keys(el);
		for (var i = 0; i < keys.length; i++) {
			if (keys[i].lastIndexOf("__reactFiber$", 0) === 0) return el[keys[i]];
		}
		return null;
	}

	/**
	 * Walk up the fiber chain to the SessionNodeItem component fiber, read `node`.
	 *
	 * 0.1.5 took the session verbs as props (`onFork`/`onArchive`/`onRename`);
	 * 0.1.7 replaced them with the `sidebar.workspaces.session.menu.item` slot,
	 * so no `onFork`/`onArchive` exists any more. The stable signature in both is
	 * a `node` carrying the SessionNode `{ id, title, running }` triple, which is
	 * also what the caller needs — so match on that, plus the row-level
	 * `onOpen`/`onRename*` props that distinguish SessionNodeItem from any other
	 * component that might receive an object with an `id`.
	 */
	function nodeFromFiber(fiber) {
		var f = fiber;
		var depth = 0;
		while (f !== null && f !== undefined && depth < 48) {
			var mp = f.memoizedProps;
			if (mp !== null && typeof mp === "object" &&
				mp.node !== null && typeof mp.node === "object" &&
				typeof mp.node.id === "string" && typeof mp.node.running === "boolean" &&
				mp.node.title !== undefined &&
				(typeof mp.onOpen === "function" || typeof mp.onRename === "function" ||
					typeof mp.onRenameRequest === "function" ||
					typeof mp.onFork === "function" || typeof mp.onArchive === "function")) {
				return mp.node;
			}
			f = f.return;
			depth++;
		}
		return null;
	}

	/**
	 * Sessions-store lookup by display title (fallback when the fiber walk and
	 * the row's own `node` are both unavailable, e.g. a WebKit browser that
	 * exposes no React internals).
	 */
	function sessionByTitle(title) {
		try {
			var snap = sessionsService && sessionsService.list ? sessionsService.list.getSnapshot() : null;
			if (snap === null || snap === undefined) return null;
			var ids = snap.ids || [];
			var byId = snap.byId || {};
			var matches = [];
			for (var i = 0; i < ids.length; i++) {
				var s = byId[ids[i]];
				if (s !== undefined && s !== null && s.displayTitle === title) matches.push(s);
			}
			if (matches.length === 1) return matches[0];
		} catch (e) {}
		return null;
	}

	function sessionCwd(id) {
		try {
			var snap = sessionsService && sessionsService.list ? sessionsService.list.getSnapshot() : null;
			if (snap !== null && snap !== undefined && snap.byId && snap.byId[id] !== undefined) {
				return snap.byId[id].cwd || "";
			}
		} catch (e) {}
		return "";
	}

	/** Extract the session title from the ⋯ button's aria-label. */
	function parseAnchorTitle(label) {
		if (typeof label !== "string" || label === "") return null;
		var m = label.match(/^会话“(.*)”的操作$/) || label.match(/^Session actions for (.+)$/);
		return m !== null ? m[1] : null;
	}

	/** Resolve the session behind a ⋯ button: fiber first, aria-label second. */
	function captureSessionFromButton(btn) {
		if (btn === null || btn === undefined) return null;
		var node = null;
		try {
			node = nodeFromFiber(fiberOf(btn));
		} catch (err) { node = null; }
		if (node === null) {
			var title = parseAnchorTitle(btn.getAttribute("aria-label"));
			var s = title !== null ? sessionByTitle(title) : null;
			if (s !== null) node = { id: s.id, title: s.displayTitle, running: s.running === true };
		}
		if (node === null) return null;
		return { id: node.id, title: node.title, running: node.running === true, cwd: sessionCwd(node.id) };
	}

	// ── DOM injection into the session-row menu ──────────────────────────────

	/** The built-in session-row verbs, in render order, per locale. */
	var SESSION_MENU_SEQUENCES = [
		["重命名", "分叉会话", "归档会话"],
		["Rename", "Fork session", "Archive session"]
	];

	/** The archive verb, which anchors where the delete entry is inserted. */
	var ARCHIVE_LABELS = ["归档会话", "Archive session"];
	var UNARCHIVE_LABELS = ["取消归档", "Unarchive session"];

	/**
	 * Read the menu item labels of one `div[role=menu]`.
	 *
	 * 0.1.7 renders each action's keyboard shortcut as a separate
	 * `aria-hidden="true"` keycap span INSIDE the menuitem button, so
	 * `button.textContent` yields `"重命名Ctrl+Shift+R"`. Excluding aria-hidden
	 * subtrees yields the localized verb alone; the version tolerance in
	 * {@link matchesSequence} covers a generation that drops that marker.
	 * @param menuEl - the candidate `div[role=menu]`.
	 * @returns one trimmed label per menuitem button, in DOM order.
	 */
	function menuItemLabels(menuEl) {
		var btns = menuEl.querySelectorAll("button[role=menuitem]");
		var out = [];
		for (var i = 0; i < btns.length; i++) {
			var parts = [];
			var kids = btns[i].children || [];
			for (var j = 0; j < kids.length; j++) {
				if (kids[j].getAttribute && kids[j].getAttribute("aria-hidden") === "true") continue;
				parts.push(kids[j].textContent || "");
			}
			// A label that is not wrapped in spans (or a button with no children)
			// still reads correctly from the whole button.
			var text = parts.join("").trim() || (btns[i].textContent || "").trim();
			out.push(text);
		}
		return out;
	}

	/**
	 * Do these labels carry one built-in verb sequence, in order?
	 * Extra entries (the 0.1.7 pin row before it, plugin rows after it) are
	 * allowed; a label may also carry a trailing shortcut keycap.
	 * @param labels - labels from {@link menuItemLabels}.
	 * @returns true when a known sequence appears as an ordered subsequence.
	 */
	function matchesSequence(labels) {
		for (var s = 0; s < SESSION_MENU_SEQUENCES.length; s++) {
			var seq = SESSION_MENU_SEQUENCES[s];
			var at = 0;
			for (var i = 0; i < labels.length && at < seq.length; i++) {
				if (labelIs(labels[i], seq[at])) at++;
			}
			if (at === seq.length) return true;
		}
		return false;
	}

	/** Is this label the given verb, tolerating a trailing shortcut keycap? */
	function labelIs(label, verb) {
		if (label === verb) return true;
		return label.length > verb.length && label.slice(0, verb.length) === verb;
	}

	/**
	 * Does this div[role=menu] carry the built-in session verbs?
	 * @param menuEl - the candidate `div[role=menu]`.
	 * @returns true when the menu is a session-row action menu.
	 */
	function isSessionMenuDom(menuEl) {
		return matchesSequence(menuItemLabels(menuEl));
	}

	/**
	 * Index of the archive row, whose wrapper the delete entry is cloned from
	 * and inserted after. Reading the labels (rather than assuming the archive
	 * row is last) keeps the insert inside the built-in block once 0.1.7 appends
	 * plugin-registered rows behind it.
	 * @param labels - labels from {@link menuItemLabels}.
	 * @returns the archive row's index, or -1.
	 */
	function archiveIndex(labels) {
		for (var i = 0; i < labels.length; i++) {
			for (var a = 0; a < ARCHIVE_LABELS.length; a++) {
				if (labelIs(labels[i], ARCHIVE_LABELS[a])) return i;
			}
		}
		// An archived (not-yet-restored) row shows 取消归档 instead.
		for (var j = 0; j < labels.length; j++) {
			for (var u = 0; u < UNARCHIVE_LABELS.length; u++) {
				if (labelIs(labels[j], UNARCHIVE_LABELS[u])) return j;
			}
		}
		return -1;
	}

	/** Close the upstream menu the same way its own Escape handler does. */
	function closeUpstreamMenu() {
		try {
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		} catch (e) {}
	}

	/**
	 * Append the "move to recycle bin" item to an open session menu by cloning
	 * the archive item wrapper — inherits the exact upstream classes — then
	 * swapping icon + label and tinting it warning amber rather than danger red,
	 * because the action is reversible. Inserted immediately after the archive
	 * row.
	 */
	function injectMenuItem(menuEl) {
		var btns = menuEl.querySelectorAll("button[role=menuitem]");
		var index = archiveIndex(menuItemLabels(menuEl));
		if (index < 0 || index >= btns.length) return;
		var sourceBtn = btns[index];
		var wrap = sourceBtn.parentElement;
		if (wrap === null || wrap.parentElement === null) return;
		var clone = wrap.cloneNode(true);
		clone.setAttribute("data-sd-menu-item", "1");
		var btn = clone.querySelector("button[role=menuitem]");
		if (btn === null) return;

		// Swap icon + label inside the cloned button (first icon span, first
		// text span — ignores trailing decorations like check marks).
		var kids = btn.children || [];
		var iconDone = false, labelDone = false;
		for (var i = 0; i < kids.length; i++) {
			var k = kids[i];
			if (!iconDone && k.querySelector && k.querySelector("svg") !== null) {
				k.innerHTML = ICON;
				iconDone = true;
			} else if (!labelDone && (k.textContent || "").trim() !== "") {
				k.textContent = tr("menu.trashSession");
				labelDone = true;
			}
		}
		// Drop the inherited shortcut keycap (0.1.7 renders
		// `<span aria-hidden="true">` with the archive keys inside the button).
		// Moving to the bin has no binding of its own, and a `Ctrl+Alt+A` keycap
		// on this row would advertise the archive shortcut.
		var keycaps = clone.querySelectorAll('[aria-hidden="true"]');
		for (var c = 0; c < keycaps.length; c++) keycaps[c].remove();

		btn.removeAttribute("aria-haspopup");
		btn.removeAttribute("aria-expanded");
		btn.removeAttribute("aria-keyshortcuts");
		btn.style.color = "var(--dsw-alias-state-warn-primary, #e5a000)";

		var captured = pendingCapture.session;
		btn.title = captured !== null && captured.running ? tr("row.locked") : "";

		btn.addEventListener("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			// Invariant: one action per click, even when a hot reload left an
			// older copy of this module listening on its own clone.
			// stopImmediatePropagation keeps this instance's dialog the only one.
			e.stopImmediatePropagation();
			if (btn.dataset.sdClaim === "1") return;
			btn.dataset.sdClaim = "1";
			closeUpstreamMenu();
			var cap = pendingCapture.session;
			openTrashDialog(cap === null || cap === undefined
				? { locateFail: true }
				: { id: cap.id, title: cap.title, running: cap.running, cwd: cap.cwd });
		});

		// Insert immediately after the archive row: 0.1.7 appends
		// plugin-registered rows (and a separator group) behind the built-in
		// block, so appending to the viewport would strand the delete entry at
		// the very bottom instead of next to its sibling verbs.
		wrap.parentElement.insertBefore(clone, wrap.nextSibling);
	}

	/** Document-level wiring: click capture + menu mount observer. */
	function installSessionMenuInjection() {
		if (typeof document === "undefined" || document.body === null) return function () {};

		function onClickCapture(e) {
			try {
				var el = e.target;
				var btn = el && typeof el.closest === "function" ? el.closest("button") : null;
				if (btn === null || parseAnchorTitle(btn.getAttribute("aria-label")) === null) {
					return; // not a session ⋯ button — keep last capture
				}
				pendingCapture.session = captureSessionFromButton(btn);
			} catch (err) {}
		}

		function sweep() {
			var menus = document.querySelectorAll('div[role="menu"]');
			for (var i = 0; i < menus.length; i++) {
				var menu = menus[i];
				if (menu.querySelector("[data-sd-menu-item]") !== null) continue;
				if (!isSessionMenuDom(menu)) continue;
				try { injectMenuItem(menu); } catch (err) {}
			}
		}

		/** Only sweep when a mutation batch actually added a role=menu element —
		 *  keeps the observer cheap while the conversation view streams. */
		function onMutate(mutations) {
			for (var i = 0; i < mutations.length; i++) {
				var added = mutations[i].addedNodes;
				for (var j = 0; j < added.length; j++) {
					var n = added[j];
					if (n.nodeType !== 1) continue;
					if ((n.tagName === "DIV" && n.getAttribute && n.getAttribute("role") === "menu") ||
						(n.querySelector && n.querySelector('div[role="menu"]') !== null)) {
						sweep();
						return;
					}
				}
			}
		}

		document.addEventListener("click", onClickCapture, true);
		var observer = new MutationObserver(onMutate);
		observer.observe(document.body, { childList: true, subtree: true });

		return function () {
			document.removeEventListener("click", onClickCapture, true);
			observer.disconnect();
			var leftovers = document.querySelectorAll("[data-sd-menu-item]");
			for (var i = 0; i < leftovers.length; i++) leftovers[i].remove();
		};
	}

	// ── standalone confirmation dialog (own React root) ──────────────────────

	var dialogHost = null; // { container, root }

	/**
	 * Exactly one dialog host may exist, no matter how many plugin instances
	 * are live (a hot reload can leave a previous copy of this module running).
	 * Adopt an orphaned host left in the DOM, and drop any duplicates.
	 */
	function ensureDialogHost() {
		var existing = document.querySelectorAll(".sd-dlg-host");
		for (var i = 1; i < existing.length; i++) existing[i].remove();
		if (dialogHost !== null && dialogHost.container.isConnected) return dialogHost;
		var container = existing.length > 0 ? existing[0] : document.createElement("div");
		if (existing.length === 0) {
			container.className = "sd-dlg-host";
			document.body.appendChild(container);
		}
		var root = ReactDOMClient.createRoot(container);
		dialogHost = { container: container, root: root };
		return dialogHost;
	}

	function openTrashDialog(target) {
		var host = ensureDialogHost();
		host.root.render(React.createElement(TrashConfirmDialog, {
			target: target,
			policy: binPolicyText(),
			onClose: function () {
				if (dialogHost === null) return;
				dialogHost.root.render(null);
			}
		}));
	}

	// ── standalone success toast (own React root) ────────────────────────────
	//
	// The completed move is the one outcome that needs no further decision from
	// the user, so it reports as a non-blocking banner instead of a modal that
	// costs a click. Shape follows the shell's own toast primitive (which the
	// plugin cannot reach): portal to the body, top-center, role=alert, one
	// actionable link, hold then fade, then unmount.

	var toastHost = null; // { container, root }
	var toastSeq = 0;
	/** Full-opacity hold before the fade starts; matches the host's actionable toasts. */
	var TOAST_HOLD_MS = 6000;
	/** Fade duration; must agree with the stylesheet's sd-toast-out duration. */
	var TOAST_FADE_MS = 800;

	/** Exactly one toast host, with the dialog host's orphan-adoption rules. */
	function ensureToastHost() {
		var existing = document.querySelectorAll(".sd-toast-host");
		for (var i = 1; i < existing.length; i++) existing[i].remove();
		if (toastHost !== null && toastHost.container.isConnected) return toastHost;
		var container = existing.length > 0 ? existing[0] : document.createElement("div");
		if (existing.length === 0) {
			container.className = "sd-toast-host";
			document.body.appendChild(container);
		}
		var root = ReactDOMClient.createRoot(container);
		toastHost = { container: container, root: root };
		return toastHost;
	}

	function dismissToast() {
		if (toastHost !== null) toastHost.root.render(null);
	}

	/**
	 * The banner itself. Keyed by a per-show sequence: re-showing remounts with
	 * a new key, which restarts both the entrance and the timers — the same
	 * contract the shell's primitive documents. Unmount happens after
	 * hold + fade; the stylesheet reads the hold as a custom property, so the
	 * two can no longer disagree and cut the banner down mid-fade.
	 */
	function ToastBanner(props) {
		React.useEffect(function () {
			var timer = setTimeout(dismissToast, TOAST_HOLD_MS + TOAST_FADE_MS);
			return function () { clearTimeout(timer); };
		}, [props.seq]);
		var children = [
			React.createElement("span", {
				key: "i", className: "sd-toast-icon", "aria-hidden": "true",
				dangerouslySetInnerHTML: { __html: OK_ICON }
			}),
			React.createElement("span", { key: "t", className: "sd-toast-text" }, props.text)
		];
		if (props.action) {
			children.push(React.createElement("button", {
				key: "a", type: "button", className: "sd-toast-action",
				onClick: function () { dismissToast(); props.action.onClick(); }
			}, props.action.label));
		}
		return React.createElement("div", {
			key: props.seq, className: "sd-toast", role: "alert",
			style: { "--sd-toast-hold": TOAST_HOLD_MS + "ms" }
		}, children);
	}

	/**
	 * Report a completed action in the top-center banner.
	 * @param text - the message to show.
	 * @param action - optional inline action (label plus handler).
	 */
	function showToast(text, action) {
		if (typeof document === "undefined" || document.body === null) return;
		if (typeof ReactDOMClient === "undefined" || ReactDOMClient === null) return;
		var host = ensureToastHost();
		toastSeq += 1;
		host.root.render(React.createElement(ToastBanner, {
			seq: toastSeq,
			text: text,
			action: action
		}));
	}

	/**
	 * Report a completed move-to-bin. The banner is the whole report: which
	 * session moved and one shortcut into the bin (the same next step the old
	 * success dialog offered, minus the mandatory click).
	 * @param name - display name of the session that moved.
	 */
	function showTrashToast(name) {
		showToast(tr("dialog.trash.done", { name: name }), {
			label: tr("dialog.trash.openBin"), onClick: openTrashPanel
		});
	}

	// ── sidebar entry ────────────────────────────────────────────────────────
	//
	// Upstream's workspace header is one `single` slot occupied by the whole
	// browsing region, so there is no seat to register into: the only way to add
	// a fourth icon beside search / view options / add workspace is to place it
	// in the DOM. `.headerActions` caps at exactly the two shipped icons
	// (`max-width:60px; overflow:hidden`), so the cluster's cap is lifted while
	// the entry is mounted and restored on teardown.

	/** Is this element actually rendered (a wide rail can carry a hidden twin)? */
	function isVisibleElement(element) {
		return typeof element.getClientRects === "function" && element.getClientRects().length > 0;
	}

	/** Describe every candidate anchor in priority order; no DOM choice happens here. */
	function collectTrashAnchorCandidates(buttons) {
		var out = [];
		for (var a = 0; a < TRASH_ANCHOR_LABELS.length; a++) {
			for (var b = 0; b < buttons.length; b++) {
				var button = buttons[b];
				var label = button.getAttribute === undefined ? null : button.getAttribute("aria-label");
				if (TRASH_ANCHOR_LABELS[a].indexOf(label) === -1) continue;
				out.push({
					index: b,
					label: label,
					visible: isVisibleElement(button),
					inMenu: typeof button.closest === "function" && button.closest('[role="menu"]') !== null
				});
			}
		}
		return out;
	}

	/** The first acceptable anchor index, or -1. Pure; pinned by the unit tests. */
	function pickTrashAnchor(candidates) {
		for (var i = 0; i < candidates.length; i++) {
			if (candidates[i].visible === true && candidates[i].inMenu !== true) return candidates[i].index;
		}
		return -1;
	}

	/** The injected sidebar button; reuses the anchor's own classes for parity. */
	function TrashEntryButton(props) {
		var state = useStore(binStore);
		var count = Array.isArray(state.entries) ? state.entries.length : 0;
		var label = count > 0 ? tr("sidebar.trashWithCount", { n: count }) : tr("sidebar.trash");
		var Tooltip = primitive("Tooltip");
		var Icon = primitive("IconTrashOutlineRegular");
		var attributes = {
			type: "button",
			className: props.className || "sd-bin-iconbtn",
			"aria-label": tr("sidebar.trash"),
			"aria-haspopup": "dialog",
			onClick: function (e) {
				e.preventDefault();
				e.stopPropagation();
				openTrashPanel();
			}
		};
		// The upstream Tooltip is only reachable through React; when it is not
		// available the native title attribute still names the button.
		if (Tooltip === null) attributes.title = label;
		var icon = Icon === null
			? React.createElement("span", { className: "sd-icon", dangerouslySetInnerHTML: { __html: ICON } })
			: React.createElement(Icon, { size: props.size });
		var button = React.createElement("button", attributes, icon);
		if (Tooltip === null) return button;
		return React.createElement(Tooltip, { label: label, side: "bottom", delayMs: 500 }, button);
	}

	/** Mount the sidebar entry at its anchor; self-healing and idempotent. */
	function installSidebarTrashEntry() {
		if (typeof document === "undefined" || document.body === null) return function () {};
		var mounted = null;
		var observer = null;
		var scheduled = false;

		function unmount() {
			if (mounted === null) return;
			try { mounted.root.unmount(); } catch (e) {}
			if (mounted.container.parentElement !== null) {
				mounted.container.parentElement.removeChild(mounted.container);
			}
			if (mounted.cluster !== null) mounted.cluster.style.maxWidth = mounted.previousMaxWidth;
			mounted = null;
		}

		function sweep() {
			// Cheap path first: the common case is "nothing changed".
			if (mounted !== null && mounted.anchor.isConnected === true &&
				mounted.container.isConnected === true) {
				return;
			}
			try {
				var buttons = document.querySelectorAll("button[aria-label]");
				var picked = pickTrashAnchor(collectTrashAnchorCandidates(buttons));
				if (picked < 0) {
					entryInjected = false;
					unmount();
					return;
				}
				var anchor = buttons[picked];
				var cluster = anchor.parentElement;
				if (cluster === null) return;
				unmount();
				var container = document.createElement("span");
				container.className = "sd-trash-entry";
				container.setAttribute("data-sd-trash-slot", "1");
				anchor.insertAdjacentElement("afterend", container);
				var previousMaxWidth = cluster.style.maxWidth;
				cluster.style.maxWidth = "none";
				// Match the shipped icon's size (16 wide, 18 in the collapsed rail).
				var size = 16;
				var svg = typeof anchor.querySelector === "function" ? anchor.querySelector("svg") : null;
				if (svg !== null && typeof svg.getAttribute === "function") {
					var width = parseInt(svg.getAttribute("width") || "", 10);
					if (width === 16 || width === 18) size = width;
				}
				var root = ReactDOMClient.createRoot(container);
				root.render(React.createElement(TrashEntryButton, {
					className: anchor.className,
					size: size
				}));
				mounted = {
					anchor: anchor,
					cluster: cluster,
					container: container,
					root: root,
					previousMaxWidth: previousMaxWidth
				};
				entryInjected = true;
			} catch (e) {
				entryInjected = false;
			}
		}

		/** Coalesce the app's mutation storm into at most one check per 200 ms. */
		function schedule() {
			if (scheduled) return;
			scheduled = true;
			setTimeout(function () {
				scheduled = false;
				sweep();
			}, 200);
		}

		sweep();
		observer = new MutationObserver(schedule);
		observer.observe(document.body, { childList: true, subtree: true });
		void refreshBin();

		return function () {
			if (observer !== null) observer.disconnect();
			unmount();
		};
	}

	// ── recycle-bin panel (own React root; Modal primitive when available) ───

	var trashPanelHost = null; // { container, root }

	/**
	 * Exactly one panel host may exist, no matter how many plugin instances are
	 * live (a hot reload can leave a previous copy of this module running).
	 */
	function ensureTrashPanelRoot() {
		var existing = document.querySelectorAll(".sd-bin-host");
		for (var i = 1; i < existing.length; i++) existing[i].remove();
		if (trashPanelHost !== null && trashPanelHost.container.isConnected === true) return trashPanelHost;
		var container = existing.length > 0 ? existing[0] : document.createElement("div");
		if (existing.length === 0) {
			container.className = "sd-bin-host";
			document.body.appendChild(container);
		}
		var root = ReactDOMClient.createRoot(container);
		trashPanelHost = { container: container, root: root };
		return trashPanelHost;
	}

	function installTrashPanelMount() {
		if (typeof document === "undefined" || document.body === null) return function () {};
		var host = ensureTrashPanelRoot();
		host.root.render(React.createElement(TrashPanelHost, null));
		void refreshBin();
		return function () { disposeTrashPanelRoot(); };
	}

	function disposeTrashPanelRoot() {
		if (trashPanelHost !== null) {
			try { trashPanelHost.root.unmount(); } catch (e) {}
			trashPanelHost.container.remove();
			trashPanelHost = null;
		}
		var leftovers = document.querySelectorAll(".sd-bin-host");
		for (var i = 0; i < leftovers.length; i++) leftovers[i].remove();
	}

	/** Is this entry already past its retention window (so a sweep will take it)? */
	function isExpiringEntry(entry) {
		var settings = binStore.get().settings;
		if (settings === null || settings === undefined || settings.autoClean !== true) return false;
		var days = settings.retentionDays;
		if (!(days > 0)) return false;
		var at = Date.parse(entry.deletedAt);
		return isFinite(at) && (Date.now() - at) >= days * 86400000;
	}

	function renderBinRow(entry, state) {
		var meta = [tr("bin.deletedAt", { when: formatRelativeTime(entry.deletedAt) })];
		if (typeof entry.cwd === "string" && entry.cwd !== "") meta.push(baseName(entry.cwd));
		if (typeof entry.sizeBytes === "number" && entry.sizeBytes > 0) {
			meta.push(formatBytes(entry.sizeBytes));
		}
		meta.push(shortSessionId(entry.id));
		var parts = [
			React.createElement("div", { key: "title", className: "sd-bin-row-title" }, displayTitle(entry)),
			React.createElement("div", { key: "meta", className: "sd-bin-row-meta" },
				meta.map(function (text, index) {
					return React.createElement("span", { key: String(index) }, text);
				}))
		];
		if (isExpiringEntry(entry)) {
			parts.push(React.createElement("div", { key: "expiring", className: "sd-bin-row-warn" }, tr("bin.expiring")));
		}
		var rowError = state.rowErrors === undefined ? undefined : state.rowErrors[entry.id];
		if (typeof rowError === "string" && rowError !== "") {
			parts.push(React.createElement("div", { key: "error", className: "sd-bin-row-err" }, rowError));
		}
		var actions;
		if (state.busyId === entry.id) {
			actions = React.createElement("span", { className: "sd-bin-row-meta" }, tr("row.working"));
		} else {
			actions = [
				React.createElement("button", {
					key: "restore", type: "button", className: "sd-dlg-btn",
					onClick: function () { void restoreBinEntry(entry); }
				}, tr("bin.restore")),
				React.createElement("button", {
					key: "purge", type: "button", className: "sd-dlg-btn sd-dlg-btn-danger",
					onClick: function () { requestBinPurge(entry); }
				}, tr("bin.purge"))
			];
		}
		return React.createElement("div", { key: entry.id, className: "sd-bin-row" }, [
			React.createElement("div", { key: "main", className: "sd-bin-row-main" }, parts),
			React.createElement("div", { key: "actions", className: "sd-bin-row-actions" }, actions)
		]);
	}

	function renderBinConfirm(confirm) {
		var text = confirm.kind === "purge"
			? tr("bin.confirmPurge", { name: confirm.name })
			: tr("bin.confirmEmpty", { n: confirm.count, size: confirm.size });
		var children = [React.createElement("div", { key: "text", className: "sd-bin-confirm-text" }, text)];
		if (typeof confirm.error === "string" && confirm.error !== "") {
			children.push(React.createElement("div", { key: "error", className: "sd-bin-row-err" }, confirm.error));
		}
		children.push(React.createElement("button", {
			key: "no", type: "button", className: "sd-dlg-btn",
			disabled: confirm.busy === true, onClick: cancelBinConfirm
		}, tr("bin.cancel")));
		children.push(React.createElement("button", {
			key: "yes", type: "button", className: "sd-dlg-btn sd-dlg-btn-danger",
			disabled: confirm.busy === true, onClick: confirmBinAction
		}, confirm.busy === true ? tr("row.working") : tr("bin.confirm")));
		return React.createElement("div", { key: "confirm", className: "sd-bin-confirm" }, children);
	}

	function renderBinFooter(state, count) {
		var left = [React.createElement("span", { key: "stats" },
			tr("bin.footer", { n: count, size: formatBytes(state.totalBytes) }))];
		var policy = binPolicyText();
		if (policy !== null) {
			// The policy is a way into its own settings page, not just text.
			left.push(React.createElement("span", { key: "sep" }, " · "));
			left.push(React.createElement("button", {
				key: "policy", type: "button", className: "sd-bin-policy-btn",
				title: tr("settings.section"), onClick: openSettingsFromBin
			}, [
				policy,
				React.createElement("span", {
					key: "chevron", className: "sd-bin-policy-chevron", "aria-hidden": "true"
				}, "›")
			]));
		}
		var actions = [];
		if (count > 0) {
			actions.push(React.createElement("button", {
				key: "empty", type: "button", className: "sd-bin-link", onClick: requestBinEmpty
			}, tr("bin.emptyAll")));
		}
		return React.createElement("div", { key: "footer", className: "sd-bin-footer" }, [
			React.createElement("span", { key: "left", className: "sd-bin-footer-left" }, left),
			React.createElement("div", { key: "right", className: "sd-bin-footer-actions" }, actions)
		]);
	}

	/** The panel's contents: loading/empty/list, notices, confirm strip, footer. */
	function TrashPanelBody(props) {
		var state = props.state;
		var entries = Array.isArray(state.entries) ? state.entries : [];
		var visible = entries.slice(0, state.visible);
		var children = [];
		if (state.phase === "loading" && entries.length === 0) {
			children.push(React.createElement("div", { key: "loading", className: "sd-bin-status" }, tr("bin.loading")));
		} else if (state.phase === "failed" && entries.length === 0) {
			children.push(React.createElement("div", { key: "failed", className: "sd-bin-status" }, [
				React.createElement("span", { key: "text" }, tr("bin.loadFailed") + " "),
				React.createElement("button", {
					key: "retry", type: "button", className: "sd-bin-link",
					onClick: function () { void refreshBin(); }
				}, tr("bin.retry"))
			]));
		} else if (entries.length === 0) {
			children.push(React.createElement("div", { key: "empty", className: "sd-bin-empty" }, [
				React.createElement("div", { key: "title" }, tr("bin.empty.title")),
				React.createElement("div", { key: "hint", className: "sd-bin-empty-hint" }, tr("bin.empty.hint"))
			]));
		} else {
			children.push(React.createElement("div", { key: "list", className: "sd-bin-list" },
				visible.map(function (entry) { return renderBinRow(entry, state); })));
			if (entries.length > visible.length) {
				children.push(React.createElement("button", {
					key: "more", type: "button", className: "sd-bin-more",
					onClick: function () { binStore.set({ visible: binStore.get().visible + BIN_PAGE_SIZE }); }
				}, tr("bin.loadMore")));
			}
		}
		if (typeof state.notice === "string" && state.notice !== "") {
			children.push(React.createElement("div", { key: "notice", className: "sd-bin-notice" }, state.notice));
		}
		if (typeof state.error === "string" && state.error !== "") {
			children.push(React.createElement("div", { key: "error", className: "sd-bin-error" }, state.error));
		}
		if (state.confirm !== null) children.push(renderBinConfirm(state.confirm));
		children.push(renderBinFooter(state, entries.length));
		// Wrapper matters: every rule above assumes the body is a flex column
		// (`.sd-bin-body`), which is what makes the list scroll and keeps the
		// confirm strip and footer pinned below it.
		return React.createElement("div", { className: "sd-bin-body" }, children);
	}

	/**
	 * The mounted panel. With the Modal primitive the shell owns the card, the
	 * mask, the focus layer and Escape; without it the plugin draws the same
	 * surface with its own classes.
	 */
	function TrashPanelHost() {
		var state = useStore(binStore);
		var Modal = primitive("Modal");
		React.useEffect(function () {
			if (Modal !== null || state.open !== true) return function () {};
			function onKey(e) { if (e.key === "Escape") closeTrashPanel(); }
			document.addEventListener("keydown", onKey);
			return function () { document.removeEventListener("keydown", onKey); };
		}, [state.open, Modal]);
		if (state.open !== true) return null;
		var body = React.createElement(TrashPanelBody, { state: state });
		if (Modal !== null) {
			return React.createElement(Modal, {
				open: true,
				onClose: closeTrashPanel,
				title: tr("bin.title"),
				closeLabel: tr("bin.close"),
				// The shell caps a modal card at 380px; this list needs the room.
				className: "sd-bin-modal"
			}, body);
		}
		return React.createElement("div", { className: "sd-bin-root" }, [
			React.createElement("div", {
				key: "mask", className: "sd-bin-mask",
				onClick: closeTrashPanel
			}),
			React.createElement("div", {
				key: "card", className: "sd-bin-card", role: "dialog",
				"aria-modal": "true", "aria-label": tr("bin.title")
			}, [
				React.createElement("div", { key: "head", className: "sd-bin-head" }, [
					React.createElement("span", {
						key: "icon", className: "sd-icon",
						dangerouslySetInnerHTML: { __html: ICON }
					}),
					React.createElement("span", { key: "title" }, tr("bin.title")),
					React.createElement("span", {
						key: "count", className: "sd-bin-head-count"
					}, tr("bin.count", { n: state.entries.length })),
					React.createElement("button", {
						key: "close", type: "button", className: "sd-bin-head-close",
						"aria-label": tr("bin.close"), onClick: closeTrashPanel
					}, "✕")
				]),
				body
			])
		]);
	}

	function disposeDialogHost() {
		if (dialogHost !== null) {
			try { dialogHost.root.unmount(); } catch (e) {}
			dialogHost.container.remove();
			dialogHost = null;
		}
		// Never leave a host behind for a successor instance to re-render into.
		var leftovers = document.querySelectorAll(".sd-dlg-host");
		for (var i = 0; i < leftovers.length; i++) leftovers[i].remove();
	}

	// ── settings page ────────────────────────────────────────────────────────
	//
	// One page in the shell's Settings panel (`settings.section`). The shell owns
	// the panel, the nav and the scrolling; the page owns its controls and talks
	// to the plugin's own host route. Controls come from the UI primitives when
	// the shell ships them, and from the plugin's own markup otherwise.

	/** A two-state switch: the primitive when present, else the same semantics. */
	function SwitchControl(props) {
		var Switch = primitive("Switch");
		if (Switch !== null) {
			return React.createElement(Switch, {
				checked: props.checked === true,
				onChange: props.onChange,
				label: props.label,
				disabled: props.disabled === true,
				title: props.title
			});
		}
		return React.createElement("button", {
			type: "button",
			role: "switch",
			"aria-checked": props.checked === true,
			"aria-label": props.label,
			title: props.title,
			disabled: props.disabled === true,
			className: "sd-set-switch",
			onClick: function () { props.onChange(props.checked !== true); }
		}, React.createElement("span", null));
	}

	/** The retention picker: the segmented primitive when present, else buttons. */
	function RetentionControl(props) {
		var Segmented = primitive("SegmentedControl");
		if (Segmented !== null) {
			return React.createElement(Segmented, {
				id: "session-purge-retention",
				value: String(props.value),
				options: retentionOptions(),
				onChange: function (next) { props.onChange(Number(next)); },
				label: tr("settings.retention"),
				disabled: props.disabled === true
			});
		}
		var options = retentionOptions();
		return React.createElement("div", {
			className: "sd-set-segment", role: "group", "aria-label": tr("settings.retention")
		}, options.map(function (option) {
			var active = option.value === String(props.value);
			return React.createElement("button", {
				key: option.value,
				type: "button",
				className: "sd-set-segment-btn",
				"aria-pressed": active,
				disabled: props.disabled === true,
				onClick: function () { if (!active) props.onChange(Number(option.value)); }
			}, option.label);
		}));
	}

	/** The sweep interval: a number input that validates on commit. */
	function IntervalControl(props) {
		var Input = primitive("Input");
		var commit = function (element) {
			var next = Number(element.value);
			if (Number.isInteger(next) && next >= SWEEP_INTERVAL_MIN && next <= SWEEP_INTERVAL_MAX) {
				if (next !== props.value) props.onChange(next);
				return;
			}
			// An illegal value snaps back to what the host actually stored.
			element.value = String(props.value);
		};
		var attributes = {
			key: String(props.value),
			type: "number",
			min: SWEEP_INTERVAL_MIN,
			max: SWEEP_INTERVAL_MAX,
			step: 1,
			defaultValue: props.value,
			disabled: props.disabled === true,
			"aria-label": tr("settings.sweepInterval"),
			onBlur: function (event) { commit(event.currentTarget); },
			onKeyDown: function (event) {
				if (event.key === "Enter") commit(event.currentTarget);
			}
		};
		if (Input !== null) return React.createElement(Input, attributes);
		attributes.className = "sd-set-number";
		return React.createElement("input", attributes);
	}

	/** One settings row: label + hint on the left, the control on the right. */
	function settingsRow(key, label, hint, control) {
		return React.createElement("div", { key: key, className: "sd-set-row" }, [
			React.createElement("div", { key: "main", className: "sd-set-row-main" }, [
				React.createElement("div", { key: "label", className: "sd-set-label" }, label),
				hint === null ? null : React.createElement("div", { key: "hint", className: "sd-set-hint" }, hint)
			]),
			React.createElement("div", { key: "control", className: "sd-set-control" }, control)
		]);
	}

	/** The settings page itself. */
	function SettingsSection(props) {
		var state = useStore(settingsStore);
		var close = props !== null && props !== undefined && typeof props.close === "function"
			? props.close
			: null;
		React.useEffect(function () {
			// A version may already be known from the bin load; start the update
			// check now, and again after the settings read in case only it answered.
			maybeCheckForUpdate();
			void refreshSettings().then(function () { maybeCheckForUpdate(); });
		}, []);

		var settings = state.settings;
		var ready = state.phase === "ready" && settings !== null && settings !== undefined;
		var saving = state.saving;
		var busy = saving !== null;
		var autoClean = ready && settings.autoClean === true;
		var keepForever = ready && !(settings.retentionDays > 0);
		var children = [];

		if (state.phase === "loading" || (state.phase === "idle" && !ready)) {
			children.push(React.createElement("div", { key: "loading", className: "sd-set-stats" }, tr("bin.loading")));
		} else if (state.phase === "failed" && !ready) {
			children.push(React.createElement("div", { key: "failed", className: "sd-set-stats" }, [
				React.createElement("span", { key: "text" }, tr("settings.unavailable") + " "),
				React.createElement("button", {
					key: "retry", type: "button", className: "sd-bin-link",
					onClick: function () { void refreshSettings(); }
				}, tr("bin.retry"))
			]));
		} else if (ready) {
			children.push(React.createElement("div", { key: "stats", className: "sd-set-stats" },
				tr("settings.stats", {
					n: state.stats === null || state.stats === undefined ? 0 : state.stats.count,
					size: formatBytes(state.stats === null || state.stats === undefined ? 0 : state.stats.totalBytes),
					when: lastSweepText(state.stats)
				})));

			children.push(settingsRow("autoClean",
				tr("settings.autoClean"), tr("settings.autoCleanHint"),
				React.createElement(SwitchControl, {
					checked: autoClean,
					disabled: busy,
					label: tr("settings.autoClean"),
					onChange: function (next) { void saveSetting("autoClean", next); }
				})));

			children.push(settingsRow("retention",
				tr("settings.retention"), tr("settings.retentionHint"),
				React.createElement(RetentionControl, {
					value: settings.retentionDays,
					disabled: busy,
					onChange: function (next) { void saveSetting("retentionDays", next); }
				})));

			children.push(settingsRow("sweepOnBoot",
				tr("settings.sweepOnBoot"), tr("settings.sweepOnBootHint"),
				React.createElement(SwitchControl, {
					checked: ready && settings.sweepOnBoot === true,
					// Both schedule controls only mean something while auto-clean
					// is on, so they lock together with it.
					disabled: busy || !autoClean,
					title: autoClean ? undefined : tr("settings.autoCleanHint"),
					label: tr("settings.sweepOnBoot"),
					onChange: function (next) { void saveSetting("sweepOnBoot", next); }
				})));

			children.push(settingsRow("interval",
				tr("settings.sweepInterval"), tr("settings.sweepIntervalHint"),
				React.createElement(IntervalControl, {
					value: settings.sweepIntervalHours,
					disabled: busy || !autoClean,
					onChange: function (next) { void saveSetting("sweepIntervalHours", next); }
				})));

			var actions = [
				React.createElement("button", {
					key: "sweep", type: "button", className: "sd-dlg-btn",
					disabled: busy || !autoClean || keepForever,
					onClick: function () { void runSweepNow(); }
				}, saving === "sweep" ? tr("row.working") : tr("settings.sweepNow")),
				React.createElement("button", {
					key: "bin", type: "button", className: "sd-dlg-btn sd-dlg-btn-primary",
					onClick: function () {
						if (close !== null) close();
						openTrashPanel();
					}
				}, tr("settings.openBin"))
			];
			children.push(React.createElement("div", { key: "actions", className: "sd-set-actions" }, actions));
		}

		if (typeof state.notice === "string" && state.notice !== "") {
			children.push(React.createElement("div", { key: "notice", className: "sd-set-notice" }, state.notice));
		}
		if (typeof state.error === "string" && state.error !== "") {
			children.push(React.createElement("div", { key: "error", className: "sd-set-error" }, state.error));
		}

		// The footer closes the page with the host's own version. The update line
		// only appears when the (best-effort) npm check produced a comparable
		// answer: an offline page shows the version alone rather than a warning.
		var version = state.version;
		if (typeof version === "string" && version !== "") {
			var about = [
				React.createElement("div", { key: "version", className: "sd-set-version" },
					tr("settings.version", { version: version }))
			];
			var update = state.update;
			if (update !== null && update.newer === true) {
				about.push(React.createElement("div", { key: "update", className: "sd-set-update" },
					React.createElement("a", {
						className: "sd-set-link",
						href: NPM_PACKAGE_URL,
						target: "_blank",
						rel: "noreferrer",
						title: tr("settings.viewOnNpm")
					}, tr("settings.updateAvailable", { version: update.latest }))));
			} else if (update !== null && update.same === true) {
				about.push(React.createElement("div", { key: "update", className: "sd-set-update" },
					tr("settings.upToDate")));
			}
			children.push(React.createElement("div", { key: "about", className: "sd-set-about" }, about));
		}

		return React.createElement("div", { className: "sd-set" }, [
			React.createElement("div", { key: "heading", className: "sd-set-heading" }, tr("settings.section"))
		].concat(children));
	}

	/**
	 * Register the page with the shell's settings domain.
	 *
	 * `slots` is resolved through an optional injection (never the module's own
	 * `inject` list): the gate is hard, and a shell without the settings domain
	 * must leave the rest of the plugin alone. `slots.inject` also waits for the
	 * declaration, so registration order cannot matter.
	 */
	function installSettingsSection(ctx) {
		if (ctxRef === null || typeof ctxRef.inject !== "function") return;
		ctxRef.inject(["slots"], function (scope) {
			if (scope === undefined || scope === null || scope.slots === undefined) return;
			try {
				scope.slots.inject("settings.section", function () {
					return scope.slots.register({
						name: "settings.section",
						id: "session-purge",
						// Built-ins run -10..20 and the community convention is 40, so
						// the page lands after the shipped ones.
						order: 50,
						// A thunk: the shell re-reads it on every locale revision, so a
						// language switch relabels the nav row without re-registering.
						label: function () { return tr("settings.section"); }
					}, SettingsSection);
				});
			} catch (e) {
				// A shell without the settings domain: the host route stays the only
				// way in, and nothing else degrades.
			}
		});
	}

	/**
	 * Mark the plugin's settings nav row, so the stylesheet can swap the shell's
	 * fallback gear for the bin glyph (see the icon comment near `ICON`).
	 *
	 * The row is found by its localized label inside a `<nav>`, which is the one
	 * identifying detail the slot contract exposes to the DOM; the marker is an
	 * attribute (not a node) so React keeps ownership of every child it renders.
	 */
	function markSettingsNavIcon() {
		if (typeof document === "undefined") return;
		var label = tr("settings.section");
		var buttons = document.querySelectorAll("[role=\"dialog\"] nav button");
		for (var i = 0; i < buttons.length; i++) {
			var button = buttons[i];
			var text = typeof button.textContent === "string" ? button.textContent.trim() : "";
			// Marking is one-way: a locale switch may update the label's text
			// without a childList mutation, and removing/re-adding the marker on
			// a transient mismatch would leave the gear on screen. Rows are keyed
			// by section id, so this button is never recycled for another page.
			if (text === label) button.setAttribute(SETTINGS_NAV_ATTR, "trash");
		}
	}

	/** Re-mark the row whenever the settings panel (re)mounts; idempotent. */
	function installSettingsNavIcon() {
		if (typeof document === "undefined" || document.body === null) return function () {};
		var scheduled = false;
		function schedule() {
			if (scheduled) return;
			scheduled = true;
			setTimeout(function () {
				scheduled = false;
				markSettingsNavIcon();
			}, 150);
		}
		markSettingsNavIcon();
		var observer = new MutationObserver(schedule);
		// childList only: the label's text is stable while the row is mounted, and
		// observing characterData would fire for every streamed token in the app.
		observer.observe(document.body, { childList: true, subtree: true });
		return function () { observer.disconnect(); };
	}

	/**
	 * Pure decision for what the confirm dialog does with a /trash response,
	 * split out so the regression suite can pin the contract without a DOM:
	 * a completed move leaves the dialog entirely (the toast takes over), a
	 * queued move and every failure keep it open.
	 * @param res - parsed response body, or null when parsing failed.
	 * @param target - the captured session the dialog was opened for.
	 * @returns `{kind:"queued"}`, `{kind:"trashed", name}` or `{kind:"error", code}`.
	 */
	function trashOutcome(res, target) {
		if (res !== null && res !== undefined && res.ok === true) {
			if (res.mode === "queued") return { kind: "queued" };
			// Remember only the outcome: which session moved and that it worked.
			// The host's name is a fallback for the DOM-capture path, which can
			// only ever produce an id.
			var name = target.title ||
				(typeof res.name === "string" && res.name !== "" ? res.name : null) ||
				target.id;
			return { kind: "trashed", name: name };
		}
		var code = res && typeof res.code === "string" ? res.code : "fallback";
		return { kind: "error", code: code };
	}

	/**
	 * Two-step confirmation shown when the menu's move-to-bin item is chosen.
	 *
	 * The action is reversible, so the confirming button is neutral (not danger
	 * red). A completed move closes the dialog and reports through the toast —
	 * success needs no further decision, and demanding a click to acknowledge
	 * it would be a second confirmation. Every other terminal state (nothing
	 * located, queued for a restart, an error) stays in the dialog: those still
	 * describe an operation the user should treat with the same care as the
	 * confirmation, and a banner that fades away in seconds cannot carry them.
	 */
	function TrashConfirmDialog(props) {
		var target = (props && props.target) || {};
		var onClose = props && typeof props.onClose === "function" ? props.onClose : function () {};
		var policy = props && typeof props.policy === "string" ? props.policy : null;
		var busyState = React.useState(false);
		var busy = busyState[0];
		var setBusy = busyState[1];
		var errState = React.useState(null);
		var err = errState[0];
		var setErr = errState[1];
		var queuedState = React.useState(false);
		var queued = queuedState[0];
		var setQueued = queuedState[1];

		React.useEffect(function () {
			function onKey(e) { if (e.key === "Escape" && !busy) onClose(); }
			document.addEventListener("keydown", onKey);
			return function () { document.removeEventListener("keydown", onKey); };
		}, [busy, onClose]);

		var locateFail = target.locateFail === true;
		var running = target.running === true;

		function onConfirm() {
			setBusy(true);
			setErr(null);
			fetch("/session-purge/trash", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ sessionId: target.id, title: target.title }),
				cache: "no-store"
			}).then(function (res) {
				return res.json().catch(function () { return null; });
			}).then(function (res) {
				setBusy(false);
				var outcome = trashOutcome(res, target);
				if (outcome.kind === "queued") { setQueued(true); return; }
				if (outcome.kind === "trashed") {
					// Close first: the banner replaces the dialog, it does not
					// stack on top of it. The row must leave the list, and the
					// bin's own count/tooltip must follow — both are
					// re-baselined from the host.
					onClose();
					showTrashToast(outcome.name);
					refreshSessions();
					void refreshBin();
					return;
				}
				setErr(tr("error." + outcome.code));
			}, function (e) {
				setBusy(false);
				setErr(String(e && e.message ? e.message : e));
			});
		}

		var name = target.title || target.id;
		var body = [];
		if (locateFail) {
			body.push(React.createElement("div", { key: "t", className: "sd-dlg-text" }, tr("dialog.locateFail")));
		} else {
			body.push(React.createElement("div", { key: "t", className: "sd-dlg-text" }, tr("dialog.trash.target", { name: name })));
			if (target.cwd) {
				body.push(React.createElement("div", { key: "c", className: "sd-dlg-cwd" }, tr("dialog.cwd", { cwd: baseName(target.cwd) || target.cwd })));
			}
			if (running) {
				body.push(React.createElement("div", { key: "r", className: "sd-dlg-note sd-dlg-note-warn" }, tr("row.locked")));
			}
			// The retention policy is the answer to "how long do I have?"; it is
			// omitted entirely while the host's settings are still unknown.
			if (policy !== null && !queued) {
				body.push(React.createElement("div", { key: "p", className: "sd-dlg-note" }, policy));
			}
			if (queued) {
				body.push(React.createElement("div", { key: "q", className: "sd-dlg-note" }, tr("dialog.trash.queued")));
			}
		}
		if (err !== null) {
			body.push(React.createElement("div", { key: "e", className: "sd-dlg-err" }, err));
		}

		var actions = [];
		if (queued || locateFail) {
			actions.push(React.createElement("button", {
				key: "ok", type: "button", className: "sd-dlg-btn sd-dlg-btn-warn",
				onClick: onClose
			}, tr("bin.close")));
		} else {
			actions.push(React.createElement("button", {
				key: "no", type: "button", className: "sd-dlg-btn", onClick: onClose, disabled: busy
			}, tr("row.cancel")));
			actions.push(React.createElement("button", {
				key: "yes", type: "button", className: "sd-dlg-btn sd-dlg-btn-primary",
				onClick: onConfirm, disabled: busy || running
			}, busy ? tr("row.working") : tr("row.trash")));
		}

		return React.createElement("div", null, [
			React.createElement("div", { key: "b", className: "sd-dlg-backdrop", onClick: function () { if (!busy) onClose(); } }),
			React.createElement("div", {
				key: "d",
				className: "sd-dlg",
				role: "alertdialog",
				"aria-label": tr("dialog.trash.title")
			}, [
				React.createElement("div", { key: "t", className: "sd-dlg-title" }, [
					React.createElement("span", {
						key: "i", className: "sd-icon",
						dangerouslySetInnerHTML: { __html: ICON }
					}),
					React.createElement("span", { key: "l" }, tr("dialog.trash.title"))
				]),
				body,
				React.createElement("div", { key: "a", className: "sd-dlg-actions" }, actions)
			])
		]);
	}

	// ── module state bound in apply() ────────────────────────────────────────
	var ctxRef = null;
	var sessionsService = null;
	var pendingCapture = { session: null };
	/** Whether the sidebar entry found its anchor (reported by diagnostics). */
	var entryInjected = false;

	/**
	 * The live locale service, resolved on every call rather than captured once
	 * in apply(). Two reasons: the client entry graph does not guarantee the
	 * locale row is active before this plugin's fiber (so an early mount would
	 * otherwise fall back to Chinese forever), and a plain lookup each time also
	 * follows a service the runtime replaced. `ctx.get()` is a property read,
	 * so there is nothing to cache.
	 * @returns the locale service, or null when it is absent or unreadable.
	 */
	function liveLocale() {
		try {
			if (ctxRef !== null && typeof ctxRef.get === "function") {
				return ctxRef.get("locale") || null;
			}
		} catch (e) {}
		return null;
	}

	function tr(key, params) {
		var lid = "zh";
		try {
			var locale = liveLocale();
			if (locale !== null && typeof locale.getLocale === "function") {
				var snap = locale.getLocale();
				if (snap !== undefined && snap !== null && snap.active === "en") lid = "en";
			}
		} catch (e) {}
		var dict = DICTS[lid] || DICTS.zh;
		var text = dict[key];
		if (typeof text !== "string") text = DICTS.zh[key];
		if (typeof text !== "string") text = key;
		if (params !== undefined && params !== null) {
			text = text.replace(/\{(\w+)\}/g, function (all, name) {
				var v = params[name];
				return v === undefined || v === null ? "" : String(v);
			});
		}
		return text;
	}

	var inject = ["sessions"];

	function apply(ctx) {
		ctxRef = ctx;
		sessionsService = ctx.sessions;
		ctx.effect(insertStyles, "session-purge: styles");
		// Append "移入回收站" to the session-row context menu (rename/fork/archive)
		// via DOM-level injection — the row menu is built inside another package
		// and this plugin reaches it at the DOM level (see the comment block
		// above the injection helpers).
		ctx.effect(installSessionMenuInjection, "session-purge: session menu injection");
		// The fourth icon on the workspace row, plus the panel it opens. Both are
		// self-healing DOM mounts: upstream has no seat there (design.md §2.1).
		ctx.effect(installSidebarTrashEntry, "session-purge: sidebar entry");
		ctx.effect(installTrashPanelMount, "session-purge: trash panel");
		// The settings page registers into the shell's settings domain; a shell
		// without it keeps working (the host route remains the only way in).
		installSettingsSection(ctx);
		// The section contract has no icon option, so the nav row is marked for a
		// CSS glyph swap (the shell's own fallback is a gear).
		ctx.effect(installSettingsNavIcon, "session-purge: settings nav icon");
		ctx.effect(function () {
			return function () {
				disposeDialogHost();
				disposeTrashPanelRoot();
			};
		}, "session-purge: overlay hosts");
	}

	exports.name = "session-purge";
	exports.inject = inject;
	exports.apply = apply;
	// @internal Regression-test surface for the pure menu/sidebar helpers (see
	// tools/helpers.test.mjs) and for rendering the dialog and the panel under
	// real React (tools/dialog-render-probe.mjs, tools/trash-panel-probe.mjs).
	// Not plugin API: the host loader only reads name/inject/apply, and nothing
	// here runs until a caller invokes it.
	/**
	 * Bind the context `tr()` reads the locale through, without a real component
	 * tree or `apply()`'s DOM side effects. Used by the regression suite in
	 * tools/helpers.test.mjs; not plugin API.
	 */
	exports.__testMountLocale = function (ctx) {
		ctxRef = ctx;
	};

	exports.__test = {
		SESSION_MENU_SEQUENCES: SESSION_MENU_SEQUENCES,
		TRASH_ANCHOR_LABELS: TRASH_ANCHOR_LABELS,
		menuItemLabels: menuItemLabels,
		matchesSequence: matchesSequence,
		labelIs: labelIs,
		isSessionMenuDom: isSessionMenuDom,
		archiveIndex: archiveIndex,
		nodeFromFiber: nodeFromFiber,
		fiberOf: fiberOf,
		tr: tr,
		// Recycle-bin surface: pure helpers are unit-tested; the components are
		// rendered by the probes.
		binStore: binStore,
		collectTrashAnchorCandidates: collectTrashAnchorCandidates,
		pickTrashAnchor: pickTrashAnchor,
		formatBytes: formatBytes,
		formatRelativeTime: formatRelativeTime,
		shortSessionId: shortSessionId,
		displayTitle: displayTitle,
		isExpiringEntry: isExpiringEntry,
		openTrashPanel: openTrashPanel,
		closeTrashPanel: closeTrashPanel,
		refreshBin: refreshBin,
		restoreBinEntry: restoreBinEntry,
		restoreNoticeText: restoreNoticeText,
		requestBinPurge: requestBinPurge,
		requestBinEmpty: requestBinEmpty,
		cancelBinConfirm: cancelBinConfirm,
		confirmBinAction: confirmBinAction,
		binPolicyText: binPolicyText,
		pickLabeledButton: pickLabeledButton,
		// Settings entry: both launcher generations and the account-menu row pick.
		ACCOUNT_MENU_LABELS: ACCOUNT_MENU_LABELS,
		SETTINGS_MENU_ITEM_LABELS: SETTINGS_MENU_ITEM_LABELS,
		pickSettingsMenuItem: pickSettingsMenuItem,
		findSettingsTrigger: findSettingsTrigger,
		findAccountMenuTrigger: findAccountMenuTrigger,
		openSettingsViaAccountMenu: openSettingsViaAccountMenu,
		// Settings page surface.
		settingsStore: settingsStore,
		retentionOptions: retentionOptions,
		retentionLabel: retentionLabel,
		lastSweepText: lastSweepText,
		compareVersions: compareVersions,
		versionParts: versionParts,
		refreshSettings: refreshSettings,
		saveSetting: saveSetting,
		runSweepNow: runSweepNow,
		maybeCheckForUpdate: maybeCheckForUpdate,
		markSettingsNavIcon: markSettingsNavIcon,
		openSettingsFromBin: openSettingsFromBin,
		SettingsSection: SettingsSection,
		SwitchControl: SwitchControl,
		RetentionControl: RetentionControl,
		IntervalControl: IntervalControl,
		TrashConfirmDialog: TrashConfirmDialog,
		// The /trash response contract: success leaves the dialog for the toast.
		trashOutcome: trashOutcome,
		TrashPanelHost: TrashPanelHost,
		TrashPanelBody: TrashPanelBody
	};
	return module.exports;
}});
