# AI Marketing Office

A live 3D view of what Claude Code is doing in this project, driven only by real hook events, with a chat panel
for giving the team instructions. Built as an ideation extension for the Resonance of Indonesia Instagram team.

## Run

```bash
npm start                    # or: node office/server.js — then open http://localhost:4317
```

No `npm install` needed: the server has no dependencies, and Three.js is vendored in `public/vendor/`.
The server listens on `127.0.0.1` only and rejects requests whose `Host`/`Origin` isn't localhost.
Use `OFFICE_PORT=xxxx` to change the port.

## How it works

1. **Hooks** (`.claude/settings.json` → `office/hooks/log-action.js`) run on `PreToolUse`, `UserPromptSubmit`, and `Stop`
   and append one JSON line to `.office/activity.log` (gitignored, rotated at 5 MB):
   `{"ts":…,"event":"PreToolUse","session":"711f6efa","tool":"Edit","file":"hooks/viral_hooks_week3.md"}`.
   Only the tool name, the file name, and, for side effects outside this folder, a category label
   (`git-push`, `deploy`, `publish`, `send-email`, `send-message`, `http-write`, `remote-shell`,
   `external-write`, `outside-project-write`) are stored. Prompts, file contents, and command text are never written.
   Files outside the project are logged by base name only. The hook prints nothing and always exits 0, in about 50 ms.
2. **Server** (`office/server.js`) tails the log, routes each action to an employee, builds the Manager's report
   on every `Stop`, and streams everything over Server-Sent Events (`/events`).
3. **Team config** (`office-config.json`): thirteen roles in five rooms. Researcher and Analyst are in the Insights Lab,
   Hook Writer and Copywriter in the Creative Studio, Designer and Manager in Production & Ops, the Sales Manager,
   Account Executive and Customer Success in the Sales Team, and four Motion roles in Motion Graphics & Video Synthesis. Routing, in order:
   - a file inside a division's folder goes to that division's employee whose keyword is in the file name, else to the division's `default`;
   - otherwise to the first employee whose keyword is in the file name;
   - otherwise to the employee whose `tools` include the tool (`mcp__*` is a prefix wildcard);
   - otherwise to `fallback` (Manager).

   Edits take effect live.
4. **ROI Instagram Updates** (`watch` in the config): file *changes* with `instagram`, `metrics`, `templates`, or
   `drafts` as a folder in their path, or with `ig_`, `instagram`, `reel`, or `carousel` in the name, are highlighted
   in the Activity feed (with an "ROI Instagram updates" filter) and listed in the Manager's reports.
5. **Chat** (`office/chat.js`): the Chat tab sends your instruction to Claude Code (`claude -p`) in this project.
   Follow-ups resume the same Claude session, so you can ask questions or redirect. Messages sent while the team is
   working queue up. **Stop** ends the current run, and **New chat** starts a fresh session. History is kept in
   `.office/chat.json`. By default Claude may read, write, and edit files and search the web here, but not run shell
   commands; change that under `chat` in the config. Claude Code must be installed and logged in (`claude` on your PATH).
   The chat endpoints only accept requests that carry a random token the page receives from this server.
6. **Page** (`office/public/`: `app.js` plus `js/kit.js` props, `js/people.js` characters, `js/rooms.js` rooms,
   `js/nav.js` walking routes). Four team rooms, a Break Room (kitchen, table, couch) and your office, connected by
   corridors and doors. Monitors and task labels light up only while an employee has a real action in the current
   turn. They switch off 3 s after `Stop`, or after 2 min with no events (an interrupted turn fires no `Stop`).
   On each report, the Manager walks to your office.
7. **Idle life**: once the office has been quiet for about 10 s, up to three people at a time get coffee, sit at
   the table or on the couch, or visit a colleague's desk, showing only a 💬 bubble. This is ambient animation: it
   never creates tasks, feed entries or reports, and the status still says Idle. As soon as you send a chat message
   or Claude Code starts working, everyone hurries back to their desk.

8. **Motion Graphics & Video Synthesis** (`motion/`): `node motion/render_loop.js <spec> [--plan] [--placeholders]
   [--scale 0.25] [--formats prores,mp4,hap]` renders a frame-exact, seamless LED stage loop from
   `motion/loop_spec.json` with ffmpeg, then writes a timing CSV and a QA report (seam check, frame counts).
   Needs `ffmpeg` (macOS: `brew install ffmpeg`). The full process is in `planning/stage_loop_blueprint.md`; role
   personas are in `.claude/agents/`. The chat may delegate to these sub-agents (`Task`), run only the render script
   (`Bash(node motion/render_loop.js:*)`), and use the Canva connector if you have added it. Use `--preview` for quick
   looks (seconds) and `--doctor` to check ffmpeg. Optional: set `"model": "sonnet"` under `chat` in the config for
   faster (lighter) chat replies; leave it out to use your Claude Code default.

`CLAUDE.md` gives every Claude Code run the ROI context (ideation only, hand-off to the human team) and the folder
conventions that make routing work.

