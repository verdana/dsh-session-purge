window.__ModuleLoader__.load({ id: "dsh-session-purge", factory: (require) => {

	var module = { exports: {} };
	var exports = module.exports;
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	var React = require("react");
	var ReactDOMClient = require("react-dom/client");

	// ── dictionaries ─────────────────────────────────────────────────────────
	var DICTS = {
		zh: {
			"menu.deleteSession": "删除会话",
			"dialog.title": "删除会话",
			"dialog.target": "将永久删除「{name}」的全部磁盘记录，不可恢复。",
			"dialog.cwd": "目录：{cwd}",
			"dialog.queued": "该会话暂驻内存，已转为重启后删除。",
			"dialog.locateFail": "无法定位该会话，请重试或刷新页面后再试。",
			"dialog.done": "已删除会话「{name}」。",
			"dialog.doneTitle": "删除成功",
			"dialog.close": "知道了",
			"row.locked": "该会话正在运行——请先停止或等它完成，再回来删除",
			"row.delete": "删除",
			"row.cancel": "取消",
			"row.deleting": "处理中…",
			"error.live": "会话正在运行——请先停止或等它完成，再删除",
			"error.busy": "会话正在后台整理（压缩/收尾），请稍等几秒再试",
			"error.held": "暂无法安全释放该会话，已转为重启后删除",
			"error.unknown": "未找到该会话的记录（磁盘上可能已不存在）",
			"error.rm": "删除文件失败（文件可能被占用，请稍后重试）",
			"error.storage": "存储服务暂时不可用，请稍后重试",
			"error.unavailable": "运行时缺少所需服务",
			"error.invalid": "无效的会话标识",
			"error.unsupported": "存储后端不支持该操作，或无法确认会话目录",
			"error.origin": "拒绝跨源请求",
			"error.bad-request": "请求格式错误",
			"error.internal": "内部错误",
			"error.fallback": "操作失败"
		},
		en: {
			"menu.deleteSession": "Delete session",
			"dialog.title": "Delete session",
			"dialog.target": "This permanently removes every stored record of “{name}”. It cannot be undone.",
			"dialog.cwd": "Folder: {cwd}",
			"dialog.queued": "This session stays resident in memory; it is queued for deletion on restart.",
			"dialog.locateFail": "Could not locate this session — retry or reload the page.",
			"dialog.done": "Deleted session “{name}”.",
			"dialog.doneTitle": "Deleted",
			"dialog.close": "Got it",
			"row.locked": "This session is running — stop it (or let it finish) before deleting",
			"row.delete": "Delete",
			"row.cancel": "Cancel",
			"row.deleting": "Working…",
			"error.live": "Session is running — stop it (or let it finish), then delete",
			"error.busy": "Session is settling background work; retry in a few seconds",
			"error.held": "Could not release this session safely; queued for deletion on restart",
			"error.unknown": "Session record not found (it may already be gone from disk)",
			"error.rm": "Failed to remove files (they may be locked; retry shortly)",
			"error.storage": "Session storage is temporarily unavailable; retry shortly",
			"error.unavailable": "Required runtime service is missing",
			"error.invalid": "Invalid session id",
			"error.unsupported": "Storage backend does not support this operation, or the session directory could not be proven",
			"error.origin": "Cross-origin request rejected",
			"error.bad-request": "Malformed request",
			"error.internal": "Internal error",
			"error.fallback": "Operation failed"
		}
	};

	var ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.2h11"/><path d="M6.4 4.2V3c0-.44.36-.8.8-.8h1.6c.44 0 .8.36.8.8v1.2"/><path d="M4 4.2l.55 8.9c.03.5.45.9.96.9h4.98c.5 0 .93-.4.96-.9L12 4.2"/><path d="M6.6 7v4.4M9.4 7v4.4"/></svg>';
	/** Same slot, same weight: a tick for the terminal "it worked" state. */
	var OK_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2 8.6l3.1 3.1 6.5-7.3"/></svg>';

	var CSS = [
		".sd-icon{display:inline-flex;align-items:center;flex:none}",
		".sd-dlg-host{position:fixed;inset:0;z-index:2200;pointer-events:none}",
		".sd-dlg-backdrop{position:fixed;inset:0;z-index:2200;background:rgba(0,0,0,.32);pointer-events:auto}",
		".sd-dlg{position:fixed;z-index:2201;left:50%;top:50%;transform:translate(-50%,-50%);width:340px;max-width:calc(100vw - 32px);background:var(--dsw-alias-bg-overlay,#1c2030);border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.35);padding:16px;pointer-events:auto}",
		".sd-dlg-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e8ecff);display:flex;align-items:center;gap:8px}",
		".sd-dlg-title .sd-icon{color:var(--dsw-alias-state-error-primary,#ff8080)}",
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
		// The dialog reports the outcome too, and a completed deletion is a
		// success: the same affirmative button turns green instead of staying
		// danger-red once there is nothing left to be careful about.
		".sd-dlg-success .sd-dlg-title .sd-icon{color:var(--dsw-alias-state-success-primary,#22c55e)}",
		".sd-dlg-btn-success{background:var(--dsw-alias-state-success-primary,#22c55e);border-color:transparent;color:#fff;font-weight:600}",
		".sd-dlg-btn-success:hover{color:#fff;filter:brightness(1.08)}"
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
	 * Append the delete item to an open session menu by cloning the archive item
	 * wrapper — inherits the exact upstream classes — then swapping icon + label
	 * and tinting it danger red. Inserted immediately after the archive row.
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
				k.textContent = tr("menu.deleteSession");
				labelDone = true;
			}
		}
		// Drop the inherited shortcut keycap (0.1.7 renders
		// `<span aria-hidden="true">` with the archive keys inside the button).
		// Delete has no binding of its own, and a `Ctrl+Alt+A` keycap on this row
		// would advertise the archive shortcut.
		var keycaps = clone.querySelectorAll('[aria-hidden="true"]');
		for (var c = 0; c < keycaps.length; c++) keycaps[c].remove();

		btn.removeAttribute("aria-haspopup");
		btn.removeAttribute("aria-expanded");
		btn.removeAttribute("aria-keyshortcuts");
		btn.style.color = "var(--dsw-alias-state-error-primary, #ff8080)";

		var captured = pendingCapture.session;
		btn.title = captured !== null && captured.running ? tr("row.locked") : "";

		btn.addEventListener("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			// Invariant: one delete action per click, even when a hot reload
			// left an older copy of this module listening on its own clone.
			// stopImmediatePropagation keeps this instance's dialog the only one.
			e.stopImmediatePropagation();
			if (btn.dataset.sdClaim === "1") return;
			btn.dataset.sdClaim = "1";
			closeUpstreamMenu();
			var cap = pendingCapture.session;
			openDeleteDialog(cap === null || cap === undefined
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

	function openDeleteDialog(target) {
		var host = ensureDialogHost();
		host.root.render(React.createElement(DeleteConfirmDialog, {
			target: target,
			onClose: function () {
				if (dialogHost === null) return;
				dialogHost.root.render(null);
			}
		}));
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

	/** Two-step confirmation shown when the menu's delete item is chosen. */
	function DeleteConfirmDialog(props) {
		var target = (props && props.target) || {};
		var onClose = props && typeof props.onClose === "function" ? props.onClose : function () {};
		var busyState = React.useState(false);
		var busy = busyState[0];
		var setBusy = busyState[1];
		var errState = React.useState(null);
		var err = errState[0];
		var setErr = errState[1];
		var queuedState = React.useState(false);
		var queued = queuedState[0];
		var setQueued = queuedState[1];
		var doneState = React.useState(null);
		var done = doneState[0];
		var setDone = doneState[1];

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
			fetch("/session-purge/delete", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ sessionId: target.id }),
				cache: "no-store"
			}).then(function (res) {
				return res.json().catch(function () { return null; });
			}).then(function (res) {
				setBusy(false);
				if (res !== null && res !== undefined && res.ok === true) {
					if (res.mode === "queued") { setQueued(true); return; }
					// Remember only the outcome: which session went away and that
					// it worked. The host's name is a fallback for the DOM-capture
					// path, which can only ever produce an id.
					var deletedName = target.title ||
						(typeof res.name === "string" && res.name !== "" ? res.name : null) ||
						target.id;
					setDone({ name: deletedName });
					return;
				}
				var code = res && typeof res.code === "string" ? res.code : "fallback";
				setErr(tr("error." + code));
			}, function (e) {
				setBusy(false);
				setErr(String(e && e.message ? e.message : e));
			});
		}

		var name = target.title || target.id;
		// A confirmed deletion is the one terminal state that reports success;
		// every other terminal state (nothing located, queued for a restart,
		// an error line) still describes an operation the user should treat
		// with the same care as the confirmation, so it keeps the danger look.
		var succeeded = done !== null;
		var body = [];
		if (locateFail) {
			body.push(React.createElement("div", { key: "t", className: "sd-dlg-text" }, tr("dialog.locateFail")));
		} else if (done !== null) {
			// Terminal state: report only which session went away and that it
			// worked — no restated warning, no path dump.
			body.push(React.createElement("div", { key: "d", className: "sd-dlg-text" },
				tr("dialog.done", { name: done.name })));
		} else {
			body.push(React.createElement("div", { key: "t", className: "sd-dlg-text" }, tr("dialog.target", { name: name })));
			if (target.cwd) {
				body.push(React.createElement("div", { key: "c", className: "sd-dlg-cwd" }, tr("dialog.cwd", { cwd: baseName(target.cwd) || target.cwd })));
			}
			if (running) {
				body.push(React.createElement("div", { key: "r", className: "sd-dlg-note sd-dlg-note-warn" }, tr("row.locked")));
			}
			if (queued) {
				body.push(React.createElement("div", { key: "q", className: "sd-dlg-note" }, tr("dialog.queued")));
			}
		}
		if (err !== null) {
			body.push(React.createElement("div", { key: "e", className: "sd-dlg-err" }, err));
		}

		var actions = [];
		if (queued || locateFail || done !== null) {
			actions.push(React.createElement("button", {
				key: "ok", type: "button",
				className: succeeded ? "sd-dlg-btn sd-dlg-btn-success" : "sd-dlg-btn sd-dlg-btn-danger",
				onClick: onClose
			}, tr("dialog.close")));
		} else {
			actions.push(React.createElement("button", {
				key: "no", type: "button", className: "sd-dlg-btn", onClick: onClose, disabled: busy
			}, tr("row.cancel")));
			actions.push(React.createElement("button", {
				key: "yes", type: "button", className: "sd-dlg-btn sd-dlg-btn-danger",
				onClick: onConfirm, disabled: busy || running
			}, busy ? tr("row.deleting") : tr("row.delete")));
		}

		// The dialog heading follows the outcome: the tick + success colour on a
		// completed delete, the bin + danger colour everywhere else.
		var titleKey = succeeded ? "dialog.doneTitle" : "dialog.title";
		return React.createElement("div", null, [
			React.createElement("div", { key: "b", className: "sd-dlg-backdrop", onClick: function () { if (!busy) onClose(); } }),
			React.createElement("div", {
				key: "d",
				className: succeeded ? "sd-dlg sd-dlg-success" : "sd-dlg",
				role: "alertdialog",
				"aria-label": tr(titleKey)
			}, [
				React.createElement("div", { key: "t", className: "sd-dlg-title" }, [
					React.createElement("span", {
						key: "i", className: "sd-icon",
						dangerouslySetInnerHTML: { __html: succeeded ? OK_ICON : ICON }
					}),
					React.createElement("span", { key: "l" }, tr(titleKey))
				]),
				body,
				React.createElement("div", { key: "a", className: "sd-dlg-actions" }, actions)
			])
		]);
	}

	// ── module state bound in apply() ────────────────────────────────────────
	var sessionsService = null;
	var localeService = null;
	var pendingCapture = { session: null };

	function tr(key, params) {
		var lid = "zh";
		try {
			if (localeService !== null && typeof localeService.getLocale === "function") {
				var snap = localeService.getLocale();
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
		sessionsService = ctx.sessions;
		localeService = ctx.get("locale") || null;
		ctx.effect(insertStyles, "session-purge: styles");
		// Append "删除会话" to the session-row context menu (rename/fork/archive)
		// via DOM-level injection — see the comment block above for why the
		// shared Menu primitive cannot be wrapped (Object.freeze).
		ctx.effect(installSessionMenuInjection, "session-purge: session menu injection");
		ctx.effect(function () {
			return function () { disposeDialogHost(); };
		}, "session-purge: dialog host");
	}

	exports.name = "session-purge";
	exports.inject = inject;
	exports.apply = apply;
	// @internal Regression-test surface for the pure menu-detection helpers (see
	// tools/helpers.test.mjs) and for rendering the dialog under real React
	// (tools/_probe-dialog.mjs). Not plugin API: the host loader only reads
	// name/inject/apply, and nothing here runs until a caller invokes it.
	exports.__test = {
		SESSION_MENU_SEQUENCES: SESSION_MENU_SEQUENCES,
		menuItemLabels: menuItemLabels,
		matchesSequence: matchesSequence,
		labelIs: labelIs,
		isSessionMenuDom: isSessionMenuDom,
		archiveIndex: archiveIndex,
		nodeFromFiber: nodeFromFiber,
		fiberOf: fiberOf,
		DeleteConfirmDialog: DeleteConfirmDialog
	};
	return module.exports;
}});
