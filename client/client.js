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
		".sd-dlg-btn-danger:hover{color:#fff;filter:brightness(1.08)}"
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
	// The upstream session-row menu (重命名 / 分叉会话 / 归档会话) is hardcoded
	// inside dsh-client-ui-workspace with no extension slot, and the shared
	// primitives seed module is Object.freeze'd — a module-level monkey patch
	// is impossible (the assignment silently no-ops). So we work at the DOM
	// level: a capture-phase click listener resolves which session's ⋯ button
	// was pressed (React fiber walk with an aria-label fallback), and a
	// MutationObserver appends the delete item right after the menu portal
	// mounts it.

	/** React instance key on a DOM node ("__reactFiber$<random>"), any React 17+. */
	function fiberOf(el) {
		if (el === null || el === undefined || typeof el !== "object") return null;
		var keys = Object.keys(el);
		for (var i = 0; i < keys.length; i++) {
			if (keys[i].lastIndexOf("__reactFiber$", 0) === 0) return el[keys[i]];
		}
		return null;
	}

	/** Walk up the fiber chain to the SessionNodeItem component fiber, read `node`. */
	function nodeFromFiber(fiber) {
		var f = fiber;
		var depth = 0;
		while (f !== null && f !== undefined && depth < 48) {
			var mp = f.memoizedProps;
			if (mp !== null && typeof mp === "object" &&
				mp.node !== null && typeof mp.node === "object" &&
				typeof mp.node.id === "string" && typeof mp.node.running === "boolean" &&
				typeof mp.onFork === "function" && typeof mp.onArchive === "function") {
				return mp.node;
			}
			f = f.return;
			depth++;
		}
		return null;
	}

	/** Sessions store lookup by display title (fallback path). */
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

	/** Expected upstream menu label sequences (rename/fork/archive), any locale. */
	function sessionMenuLabelSequences() {
		return [
			["重命名", "分叉会话", "归档会话"],
			["Rename", "Fork session", "Archive session"]
		];
	}

	/** Does this div[role=menu] carry exactly the rename/fork/archive sequence? */
	function isSessionMenuDom(menuEl) {
		var btns = menuEl.querySelectorAll("button[role=menuitem]");
		if (btns.length !== 3) return false;
		var seqs = sessionMenuLabelSequences();
		for (var s = 0; s < seqs.length; s++) {
			var seq = seqs[s];
			var ok = true;
			for (var i = 0; i < 3; i++) {
				if ((btns[i].textContent || "").trim() !== seq[i]) { ok = false; break; }
			}
			if (ok) return true;
		}
		return false;
	}

	/** Close the upstream menu the same way its own Escape handler does. */
	function closeUpstreamMenu() {
		try {
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		} catch (e) {}
	}

	/**
	 * Append the delete item to an open session menu by cloning the last item
	 * wrapper (归档会话) — inherits the exact upstream classes — then swapping
	 * icon + label and tinting it danger red.
	 */
	function injectMenuItem(menuEl) {
		var btns = menuEl.querySelectorAll("button[role=menuitem]");
		var lastBtn = btns[btns.length - 1];
		if (lastBtn === undefined) return;
		var wrap = lastBtn.parentElement;
		if (wrap === null) return;
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
		btn.removeAttribute("aria-haspopup");
		btn.removeAttribute("aria-expanded");
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

		var viewport = wrap.parentElement;
		if (viewport !== null) viewport.appendChild(clone);
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
				key: "ok", type: "button", className: "sd-dlg-btn sd-dlg-btn-danger", onClick: onClose
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

		return React.createElement("div", null, [
			React.createElement("div", { key: "b", className: "sd-dlg-backdrop", onClick: function () { if (!busy) onClose(); } }),
			React.createElement("div", { key: "d", className: "sd-dlg", role: "alertdialog", "aria-label": tr("dialog.title") }, [
				React.createElement("div", { key: "t", className: "sd-dlg-title" }, [
					React.createElement("span", { key: "i", className: "sd-icon", dangerouslySetInnerHTML: { __html: ICON } }),
					React.createElement("span", { key: "l" }, tr("dialog.title"))
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
	return module.exports;
}});
