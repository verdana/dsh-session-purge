# dsh-session-purge

[中文](https://github.com/verdana/dsh-session-purge/blob/main/README.md) | [English](./README.en.md)

Adds **Delete session** to the DeepSeek Harness (DSH) session-row menu, alongside
Rename / Fork session / Archive session.

Upstream's archive only hides a session from the default list — its log stays on
disk forever. This plugin does the **real thing**: it removes the session's log
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

The menu item, the dialog and its report all follow DSH's interface language:
this item reads `删除会话` under a Chinese UI, and so does the rest of the copy.

The row disappears from the list immediately — no manual refresh.

## What to know

- **It cannot be undone.** The whole session directory is removed
  (`~/.dsh/sessions/<workspace>/<session id>/`). You confirm once, and there is no
  undo after that.
- **A running session cannot be deleted.** The menu item itself stays clickable,
  but the dialog's **Delete** button is greyed out with the reason, and the host
  checks again on its side. Stop the session (or let it finish) and come back.
- **Archived sessions are not in the default list.** Reveal them with the list's
  View options → **All conversations (show archived)** or **Archived only**. On
  those rows the menu shows Unarchive session, and the plugin inserts Delete
  session right below it — so you can delete straight from that view without
  unarchiving first.
- **A session that happens to be open and idle**: the plugin releases it safely
  first, then removes the log. If it cannot be released safely at that moment
  (the runtime is still settling, say), the deletion is queued and runs the next
  time you start `dsh web` (to take it back, see `/session-purge/undo` under
  Troubleshooting).
- **Only directories it can prove are session logs get deleted.** The plugin
  deletes only what the session persistence layer locates and whose filename is
  genuinely a session log (`session[.vN].jsonl[.zstd]`). It would rather refuse
  than remove the wrong directory.

## Troubleshooting

- No **Delete session** item? Check that the plugin is installed, that `dsh web`
  was restarted, and that the page was reloaded (Ctrl+Shift+R). As long as the
  menu shows Rename / Fork session / Archive session (Unarchive session on an
  archived row), the plugin should insert Delete session right below that row.
- To find out **whether a session is really gone**, use `/session-purge/state`:

  ```sh
  curl http://127.0.0.1:<port>/session-purge/state
  ```

  It lists the sessions the persistence layer currently knows about (id / working
  directory / size / whether it is in memory / whether it is archived), plus
  `held` (in memory) and `pending` (queued for deletion on restart). Note that
  `title` is **always null**: a session title is an *event* in the log, not part
  of the session metadata, so this endpoint cannot see one. The title shown in
  the UI is read off the session row by the plugin.
- Changed your mind mid-way? A session that is only queued for
  "delete on restart" can still be pulled back before the next `dsh web` start:

  ```sh
  curl -X POST http://127.0.0.1:<port>/session-purge/undo \
    -H 'content-type: application/json' -d '{"sessionId":"<session id>"}'
  ```

  Take the session id from `pending` in `/session-purge/state`. This only cancels
  the queue; a session already deleted (`mode: "deleted"`) cannot be brought back.
- Verbose logs: start `dsh web` with `DSH_PURGE_DEBUG=1`.

## Requirements

- DSH, with a working `dsh web`. **Verified against 0.1.5-rc.3, 0.1.7-rc.2 and
  0.2.0-rc.2.**
- Node.js `^22.19.0 || >=24` (the `engines` field in `package.json`; what matters
  in practice is the Node your `dsh web` runs on).
- Zero dependencies, no build step, one codebase for Windows / Linux / macOS.

## Development

Development, testing and release flow:
[DEVELOPING.md](https://github.com/verdana/dsh-session-purge/blob/main/DEVELOPING.md).

MIT License.
