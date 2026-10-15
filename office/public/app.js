// AI Marketing Office: 3D view + side panel (team, chat, reports, activity).
// Work state (monitors, task labels, feed, reports) is driven only by server
// events from the Claude Code hook log and the chat relay; with no events,
// nobody is working. While the office is idle, people move around on their own
// (coffee, couch, chatting). That ambient motion never shows tasks or words,
// and stops the moment work arrives: everyone hurries back to their desk.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { M, box, label, rug, floorPlant } from './js/kit.js';
import { createPerson, animatePerson, lookFor } from './js/people.js';
import { ROOM_W, ROOM_D, teamRoom, breakRoom, bossOffice } from './js/rooms.js';
import { Nav } from './js/nav.js';

const IDLE_AFTER_MS = 120_000; // no events for 2 min → treat turn as over (e.g. interrupted, no Stop)
const OFF_DELAY_MS = 3_000;    // monitors stay on briefly after the turn ends
const MAX_FEED = 300;
const GAP = 2.8;               // corridor width between rooms
const WALK = 1.5, RUN = 11;    // m/s: idle stroll vs. hurrying back for a task
const CALM_MS = 10_000;        // quiet time after work before anyone wanders off
const MAX_AWAY = 3;            // at most this many people away from their desks

// ---------- state ----------
const state = {
  config: { divisions: [] },
  employees: new Map(), // "division/name" → desk record
  feed: [],
  reports: [],
  turnActive: false,
  turnActions: 0,
  lastEventTs: 0,
  clockSkew: 0,
  connected: false,
  token: null,
  chat: { messages: [], busy: false, queued: 0 },
  feedFilter: 'all',
};
const now = () => Date.now() + state.clockSkew;
const key = (div, name) => `${div}/${name}`;
const watchName = (id) => (state.config.watch || []).find((w) => w.id === id)?.name || id;

// ---------- scene setup ----------
const container = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
container.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#f7f4ef');
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.42;
controls.minDistance = 10;
controls.maxDistance = 110;

scene.add(new THREE.HemisphereLight('#fffaf2', '#e3dccf', 1.5));
const sun = new THREE.DirectionalLight('#fff6ea', 1.5);
sun.position.set(18, 34, 22);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 26, bottom: -26 });
sun.shadow.radius = 5;
sun.shadow.bias = -0.0004;
scene.add(sun);

const office = new THREE.Group();
scene.add(office);

// ---------- build office from config ----------
const agents = [];
let nav = null, breakSpots = null, bossRoom = null, bossAgent = null, managerAgent = null;
const bounds = { w: 30, zMin: -5, zMax: 10 };

// Fit the whole floor in view for the current aspect ratio, at a fixed tilt.
function frameCamera() {
  const tilt = THREE.MathUtils.degToRad(52);
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const depth = bounds.zMax - bounds.zMin;
  const dW = (bounds.w / 2) / Math.tan(hfov / 2);
  const dD = (depth * Math.sin(tilt) / 2 + 1) / Math.tan(vfov / 2) + depth * Math.cos(tilt) / 2;
  const dist = Math.max(dW, dD) * 1.02;
  const target = new THREE.Vector3(0, 0, (bounds.zMin + bounds.zMax) / 2);
  camera.position.set(0, Math.sin(tilt) * dist, target.z + Math.cos(tilt) * dist);
  controls.target.copy(target);
  controls.update();
}

// Room-local spot → world spot for a cell.
function worldSpot(cell, s, extra = {}) {
  const c = nav.centers[cell];
  return { ...s, cell, pos: s.pos.clone().add(c).setY(0), approach: s.approach.map((p) => p.clone().add(c).setY(0)), taken: null, ...extra };
}

function makeAgent(name, look, home, emp = null) {
  const person = createPerson(look);
  person.position.set(home.pos.x, home.y, home.pos.z);
  person.rotation.y = home.yaw;
  office.add(person);
  label('name-tag', name, person, -0.05); // at the feet, so it never hides the head
  person.userData.bubble = label('bubble hidden', '', person, 2.7);
  const a = { name, person, emp, home, at: home, dest: home, route: [], speed: WALK, activity: null, onArrive: null, talkWith: null, onDuty: false };
  home.taken = a;
  agents.push(a);
  return a;
}

function buildOffice(config) {
  office.clear();
  agents.length = 0;
  const old = state.employees;
  state.employees = new Map();
  const divs = config.divisions || [];
  // Grid: one cell per division, then the Break Room and your office.
  const cells = divs.length + 2;
  const cols = Math.ceil(Math.sqrt(cells));
  const rows = Math.ceil(cells / cols);
  const totalW = cols * ROOM_W + (cols - 1) * GAP;
  const totalD = rows * ROOM_D + (rows - 1) * GAP;
  const centers = Array.from({ length: cells }, (_, i) => new THREE.Vector3(
    -totalW / 2 + ROOM_W / 2 + (i % cols) * (ROOM_W + GAP), 0,
    -totalD / 2 + ROOM_D / 2 + Math.floor(i / cols) * (ROOM_D + GAP)));
  nav = new Nav({ cols, rows, gap: GAP, centers });

  office.add(box(totalW + 9, 0.2, totalD + 9, M.ground, 0, -0.1, 0.5, false));
  for (let r = 0; r < rows; r++) { // corridor runners and end plants
    const z = nav.lineZ(r);
    office.add(rug(totalW + 1.5, 1.5, '#d8ccba', '#c9b9a2').translateZ(z));
    for (const s of [-1, 1]) { const fp = floorPlant(r % 2 === 0); fp.position.set(s * (totalW / 2 + 3.2), 0, z); office.add(fp); }
  }

  const managerName = config.manager || 'Manager';
  managerAgent = null;
  divs.forEach((d, i) => {
    const room = new THREE.Group();
    room.position.copy(centers[i]);
    office.add(room);
    const desks = teamRoom(room, d, i * 3);
    for (const dk of desks) {
      const anchor = new THREE.Object3D();
      anchor.position.set(dk.x, 0, dk.z);
      room.add(anchor);
      const task = label('task-tag hidden', '', anchor, 2.35);
      task.obj.position.x = dk.labelOffset;
      const home = worldSpot(i, dk.seat);
      const a = makeAgent(dk.e.name, lookFor(dk.e.name, dk.e.name === managerName ? '#3d4f8f' : d.color), home);
      a.visitSpot = worldSpot(i, dk.visit);
      if (dk.e.name === managerName) managerAgent = a;
      const prev = old.get(key(d.id, dk.e.name));
      const emp = {
        division: d.id, divisionName: d.name, color: d.color, name: dk.e.name, role: dk.e.role || '',
        screenMat: dk.dk.screenMat, glowMat: dk.dk.glowMat, ledMat: dk.dk.ledMat, taskEl: task.el, agent: a,
        active: false, label: prev ? prev.label : '', flag: false, watch: null, lastTs: prev ? prev.lastTs : 0,
        offAt: 0, glow: 0,
      };
      a.emp = emp;
      state.employees.set(key(d.id, dk.e.name), emp);
    }
  });

  const bi = divs.length, oi = divs.length + 1;
  const br = new THREE.Group(); br.position.copy(centers[bi]); office.add(br);
  const bs = breakRoom(br);
  breakSpots = { counter: bs.counter.map((s) => worldSpot(bi, s)), table: bs.table.map((s) => worldSpot(bi, s)), couch: bs.couch.map((s) => worldSpot(bi, s)) };
  const or = new THREE.Group(); or.position.copy(centers[oi]); office.add(or);
  const bo = bossOffice(or);
  bossRoom = { screens: bo.screens, visitor: worldSpot(oi, bo.visitor) };
  bossAgent = makeAgent('You (Boss)', { ...lookFor('boss', '#f4f4f2'), jacket: '#26324a', tie: '#c0392b' }, worldSpot(oi, bo.bossSeat));

  lastBusy = now(); // give the page a calm moment before anyone wanders off
  Object.assign(bounds, { w: totalW + 3, zMin: -totalD / 2 - 0.5, zMax: totalD / 2 + 2.2 });
  frameCamera();
  renderAll();
}
// ---------- office events ----------
function onAction(a, replay) {
  state.lastEventTs = a.ts;
  state.turnActive = true;
  state.turnActions++;
  pushFeed(a);
  const emp = state.employees.get(key(a.division, a.employee));
  if (emp) {
    emp.active = true; emp.offAt = 0; emp.lastTs = a.ts;
    emp.label = a.label; emp.flag = !!a.flag; emp.watch = a.watch || null;
    applyTaskTag(emp);
    if (!replay) recall(emp.agent, true);
  }
  if (!replay) { recallAll(); renderPanel(); }
}
function onPrompt(p, replay) {
  state.lastEventTs = p.ts;
  state.turnActive = true;
  state.turnActions = 0;
  pushFeed(p);
  if (!replay) { say(bossAgent, 'New request →', false, 4000); recallAll(); }
}
function onStop(s, replay) {
  state.lastEventTs = s.ts;
  state.turnActive = false;
  pushFeed(s);
  for (const emp of state.employees.values()) if (emp.active) emp.offAt = replay ? 1 : now() + OFF_DELAY_MS;
}
function onReport(r, replay) {
  state.reports.push(r);
  if (state.reports.length > 100) state.reports.shift();
  if (!replay) {
    const ig = (r.watched || []).reduce((n, w) => n + w.count, 0);
    let short = r.actionCount === 0 ? 'Report: no actions this turn' : `Report: ${r.actionCount} action${r.actionCount === 1 ? '' : 's'}`;
    if (ig) short += ` · ${ig} IG update${ig === 1 ? '' : 's'}`;
    if (r.flags.length) short += ` · ⚠ ${r.flags.length} external`;
    walkManagerToBoss(short, r.flags.length > 0);
    renderPanel();
  }
}
function pushFeed(item) {
  state.feed.push(item);
  if (state.feed.length > MAX_FEED) state.feed.shift();
}
function applyTaskTag(emp) {
  emp.taskEl.textContent = emp.label;
  emp.taskEl.classList.toggle('flag', emp.flag);
  emp.taskEl.classList.toggle('ig', !emp.flag && !!emp.watch);
}

// ---------- chat ----------
const chatLog = document.getElementById('chat-log');
const input = document.getElementById('chat-input');
const sendBtn = document.getElementById('chat-send');
const stopBtn = document.getElementById('chat-stop');

async function api(path, body = {}) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Office-Token': state.token || '' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

function upsertChat(m) {
  const list = state.chat.messages;
  const i = list.findIndex((x) => x.id === m.id);
  if (i >= 0) list[i] = m; else list.push(m);
  renderChat();
}

document.getElementById('composer').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  recallAll(); // a task is being instructed: everyone back to their desks now
  sendBtn.disabled = true;
  try {
    await api('/api/chat/send', { text });
    input.value = '';
  } catch (e) {
    alert('Could not send: ' + e.message);
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
});
input.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); document.getElementById('composer').requestSubmit(); }
});
stopBtn.addEventListener('click', () => api('/api/chat/stop').catch((e) => alert(e.message)));
document.getElementById('chat-reset').addEventListener('click', () => {
  if (confirm('Start a new chat? The current conversation history will be cleared.')) api('/api/chat/reset').catch((e) => alert(e.message));
});

// Small, safe Markdown subset: escape first, then add formatting.
function md(src) {
  const blocks = String(src || '').split(/```/);
  return blocks.map((part, i) => {
    if (i % 2) return `<pre>${esc(part.replace(/^\w*\n/, ''))}</pre>`;
    const lines = esc(part).split('\n');
    let html = '', inList = false;
    for (const raw of lines) {
      let l = raw
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      const li = l.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
      if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${li[1]}</li>`; continue; }
      if (inList) { html += '</ul>'; inList = false; }
      const h = l.match(/^#{1,4}\s+(.*)/);
      if (h) { html += `<h4>${h[1]}</h4>`; continue; }
      html += l ? l + '<br>' : '<br>';
    }
    if (inList) html += '</ul>';
    return html.replace(/(<br>){3,}/g, '<br><br>');
  }).join('');
}

function renderChat() {
  const c = state.chat;
  const stEl = document.getElementById('chat-state');
  stEl.textContent = c.busy ? `Team is working…${c.queued ? ` · ${c.queued} queued` : ''}` : 'Ready';
  stEl.classList.toggle('busy', c.busy);
  stopBtn.hidden = !c.busy;
  if (!c.messages.length) {
    chatLog.innerHTML = '<div class="empty">Give the team an instruction, e.g. <em>"Find 3 trending topics about Indonesian street food and write hooks for them."</em><br><br>Messages go to Claude Code in this project. You can follow up, ask questions, or redirect while they work; new messages queue up and keep the same conversation.</div>';
    return;
  }
  const atBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 60;
  chatLog.innerHTML = c.messages.map((m) => {
    const time = hhmm(m.ts);
    if (m.role === 'user') {
      const st = m.status === 'queued' ? ' · queued' : m.status === 'cancelled' ? ' · cancelled' : '';
      return `<div class="msg user ${esc(m.status)}">${esc(m.text)}<div class="meta">${time}${st}</div></div>`;
    }
    const tools = (m.tools || []).map((t) => `<span class="tool-chip"><b style="color:${esc(colorOf(t.division))}">${esc(t.employee || '')}</b> ${esc(t.label)}</span>`).join('');
    const body = m.text ? md(m.text) : '';
    const typing = m.status === 'running' ? '<div class="typing"><i></i><i></i><i></i></div>' : '';
    const st = { error: ' · error', stopped: ' · stopped', interrupted: ' · interrupted (server restarted)' }[m.status] || '';
    return `<div class="msg assistant ${esc(m.status)}">${tools ? `<div class="tools">${tools}</div>` : ''}<div class="body">${body}</div>${typing}<div class="meta">Team · ${time}${st}</div></div>`;
  }).join('');
  if (atBottom) chatLog.scrollTop = chatLog.scrollHeight;
}

// ---------- connection ----------
const handlers = { action: onAction, prompt: onPrompt, stop: onStop, report: onReport };

function connect() {
  const es = new EventSource('/events');
  es.addEventListener('hello', (ev) => {
    const d = JSON.parse(ev.data);
    state.clockSkew = d.now - Date.now();
    state.token = d.token;
    state.feed = []; state.reports = []; state.turnActions = 0; state.turnActive = false;
    state.config = d.config;
    state.chat = d.chat || { messages: [], busy: false, queued: 0 };
    buildOffice(d.config);
    for (const m of d.history) handlers[m.type] && handlers[m.type](m, true);
    // After replay, anything that already ended, or went stale, is idle.
    for (const emp of state.employees.values()) {
      if (emp.offAt || now() - emp.lastTs > IDLE_AFTER_MS) { emp.active = false; emp.offAt = 0; }
    }
    if (now() - state.lastEventTs > IDLE_AFTER_MS) state.turnActive = false;
    state.connected = true;
    renderAll();
    chatLog.scrollTop = chatLog.scrollHeight;
  });
  for (const t of Object.keys(handlers)) es.addEventListener(t, (ev) => handlers[t](JSON.parse(ev.data), false));
  es.addEventListener('config', (ev) => { state.config = JSON.parse(ev.data); buildOffice(state.config); });
  es.addEventListener('chat', (ev) => upsertChat(JSON.parse(ev.data)));
  es.addEventListener('chat-state', (ev) => { Object.assign(state.chat, JSON.parse(ev.data)); if (state.chat.busy) recallAll(); renderChat(); });
  es.addEventListener('chat-reset', (ev) => { state.chat = JSON.parse(ev.data); renderChat(); });
  es.onerror = () => { state.connected = false; renderStatus(); };
  es.onopen = () => { state.connected = true; renderStatus(); };
}

// ---------- characters ----------
function say(a, text, flag, ms) {
  if (!a) return;
  const b = a.person.userData.bubble;
  b.el.textContent = text;
  b.el.classList.toggle('flag', !!flag);
  b.el.classList.remove('hidden');
  b.until = performance.now() + ms;
}

// Send an agent somewhere along corridors and through doors.
function goTo(a, dest, { hurry = false, pace = WALK, onArrive = null } = {}) {
  if (!nav || !a) return;
  const exit = a.at ? [...a.at.approach].reverse() : [];
  if (a.at && a.at !== a.home && a.at.taken === a) a.at.taken = null;
  if (a.dest && a.dest !== a.home && a.dest !== dest && a.dest.taken === a) a.dest.taken = null;
  a.route = a.at === dest ? [] : nav.route(a.person.position, exit, dest);
  a.at = a.route.length ? null : dest;
  a.dest = dest;
  if (dest !== a.home) dest.taken = a;
  a.speed = hurry ? RUN : pace;
  a.onArrive = onArrive;
  if (!a.route.length && onArrive) { a.onArrive = null; onArrive(); }
}

function stopTalking(a) {
  if (a.talkWith) { a.talkWith.talkWith = null; a.talkWith = null; }
}

// Back to the desk. Hurry when work has arrived.
function recall(a, hurry) {
  if (!a || a === bossAgent || a.onDuty) return;
  a.activity = null;
  stopTalking(a);
  if (a.at === a.home) return;
  if (a.dest === a.home && a.route.length) { if (hurry) a.speed = RUN; return; }
  goTo(a, a.home, { hurry });
}
function recallAll() { for (const a of agents) recall(a, true); }

function walkManagerToBoss(text, flag) {
  const m = managerAgent;
  if (!m || !bossRoom) return;
  m.activity = null;
  stopTalking(m);
  m.onDuty = true;
  goTo(m, bossRoom.visitor, {
    pace: 3.2,
    onArrive: () => {
      say(m, text, flag, 7000);
      setTimeout(() => { m.onDuty = false; goTo(m, m.home); }, 7000);
    },
  });
}

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Ambient life while nobody is working: coffee, couch, table, desk visits.
// Purely visual: it never touches tasks, the feed, reports, or the status pill.
let lastBusy = 0;
function behave() {
  if (!nav) return;
  const t = now();
  const busy = state.turnActive || state.chat.busy || t - state.lastEventTs < 6000;
  if (busy) { lastBusy = t; recallAll(); return; }
  if (t - lastBusy < CALM_MS) return;
  for (const a of agents) {
    if (a.activity && a.at && t > a.activity.until) recall(a, false);
  }
  const away = agents.filter((a) => a.activity).length;
  if (away >= MAX_AWAY || Math.random() > 0.3) return;
  const free = agents.filter((a) => a.emp && a.at === a.home && !a.onDuty && !a.activity && !a.talkWith && !a.emp.active);
  if (!free.length) return;
  const a = pick(free);
  const kind = pick(['coffee', 'coffee', 'couch', 'table', 'table', 'visit', 'visit']);
  const stay = (min, max) => () => { if (a.activity) a.activity.until = now() + rand(min, max) * 1000; };
  if (kind === 'visit') {
    const host = pick(free.filter((h) => h !== a && h.visitSpot && !h.visitSpot.taken));
    if (!host) return;
    a.activity = { kind, until: Infinity };
    goTo(a, host.visitSpot, { onArrive: () => {
      if (host.at !== host.home || host.talkWith || host.emp.active) { recall(a, false); return; }
      a.talkWith = host; host.talkWith = a;
      stay(7, 12)();
    } });
    return;
  }
  const options = (breakSpots[kind === 'coffee' ? 'counter' : kind] || []).filter((s) => !s.taken);
  if (!options.length) return;
  a.activity = { kind, until: Infinity };
  goTo(a, pick(options), { onArrive: kind === 'coffee' ? stay(8, 14) : stay(14, 24) });
}

// Who is currently chatting: desk visits, plus people sharing the table,
// couch or counter. Only a 💬 bubble is shown, never invented words.
function chatting(a, t) {
  if (a.talkWith) return true;
  if (!a.activity || !a.at || !breakSpots) return false;
  for (const group of Object.values(breakSpots)) {
    if (group.includes(a.at) && group.some((s) => s !== a.at && s.taken && s.taken.at === s)) return true;
  }
  return false;
}

function updateAgent(a, t, dt, moveDt = dt) {
  const p = a.person;
  let mode;
  if (a.route.length) {
    const tgt = a.route[0];
    const dx = tgt.x - p.position.x, dz = tgt.z - p.position.z;
    const dist = Math.hypot(dx, dz);
    const step = a.speed * moveDt;
    if (dist <= Math.max(step, 0.02)) {
      p.position.x = tgt.x; p.position.z = tgt.z;
      a.route.shift();
      if (!a.route.length) {
        a.at = a.dest;
        if (a.onArrive) { const f = a.onArrive; a.onArrive = null; f(); }
      }
    } else {
      p.position.x += (dx / dist) * step;
      p.position.z += (dz / dist) * step;
      turnToward(p, Math.atan2(dx, dz), dt * 12);
    }
    p.position.y += (0 - p.position.y) * Math.min(1, dt * 10);
    mode = 'walk';
  }
  if (!a.route.length && a.at) {
    const s = a.at;
    p.position.y += (s.y - p.position.y) * Math.min(1, dt * 8);
    let yaw = s.yaw;
    if (a.talkWith && s.mode !== 'sit') yaw = Math.atan2(a.talkWith.person.position.x - p.position.x, a.talkWith.person.position.z - p.position.z);
    turnToward(p, yaw, dt * 8);
    if (s === a.home) mode = a.emp && a.emp.active ? 'type' : (a === bossAgent && (state.turnActive || state.chat.busy) ? 'type' : 'sit');
    else mode = s.mode === 'talk' || (s.mode === 'stand' && chatting(a, t)) ? 'talk' : s.mode;
  }
  animatePerson(p, mode || 'stand', t, dt, a.speed > WALK ? 1.6 : 1);

  // bubbles: real messages (say) win; otherwise an ambient 💬 while chatting
  const b = p.userData.bubble;
  if (b.until && performance.now() < b.until) return;
  if (b.until) { b.until = 0; b.el.classList.add('hidden'); }
  const talk = !a.onDuty && a !== bossAgent && chatting(a, t) && Math.floor(t / 2.2 + (a.talkWith ? (a.name < a.talkWith.name ? 0 : 1) : p.userData.phase)) % 2 === 0;
  if (talk) { if (b.el.textContent !== '💬') b.el.textContent = '💬'; b.el.classList.remove('flag'); }
  b.el.classList.toggle('hidden', !talk);
}

function turnToward(obj, yaw, k) {
  let d = yaw - obj.rotation.y;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  obj.rotation.y += d * Math.min(1, k);
}

// ---------- panel ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmmss = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const hhmm = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const colorOf = (divId) => (state.config.divisions || []).find((d) => d.id === divId)?.color || '#9aa3b5';

function renderStatus() {
  const el = document.getElementById('status');
  if (!state.connected) { el.className = 'pill offline'; el.textContent = 'Disconnected from server'; return; }
  const active = [...state.employees.values()].filter((e) => e.active).length;
  if (state.turnActive) {
    el.className = 'pill working';
    el.textContent = `Working · ${state.turnActions} action${state.turnActions === 1 ? '' : 's'} this turn` + (active ? ` · ${active} at desks` : '');
  } else {
    el.className = 'pill idle';
    el.textContent = 'Idle · waiting for work';
  }
}

function renderTeam() {
  document.getElementById('team').innerHTML = (state.config.divisions || []).map((d) => {
    const rows = (d.employees || []).map((e) => {
      const emp = state.employees.get(key(d.id, e.name));
      const on = emp && emp.active;
      return `<div class="emp ${on ? 'on' : ''}" title="${esc(e.role)}"><span class="light"></span><span class="nm">${esc(e.name)}</span><span class="task">${esc(on ? emp.label : e.role || 'idle')}</span></div>`;
    }).join('');
    return `<div class="room"><div class="div-name"><span class="dot" style="background:${esc(d.color)}"></span>${esc(d.name)}</div>${rows}</div>`;
  }).join('');
}

function renderFeed() {
  const actions = state.feed.filter((f) => f.type === 'action');
  const ig = actions.filter((f) => f.watch).length;
  document.getElementById('activity-count').textContent = actions.length;
  const igEl = document.getElementById('ig-count');
  igEl.hidden = !ig; igEl.textContent = `IG ${ig}`;
  let items = state.feed.slice().reverse();
  if (state.feedFilter === 'ig') items = items.filter((f) => f.watch);
  const el = document.getElementById('activity-list');
  if (!items.length) {
    el.innerHTML = state.feedFilter === 'ig'
      ? '<div class="empty">No ROI Instagram updates yet. File changes in instagram/, metrics/, templates/ or drafts/ (or files named ig_…, reel, carousel) show up here.</div>'
      : '<div class="empty">No activity yet. Actions appear here the moment Claude Code uses a tool in this project.</div>';
    return;
  }
  el.innerHTML = items.map((f) => {
    if (f.type === 'prompt') return `<div class="feed-item prompt"><time>${hhmmss(f.ts)}</time><span>New request from you</span></div>`;
    if (f.type === 'stop') return `<div class="feed-item stop"><time>${hhmmss(f.ts)}</time><span>Turn finished · Manager filed a report</span></div>`;
    const who = f.employee ? `<span class="who" style="color:${esc(colorOf(f.division))}">${esc(f.employee)}</span>` : '';
    const badge = f.flag ? `<span class="badge">⚠ ${esc(f.flag)}</span>` : '';
    const igTag = f.watch ? `<span class="ig-tag">${esc(watchName(f.watch))}</span><br>` : '';
    const path = f.watch && f.file ? ` <span style="color:var(--muted)">(${esc(f.file)})</span>` : '';
    return `<div class="feed-item ${f.watch ? 'ig' : ''}"><time>${hhmmss(f.ts)}</time><span>${igTag}${who}${esc(f.label)}${path}${badge}</span></div>`;
  }).join('');
}

function renderReports() {
  document.getElementById('reports-count').textContent = state.reports.length;
  const el = document.getElementById('reports');
  if (!state.reports.length) { el.innerHTML = '<div class="empty">No reports yet. When Claude finishes a response, the Manager summarizes who did what during that turn.</div>'; return; }
  el.innerHTML = state.reports.slice().reverse().map((r) => {
    const dur = r.durationMs != null ? ` · ${Math.max(1, Math.round(r.durationMs / 1000))}s` : '';
    const lines = r.lines.map((l) => `<li><span class="who" style="color:${esc(colorOf(l.division))}">${esc(l.employee)}</span>${esc(l.text)}</li>`).join('');
    const watched = (r.watched || []).map((w) => `<div>📸 ${esc(w.name)}: ${w.count} change${w.count === 1 ? '' : 's'} (${esc(w.files.slice(0, 4).join(', '))}${w.files.length > 4 ? ', …' : ''})</div>`).join('');
    const flags = r.flags.length ? `<div class="flags">${r.flags.map((f) => `<div>⚠ ${esc(f.text)}</div>`).join('')}</div>` : '';
    return `<article class="report ${r.flags.length ? 'has-flags' : ''}"><header><span>Manager → You</span><span>${hhmmss(r.ts)}${dur}</span></header>
      <div class="summary">${esc(r.summary)}</div><ul>${lines}</ul>${watched ? `<div class="watched">${watched}</div>` : ''}${flags}</article>`;
  }).join('');
}

function renderPanel() { renderStatus(); renderTeam(); renderFeed(); renderReports(); }
function renderAll() {
  for (const emp of state.employees.values()) applyTaskTag(emp);
  renderPanel();
  renderChat();
}

document.getElementById('tabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  for (const x of document.querySelectorAll('#tabs button')) x.classList.toggle('active', x === b);
  for (const x of document.querySelectorAll('.tab')) x.classList.toggle('active', x.id === b.dataset.tab);
});
document.querySelector('.filters').addEventListener('click', (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  state.feedFilter = b.dataset.filter;
  for (const x of document.querySelectorAll('.filters .chip')) x.classList.toggle('active', x === b);
  renderFeed();
});

// ---------- loop ----------
function resize() {
  const w = container.clientWidth, h = container.clientHeight;
  renderer.setSize(w, h); labelRenderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  frameCamera();
}
window.addEventListener('resize', resize);

const clock = new THREE.Clock();
let lastCheck = 0, lastBehave = 0;
function tick() {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.1);       // pose/fade blending
  const moveDt = Math.min(rawDt, 0.5);   // walking uses real time, so slow machines don't slow people down
  const t = clock.elapsedTime;
  const tNow = now();

  // Turn off monitors after the turn ends, or when no events arrive for a while.
  if (t - lastCheck > 0.5) {
    lastCheck = t;
    let changed = false;
    for (const emp of state.employees.values()) {
      if (emp.active && ((emp.offAt && tNow >= emp.offAt) || tNow - emp.lastTs > IDLE_AFTER_MS)) { emp.active = false; emp.offAt = 0; changed = true; }
    }
    if (state.turnActive && tNow - state.lastEventTs > IDLE_AFTER_MS) { state.turnActive = false; changed = true; }
    if (changed) renderPanel();
  }
  if (t - lastBehave > 1) { lastBehave = t; behave(); }

  for (const emp of state.employees.values()) {
    emp.glow += ((emp.active ? 1 : 0) - emp.glow) * Math.min(1, dt * 6);
    emp.screenMat.emissiveIntensity = emp.glow * 0.95;
    emp.glowMat.opacity = emp.glow * 0.22;
    emp.ledMat.color.set(emp.active ? '#34d399' : '#c9ced8');
    emp.taskEl.classList.toggle('hidden', !emp.active);
  }
  for (const a of agents) updateAgent(a, t, dt, moveDt);
  if (bossRoom) {
    const k = state.turnActive || state.chat.busy ? 0.8 : 0;
    for (const s of bossRoom.screens) s.emissiveIntensity += (k - s.emissiveIntensity) * Math.min(1, dt * 4);
  }

  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(tick);
}

// Read-only handle for debugging/tests: who is where.
window.__office = { agents: () => agents.map((a) => ({ name: a.name, home: a.at === a.home, walking: a.route.length > 0, activity: a.activity && a.activity.kind, talking: !!a.talkWith, onDuty: a.onDuty })) };

resize();
renderPanel();
renderChat();
connect();
tick();
