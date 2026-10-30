# dsh-session-purge

[![npm version](https://img.shields.io/npm/v/dsh-session-purge.svg)](https://www.npmjs.com/package/dsh-session-purge)

[中文](https://github.com/verdana/dsh-session-purge/blob/main/README.md) | [English](./README.en.md)

A **recycle bin** for DeepSeek Harness (DSH) session deletion: deleting no longer
destroys anything — the session is moved, as-is, into the bin, where it can be
restored at any time or deleted for real. The bin does not grow forever either:
entries are kept for 30 days by default and then cleaned up automatically.

Upstream's "archive" only hides a session from the default list while its log
stays on disk forever. This plugin is about **deletion**, and it splits deletion
into two jobs: the reversible part (move to the bin) and reclaiming disk space
(true delete, or automatic clean-up on a retention schedule).

> Versions and per-release changes live in [CHANGELOG.md](./CHANGELOG.md); the latest
> published version is the badge above.

## What it does

- **Session-row menu**: `⋯` → **Move to recycle bin** (replacing the old
  unrecoverable "Delete session"), with a confirmation step. A running session is
  refused.
- **Sidebar workspace row**: a fourth icon after search / view options / add
  workspace — the **recycle bin**. It opens a panel listing every deleted session
  (title, original folder, deletion time, size, session id) where each entry can be
  **restored** or **deleted permanently**, with **Empty the recycle bin** and the
  retention policy in the footer.
- **Account menu → Settings → Recycle bin** (since DSH 0.2.1; older shells show a
  sidebar **Settings** button): the nav row uses the bin icon, plus the auto-clean
  switch, the retention period (7/30/90/365 days / forever), sweep-on-startup, the
  sweep interval (1–168 hours), usage stats, **Clean up now** and **Open the recycle
  bin**; the footer shows the running version and hints at newer npm releases.
- **Defaults**: auto-clean on, 30-day retention, one sweep at startup plus one
  every 6 hours. Changes take effect immediately — no restart.

## Install

```sh
# npm (recommended)
dsh plugin --profile web add dsh-session-purge

# GitHub repository
dsh plugin --profile web add github:verdana/dsh-session-purge

# Prebuilt release tarball (no build approval needed)
dsh plugin --profile web add <release-tarball-url>
```

**Restart `dsh web`** afterwards (host-side plugins are only loaded at startup),
then reload the page with Ctrl+Shift+R.

Upgrade and uninstall:

```sh
dsh plugin --profile web update dsh-session-purge
dsh plugin --profile web remove dsh-session-purge
```

## Usage

### Move a session to the bin

Hover any session row → click `⋯` → **Move to recycle bin** → confirm. The row
leaves the list immediately and the entry shows up in the bin. The menu item, the
dialog, the panel and the settings page all follow DSH's interface language.

### Open the bin

Click the **bin icon** on the sidebar's workspace row. The panel lists every
deleted session, newest deletion first:

- Each row shows the title (or "Untitled session"), the original working folder,
  `Deleted 3 days ago`, the size and the session id; entries past their retention
  window are marked "Will be removed by the next auto-clean".
- **Restore** moves the directory back exactly where it came from (byte-for-byte);
  the sidebar row reappears without a page reload.
- **Delete permanently** removes it after a confirmation, and cannot be undone.
- **Empty the recycle bin** removes everything after a confirmation that states
  the entry count and the space involved.
- More than 50 entries show one page with a **Load more** control.

### Settings

Bottom-left **account menu → Settings → Recycle bin** (since DSH 0.2.1; older shells
show a sidebar **Settings** button instead):

| Option | Default | Meaning |
|---|---|---|
| Auto-clean the recycle bin | on | When off, nothing is deleted automatically — only manual clean-up runs |
| Retention period | 30 days | 7 / 30 / 90 / 365 days or "Forever"; older entries are permanently deleted by the next sweep |
| Sweep once at startup | on | Run one retention sweep each time `dsh web` starts |
| Sweep interval | 6 hours | 1–168 hours; both schedule controls grey out while auto-clean is off |
| Clean up now | — | Run one retention sweep immediately and report how many entries went |
| Open the recycle bin | — | Open the bin panel directly |

The page footer is separated by a rule and shows **the version of the plugin that is
actually running**. Opening the page also makes one best-effort npm registry check: a
newer release gets a clickable hint, the latest release says "Up to date", and an
offline or blocked registry is skipped silently — the version line stays, and no
setting is affected. The version comes from the host half, so after upgrading the
plugin, restart `dsh web` once; a page reload alone will not show the new footer.

## What to know

- **Deletion is reversible; disk space is not reclaimed immediately.** Moving a
  session to the bin relocates its directory. The space comes back on a permanent
  delete, on emptying the bin, or on an automatic sweep.
- **A running session cannot be moved.** The menu item stays clickable, but the
  confirming button is disabled with the reason (the host checks again on its
  side). Stop the session, or let it finish.
- **A session that happens to be open and idle** is released safely first. If that
  is not possible at the moment (the runtime is still settling), the move is queued
  and runs the next time you start `dsh web` (see Troubleshooting to cancel it).
- **Archived sessions are not in the default list.** Reveal them with the list's
  View options → **All conversations (show archived)** or **Archived only**. An
  archived row's menu is Pin / Rename / Fork session / Unarchive session — there is
  no built-in **Archive session** row for the plugin to anchor to, so it does **not**
  insert Move to recycle bin on archived rows. Unarchive the session first, then use
  the `⋯` menu on a normal row.
- **Only directories it can prove are session logs get moved.** The plugin acts
  only on what the session persistence layer locates and whose filename is
  genuinely a session log (`session[.vN].jsonl[.zstd]`). It would rather refuse
  than touch the wrong directory.
- **Where the bin lives**: `~/.dsh/session-purge/trash/`, one entry per deleted
  session — the moved session directory plus a sidecar metadata file recording the
  original path, deletion time, size and archive state, which is what makes a
  restore byte-exact.
- **Settings live in the plugin's own file**: `~/.dsh/session-purge/settings.json`
  (atomic writes; a corrupt file falls back to defaults and is kept as `.bak`). It
  deliberately does not use DSH's plugin-config system, which keeps this plugin
  zero-dependency and build-free.

## Troubleshooting

- **No "Move to recycle bin" item or bin icon?** Check that the plugin is
  installed, that `dsh web` was restarted, and that the page was reloaded
  (Ctrl+Shift+R). As long as the menu shows Rename / Fork session / Archive
  session (plus Copy Session ID after archive on 0.2.1; Unarchive session on an
  archived row), the plugin should insert its item right below that row; the icon
  sits immediately after **Add workspace**.
- **Cannot find the Settings page?** Since 0.2.1 the entry is the bottom-left
  **account menu → Settings**; there is no separate sidebar Settings button
  anymore. The bin panel's policy line also opens Settings directly. Older DSH
  versions still show the sidebar Settings button.
- **To see the actual state**:

  ```sh
  curl http://127.0.0.1:<port>/session-purge/state     # disk truth + bin summary + settings
  curl http://127.0.0.1:<port>/session-purge/trash     # bin entries
  curl http://127.0.0.1:<port>/session-purge/settings  # settings and stats
  ```

  In `state`, `sessions[].title` is **always null**: a title is an *event* in the
  log, not part of the session metadata. The UI reads titles off the session row
  and records them with the entry when it moves one into the bin.
- **Changed your mind** about a session that is only queued for "move to the bin on
  restart"? Pull it back before the next `dsh web` start:

  ```sh
  curl -X POST http://127.0.0.1:<port>/session-purge/undo \
    -H 'content-type: application/json' -d '{"sessionId":"<session id>"}'
  ```

  Take the id from `pending` in `/session-purge/state`. This only cancels the
  queue; a session already in the bin should be **Restore**d from the panel, and a
  permanently deleted one cannot come back.
- **Change settings without the UI**:

  ```sh
  curl -X POST http://127.0.0.1:<port>/session-purge/settings \
    -H 'content-type: application/json' -d '{"autoClean":false,"retentionDays":90}'
  curl -X POST http://127.0.0.1:<port>/session-purge/sweep
  ```

- **A few entries survived "Empty the recycle bin"**: the host refused them —
  usually because the payload directory was turned into a link pointing outside the
  bin, which the safety gate rejects. Those rows stay in the panel with the reason
  inline and a count of what could not be removed; reopening the panel keeps them.
  **Restore** the session to get it back, or repair the directory and delete again.

- Verbose logs: start `dsh web` with `DSH_PURGE_DEBUG=1`.

## Requirements

- DSH, with a working `dsh web`. **Fully verified live on 0.2.1-rc.5, 0.2.1-rc.4,
  0.2.1-rc.2 and 0.2.0-rc.2**: the bin panel, the settings page's auto-clean controls,
  the full move → restore → delete-permanently → sweep round trip, plus (on 0.2.1) the
  account-menu settings entry and the dev repro scripts against the plugin-style
  JSONL backend. rc.3 was never run on its own — it differs from its neighbours only
  in tooltip and logging behavior; none of the contracts this plugin relies on
  changed anywhere between rc.2 and rc.5 (see
  [docs/compat-0.2.1-rc.5.md](https://github.com/verdana/dsh-session-purge/blob/main/docs/compat-0.2.1-rc.5.md)).
  The menu and sidebar injection for 0.1.7-rc.2 / 0.1.5-rc.3 use the same DOM detection
  and are expected to work, but were not re-verified in this round; 0.1.5-rc.3 has no
  settings extension point, so the **settings page is unavailable there** — use the
  HTTP routes above instead.
- Node.js `^22.19.0 || >=24` (the `engines` field in `package.json`; what matters
  in practice is the Node your `dsh web` runs on).
- Zero dependencies, no build step, one codebase for Windows / Linux / macOS.

## Development

Code layout, testing and release flow:
[DEVELOPING.md](https://github.com/verdana/dsh-session-purge/blob/main/DEVELOPING.md);
the product spec and the implementation record (including known limits and future
enhancements):
[docs/recycle-bin/](https://github.com/verdana/dsh-session-purge/tree/main/docs/recycle-bin).

MIT License.
