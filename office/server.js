#!/usr/bin/env node
// AI Marketing Office server. Plain Node, no dependencies.
// - Tails .office/activity.log (written by hooks/log-action.js)
// - Routes each action to an employee using office-config.json
// - On every Stop event, builds the Manager's report for that turn
// - Streams everything to the browser over Server-Sent Events
// Listens on 127.0.0.1 only, and rejects requests whose Host/Origin is not local.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const LOG_FILE = process.env.OFFICE_LOG ? path.resolve(process.env.OFFICE_LOG) : path.join(ROOT, '.office', 'activity.log');
const CONFIG_FILE = path.join(ROOT, 'office-config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const HOST = '127.0.0.1';
const PORT = Number(process.env.OFFICE_PORT) || 4317;
const HISTORY = 400; // entries replayed to a newly opened page

// ---------- config & routing ----------
let config = loadConfig();
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch (e) { console.error('[office] cannot read office-config.json:', e.message); return { divisions: [] }; }
}
fs.watchFile(CONFIG_FILE, { interval: 1000 }, () => {
  config = loadConfig();
  broadcast('config', config);
});

function toolMatches(e, tool) {
  return (e.tools || []).some((t) => t === tool || (t.endsWith('*') && tool && tool.startsWith(t.slice(0, -1))));
}

function routeAction(entry) {
  const divs = config.divisions || [];
  const file = entry.file && entry.file !== '.' ? entry.file : null;
  const lower = file ? file.toLowerCase() : '';
  const base = lower.split('/').pop();
  let div = null;
  if (file && !entry.outside) {
    div = divs.find((d) => (d.folders || []).some((f) => f !== '*' && (lower === f.toLowerCase() || lower.startsWith(f.toLowerCase().replace(/\/$/, '') + '/'))));
  }
  if (!div && !file) {
    div = divs.find((d) => (d.employees || []).some((e) => toolMatches(e, entry.tool)));
  }
  if (!div) div = divs.find((d) => (d.folders || []).includes('*')) || divs[0];
  if (!div) return null;
  const emps = div.employees || [];
  const emp =
    (base && emps.find((e) => (e.keywords || []).some((k) => base.includes(String(k).toLowerCase())))) ||
    emps.find((e) => toolMatches(e, entry.tool)) ||
    emps[0];
  return emp ? { division: div.id, employee: emp.name } : null;
}

const VERBS = {
  Read: 'reading', Write: 'writing', Edit: 'editing', MultiEdit: 'editing', NotebookEdit: 'editing',
  Bash: 'running a command', Grep: 'searching', Glob: 'listing files', WebSearch: 'researching',
  WebFetch: 'reading a web page', Task: 'delegating', Agent: 'delegating', TodoWrite: 'planning',
};
function verbFor(tool) {
  if (VERBS[tool]) return VERBS[tool];
  if (tool && tool.startsWith('mcp__')) return tool.split('__').slice(1).join(' ').replace(/_/g, ' ');
  return 'using ' + tool;
}
function labelFor(entry) {
  const v = verbFor(entry.tool);
  const name = entry.file && entry.file !== '.' ? entry.file.split('/').pop() : '';
  return name ? `${v} · ${name}` : v;
}

const FLAG_TEXT = {
  'git-push': 'pushed to a remote git repository',
  deploy: 'ran a deployment command',
  publish: 'published a package',
  'send-email': 'sent email',
  'send-message': 'sent a message through an external service',
  'http-write': 'sent data to a web service',
  'remote-shell': 'connected to a remote machine',
  'external-write': 'changed something in an external service',
  'outside-project-write': 'modified a file outside this project',
};

// ---------- turn tracking & manager reports ----------
const turns = new Map(); // session -> { start, actions: [] }
function turnFor(session) {
  const key = session || 'default';
  if (!turns.has(key)) turns.set(key, { start: null, actions: [] });
  return turns.get(key);
}

function buildReport(turn, stopTs) {
  const acts = turn.actions;
  const byEmp = new Map();
  for (const a of acts) {
    const k = a.employee || 'Unassigned';
    if (!byEmp.has(k)) byEmp.set(k, { employee: k, division: a.division, counts: {}, files: new Set() });
    const g = byEmp.get(k);
    const v = verbFor(a.tool);
    g.counts[v] = (g.counts[v] || 0) + 1;
    if (a.file && a.file !== '.') g.files.add(a.file.split('/').pop());
  }
  const lines = [...byEmp.values()].map((g) => {
    const what = Object.entries(g.counts).map(([v, n]) => (n > 1 ? `${v} ×${n}` : v)).join(', ');
    const files = [...g.files];
    const fileText = files.length ? ` (${files.slice(0, 4).join(', ')}${files.length > 4 ? `, +${files.length - 4} more` : ''})` : '';
    return { employee: g.employee, division: g.division, text: what + fileText };
  });
  const flags = acts.filter((a) => a.flag).map((a) => ({
    employee: a.employee, tool: a.tool, flag: a.flag, file: a.file || null,
    text: `${a.employee || 'Someone'} ${FLAG_TEXT[a.flag] || a.flag}` + (a.file ? ` (${a.file})` : '') + ` via ${a.tool}`,
  }));
  const summary = acts.length === 0
    ? 'No tool actions this turn. Claude answered directly.'
    : `${acts.length} action${acts.length === 1 ? '' : 's'} by ${lines.length} team member${lines.length === 1 ? '' : 's'}` +
      (flags.length ? `. ⚠ ${flags.length} action${flags.length === 1 ? '' : 's'} reached outside this folder.` : '. Everything stayed inside this folder.');
  return {
    type: 'report', ts: stopTs, start: turn.start, durationMs: turn.start ? stopTs - turn.start : null,
    actionCount: acts.length, summary, lines, flags,
  };
}

// Turns a raw log entry into zero or more messages for the browser.
function process_(entry) {
  if (!entry || !entry.event) return [];
  const turn = turnFor(entry.session);
  if (entry.event === 'UserPromptSubmit') {
    turn.start = entry.ts; turn.actions = [];
    return [{ type: 'prompt', ts: entry.ts, session: entry.session }];
  }
  if (entry.event === 'PreToolUse') {
    if (!turn.start) turn.start = entry.ts;
    const r = routeAction(entry) || {};
    const action = {
      type: 'action', ts: entry.ts, session: entry.session, tool: entry.tool, file: entry.file || null,
      outside: !!entry.outside, flag: entry.flag || null, division: r.division || null, employee: r.employee || null,
      label: labelFor(entry),
    };
    turn.actions.push(action);
    return [action];
  }
  if (entry.event === 'Stop') {
    const report = buildReport(turn, entry.ts);
    report.session = entry.session;
    turn.start = null; turn.actions = [];
    return [{ type: 'stop', ts: entry.ts, session: entry.session }, report];
  }
  return [];
}

// ---------- log tailing ----------
const history = [];
let offset = 0;
let partial = '';
function remember(msgs) {
  for (const m of msgs) { history.push(m); if (history.length > HISTORY) history.shift(); }
}
function readNew() {
  let size;
  try { size = fs.statSync(LOG_FILE).size; } catch (_) { return; }
  if (size < offset) { offset = 0; partial = ''; } // rotated or truncated
  if (size === offset) return;
  const fd = fs.openSync(LOG_FILE, 'r');
  const buf = Buffer.alloc(size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  offset = size;
  const text = partial + buf.toString('utf8');
  const lines = text.split('\n');
  partial = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_) { continue; }
    const msgs = process_(entry);
    remember(msgs);
    if (started) for (const m of msgs) broadcast(m.type, m);
  }
}
let started = false;
readNew(); // replay existing log silently into history
started = true;
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
try { fs.watch(path.dirname(LOG_FILE), () => readNew()); } catch (_) {}
setInterval(readNew, 500); // fallback for filesystems where fs.watch is unreliable

// ---------- HTTP ----------
const clients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15000);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
const LOCAL_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const server = http.createServer((req, res) => {
  // Defense against DNS-rebinding / cross-site reads: only local Host and Origin.
  if (!LOCAL_HOSTS.has(req.headers.host || '')) { res.writeHead(403); return res.end('forbidden'); }
  if (req.headers.origin && !['http://127.0.0.1:' + PORT, 'http://localhost:' + PORT].includes(req.headers.origin)) {
    res.writeHead(403); return res.end('forbidden');
  }
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`event: hello\ndata: ${JSON.stringify({ config, history, now: Date.now() })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ config, history, now: Date.now() }));
  }

  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(404); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
server.listen(PORT, HOST, () => console.log(`[office] AI Marketing Office → http://localhost:${PORT}  (log: ${path.relative(ROOT, LOG_FILE)})`));

module.exports = { routeAction, labelFor, buildReport };
