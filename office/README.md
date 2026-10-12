# AI Marketing Office

A live 3D view of what Claude Code is doing in this project, driven only by real hook events.

## Run

```bash
node office/server.js        # then open http://localhost:4317
```

No `npm install` needed: the server has no dependencies, and Three.js is vendored in `public/vendor/`.
The server listens on `127.0.0.1` only and rejects requests whose `Host`/`Origin` isn't localhost.
Use `OFFICE_PORT=xxxx` to change the port.

## How it works

1. **Hooks** (`.claude/settings.json` → `office/hooks/log-action.js`) run on `PreToolUse`, `UserPromptSubmit`, and `Stop`
   and append one JSON line to `.office/activity.log` (gitignored, rotated at 5 MB):
   `{"ts":…,"event":"PreToolUse","session":"711f6efa","tool":"Edit","file":"ads/summer_ad_copy.md"}`.
   Only the tool name, the file name, and, for side effects outside this folder, a category label
   (`git-push`, `deploy`, `publish`, `send-email`, `send-message`, `http-write`, `remote-shell`,
   `external-write`, `outside-project-write`) are stored. Prompts, file contents, and command text are never written.
   Files outside the project are logged by base name only. The hook prints nothing and always exits 0, in about 50 ms.
2. **Server** (`office/server.js`) tails the log, routes each action to an employee, builds the Manager's report
   on every `Stop`, and streams everything over Server-Sent Events (`/events`).
3. **Team config** (`office-config.json`): divisions → folders → employees. A file goes to the first division
   whose folder prefix matches (`"*"` catches everything else), then to the first employee whose `keywords` appear
   in the file name, or whose `tools` list contains the tool (`mcp__*` is a prefix wildcard); otherwise to the
   division's first employee. Edits take effect live.
4. **Page** (`office/public/`): monitors light up only while an employee has a real action in the current turn.
   They switch off 3 s after `Stop`, or after 2 min with no events (an interrupted turn fires no `Stop`).

Note: the root `package.json` is currently empty, which makes Node refuse to run any script under the project root.
`office/package.json` shields the office scripts from that, so the root file was left untouched.
