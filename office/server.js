#!/usr/bin/env node
// AI Marketing Office server. Plain Node, no dependencies.
// - Tails .office/activity.log (written by hooks/log-action.js)
// - Routes each action to an employee using office-config.json
// - On every Stop event, builds the Manager's report for that turn
// - Streams everything to the browser over Server-Sent Events
// - Relays the chat panel to Claude Code (see chat.js)
// Listens on 127.0.0.1 only, and rejects requests whose Host/Origin is not local.
// State-changing requests (POST) also need a per-start random token that only
// a page served by this server can read.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { Chat } = require('./chat');

const ROOT = path.resolve(__dirname, '..');
const LOG_FILE = process.env.OFFICE_LOG ? path.resolve(process.env.OFFICE_LOG) : path.join(ROOT, '.office', 'activity.log');
const CONFIG_FILE = path.join(ROOT, 'office-config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const HOST = '127.0.0.1';
const PORT = Number(process.env.OFFICE_PORT) || 4317;
const HISTORY = 400; // entries replayed to a newly opened page
const CHAT_FILE = process.env.OFFICE_CHAT_FILE ? path.resolve(process.env.OFFICE_CHAT_FILE) : path.join(ROOT, '.office', 'chat.json');
const TOKEN = crypto.randomBytes(24).toString('hex');
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

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

const lc = (x) => String(x).toLowerCase();
const inFolder = (path_, folder) => folder !== '*' && (path_ === lc(folder).replace(/\/$/, '') || path_.startsWith(lc(folder).replace(/\/$/, '') + '/'));
const hasKeyword = (e, base) => !!base && (e.keywords || []).some((k) => base.includes(lc(k)));

// Routing, in order:
//  1. the file sits in a division's folder → that division's keyword match, else its `default`, else its first employee
//  2. the file name contains an employee's keyword (any division)
//  3. the tool is in an employee's `tools` list (trailing * = prefix wildcard)
//  4. the config's `fallback` employee (or the first employee)
function routeAction(entry) {
  const divs = config.divisions || [];
  const all = divs.flatMap((d) => (d.employees || []).map((e) => ({ d, e })));
  if (!all.length) return null;
  const file = entry.file && entry.file !== '.' ? lc(entry.file) : null;
  const base = file ? file.split('/').pop() : '';
  let pick = null;
  if (file && !entry.outside) {
    const div = divs.find((d) => (d.folders || []).some((f) => inFolder(file, f)));
    if (div) {
      const emps = div.employees || [];
      const e = emps.find((x) => hasKeyword(x, base)) || emps.find((x) => x.name === div.default) || emps[0];
      if (e) pick = { d: div, e };
    }
    if (!pick) pick = all.find(({ e }) => hasKeyword(e, base));
  }
  if (!pick) pick = all.find(({ e }) => toolMatches(e, entry.tool));
  if (!pick) pick = all.find(({ e }) => e.name === config.fallback);
  if (!pick) {
    const star = divs.find((d) => (d.folders || []).includes('*'));
    pick = star && star.employees && star.employees.length ? { d: star, e: star.employees[0] } : all[0];
  }
  return { division: pick.d.id, employee: pick.e.name };
}

// Watch rules (config.watch): file *changes* whose path contains one of the
// rule's folders as a path segment, or whose name contains one of its keywords.
function matchWatch(entry) {
  if (!entry.file || entry.outside || !WRITE_TOOLS.has(entry.tool)) return null;
  const segs = lc(entry.file).split('/');
  const base = segs[segs.length - 1];
  for (const w of config.watch || []) {
    const folderHit = (w.folders || []).some((f) => segs.slice(0, -1).includes(lc(f)));
    const kwHit = (w.keywords || []).some((k) => base.includes(lc(k)));
    if (folderHit || kwHit) return w.id;
  }
  return null;
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
  const watched = (config.watch || []).map((w) => {
    const hits = acts.filter((a) => a.watch === w.id);
    return { id: w.id, name: w.name, count: hits.length, files: [...new Set(hits.map((a) => a.file))] };
  }).filter((w) => w.count);
  const summary = acts.length === 0
    ? 'No tool actions this turn. Claude answered directly.'
    : `${acts.length} action${acts.length === 1 ? '' : 's'} by ${lines.length} team member${lines.length === 1 ? '' : 's'}` +
      (flags.length ? `. ⚠ ${flags.length} action${flags.length === 1 ? '' : 's'} reached outside this folder.` : '. Everything stayed inside this folder.');
  return {
    type: 'report', ts: stopTs, start: turn.start, durationMs: turn.start ? stopTs - turn.start : null,
    actionCount: acts.length, summary, lines, flags, watched,
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
      label: labelFor(entry), watch: matchWatch(entry),
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

const chat = new Chat({
  root: ROOT, stateFile: CHAT_FILE, broadcast, getConfig: () => config,
  describeTool: (name, input) => {
    const target = input.file_path || input.notebook_path || input.path;
    let file = null;
    if (typeof target === 'string' && target) {
      const rel = path.relative(ROOT, path.resolve(ROOT, target));
      file = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : path.basename(target);
    }
    const r = routeAction({ tool: name, file }) || {};
    return { tool: name, employee: r.employee || null, division: r.division || null, label: labelFor({ tool: name, file }) };
  },
});

function readJson(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

async function handlePost(req, res, pathname) {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const tok = String(req.headers['x-office-token'] || '');
  if (tok.length !== TOKEN.length || !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(TOKEN))) return send(403, { error: 'bad token' });
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(415, { error: 'json only' });
  let body;
  try { body = await readJson(req); } catch (_) { return send(400, { error: 'bad body' }); }
  if (pathname === '/api/chat/send') {
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 8000) return send(400, { error: 'message must be 1-8000 characters' });
    return send(200, { ok: true, message: chat.send(text) });
  }
  if (pathname === '/api/chat/stop') { chat.stop(); return send(200, { ok: true }); }
  if (pathname === '/api/chat/reset') { chat.reset(); return send(200, { ok: true }); }
  send(404, { error: 'not found' });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
const LOCAL_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const server = http.createServer((req, res) => {
  // Defense against DNS-rebinding / cross-site reads: only local Host and Origin.
  if (!LOCAL_HOSTS.has(req.headers.host || '')) { res.writeHead(403); return res.end('forbidden'); }
  if (req.headers.origin && !['http://127.0.0.1:' + PORT, 'http://localhost:' + PORT].includes(req.headers.origin)) {
    res.writeHead(403); return res.end('forbidden');
  }
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname.startsWith('/api/')) return void handlePost(req, res, url.pathname);
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }

  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`event: hello\ndata: ${JSON.stringify({ config, history, now: Date.now(), token: TOKEN, chat: chat.snapshot() })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ config, history, now: Date.now(), chat: chat.snapshot() }));
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
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `[office] Port ${PORT} is already in use. Is the office already running? Use OFFICE_PORT=xxxx to pick another port.` : `[office] ${e.message}`);
  process.exit(1);
});
server.listen(PORT, HOST, () => console.log(`[office] AI Marketing Office → http://localhost:${PORT}  (log: ${path.relative(ROOT, LOG_FILE)})`));

module.exports = { routeAction, labelFor, buildReport, matchWatch };
