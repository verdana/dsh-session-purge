# dsh-session-purge

[中文](https://github.com/verdana/dsh-session-purge/blob/main/README.md) | [English](./README.en.md)

Adds **Delete session** to the DeepSeek Harness (DSH) session-row menu, alongside
Rename / Fork session / Archive session.

Upstream's archive only hides a session from the sidebar — its log stays on disk
forever. This plugin does the **real thing**: it removes the session's log
directory from disk, permanently.

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

Hover any session row → click `⋯` → **Delete session** (red) → confirm with
**Delete** in the dialog. When it finishes, the dialog reports just one line:
`Deleted session “<name>”.`

The row disappears from the sidebar immediately — no manual refresh.

## What to know

- **It cannot be undone.** The whole session directory is removed
  (`~/.dsh/sessions/<workspace>/<session id>/`). You confirm once, and there is no
  undo after that.
- **A running session cannot be deleted.** The delete button is disabled with an
  explanation, and the host checks again on its side. Stop the session (or let it
  finish) and come back.
- **Archived sessions are not in the sidebar**, so their menu is not reachable.
  Unarchive one first, or delete its directory from disk directly.
- **A session that happens to be open and idle**: the plugin releases it safely
  first, then removes the log. If it cannot be released safely at that moment
  (the runtime is still settling, say), the deletion is queued and runs the next
  time you start `dsh web`.
- **Only directories it can prove are session logs get deleted.** The plugin
  deletes only what the session persistence layer locates and whose filename is
  genuinely a session log (`session[.vN].jsonl[.zstd]`). It would rather refuse
  than remove the wrong directory.

## Troubleshooting

- No **Delete session** item? Check that the plugin is installed, that `dsh web`
  was restarted, and that the page was reloaded (Ctrl+Shift+R). As long as the
  menu shows Rename / Fork session / Archive session, the plugin should insert
  Delete session right below Archive session.
- To find out **whether a session is really gone**, use `/session-purge/state`:

  ```sh
  curl http://127.0.0.1:<port>/session-purge/state
  ```

  It lists the sessions the persistence layer currently knows about (id / size /
  whether it is in memory / whether it is archived), plus `held` (in memory) and
  `pending` (queued for deletion on restart). Note that `title` is **always
  null**: a session title is an *event* in the log, not part of the session
  metadata, so this endpoint cannot see one. The title shown in the UI is read
  off the sidebar row by the plugin.
- Verbose logs: start `dsh web` with `DSH_PURGE_DEBUG=1`.

## Requirements

- DSH, with a working `dsh web`. **Verified against 0.1.5-rc.3, 0.1.7-rc.2 and
  0.2.0-rc.2.**
- Zero dependencies, no build step, one codebase for Windows / Linux / macOS.

## Development

Development, testing and release flow:
[DEVELOPING.md](https://github.com/verdana/dsh-session-purge/blob/main/DEVELOPING.md).

MIT License.
