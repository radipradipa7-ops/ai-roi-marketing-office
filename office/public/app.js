// AI Marketing Office: 3D view + side panel.
// Everything shown here is driven by events from the server (which come from
// the Claude Code hook log). Nothing is randomized: with no events, the office
// stays idle.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const IDLE_AFTER_MS = 120_000; // no events for 2 min → treat turn as over (e.g. interrupted, no Stop)
const OFF_DELAY_MS = 3_000;    // monitors stay on briefly after the turn ends
const MAX_FEED = 300;

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
};
const now = () => Date.now() + state.clockSkew;
const key = (div, name) => `${div}/${name}`;

// ---------- scene setup ----------
const container = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.inset = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
container.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#f5f7fb');
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.42;
controls.minDistance = 15;
controls.maxDistance = 90;

scene.add(new THREE.HemisphereLight('#ffffff', '#dfe4ee', 1.6));
const sun = new THREE.DirectionalLight('#ffffff', 1.4);
sun.position.set(18, 30, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40 });
sun.shadow.radius = 4;
scene.add(sun);

const office = new THREE.Group();
scene.add(office);

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
const M = {
  floor: mat('#ffffff'),
  wall: mat('#ffffff', { transparent: true, opacity: 0.55 }),
  desk: mat('#e9dcc9', { roughness: 0.6 }),
  leg: mat('#c9cfda'),
  monitor: mat('#2b313c', { roughness: 0.4 }),
  chair: mat('#d3d8e2'),
  skin: mat('#f1cfb3'),
};

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function label(className, text, parent, y) {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  const obj = new CSS2DObject(el);
  obj.position.set(0, y, 0);
  parent.add(obj);
  return { el, obj };
}

function person(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.55, 4, 12), mat(color));
  body.position.y = 0.95; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 20, 16), M.skin);
  head.position.y = 1.75; head.castShadow = true;
  g.add(body, head);
  g.userData.head = head;
  return g;
}

// A desk with monitor and seated employee. The screen faces the camera (+z);
// the employee sits on the +z side with their back to us, looking at it.
function desk(color) {
  const g = new THREE.Group();
  g.add(box(2.2, 0.08, 1.1, M.desk, 0, 0.78, 0));
  for (const [x, z] of [[-1, -0.45], [1, -0.45], [-1, 0.45], [1, 0.45]]) g.add(box(0.06, 0.78, 0.06, M.leg, x, 0.39, z));
  g.add(box(0.1, 0.3, 0.1, M.monitor, 0, 0.97, -0.25));
  g.add(box(1.1, 0.7, 0.07, M.monitor, 0, 1.45, -0.25));
  const screenMat = new THREE.MeshStandardMaterial({ color: '#3a414e', emissive: new THREE.Color(color), emissiveIntensity: 0, roughness: 0.3 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.6), screenMat);
  screen.position.set(0, 1.45, -0.21);
  g.add(screen);
  g.add(box(0.7, 0.08, 0.7, M.chair, 0, 0.5, 1.0));
  const p = person(color);
  p.position.set(0, -0.15, 1.05);
  p.rotation.y = Math.PI; // facing the monitor
  g.add(p);
  return { group: g, screenMat, figure: p };
}

// ---------- build office from config ----------
const ROOM_W = 11, ROOM_D = 8, GAP = 2.2;
let manager, boss, managerHome, bossDeskPos;

function buildOffice(config) {
  office.clear();
  const old = state.employees;
  state.employees = new Map();
  const divs = config.divisions || [];
  const cols = divs.length <= 2 ? divs.length : divs.length <= 4 ? 2 : 3;
  const rows = Math.ceil(divs.length / Math.max(cols, 1));
  const totalW = cols * ROOM_W + (cols - 1) * GAP;
  const totalD = rows * ROOM_D + (rows - 1) * GAP;
  const lobbyD = 7;

  const ground = box(totalW + 6, 0.2, totalD + lobbyD + 6, M.floor, 0, -0.1, lobbyD / 2);
  ground.castShadow = false;
  office.add(ground);

  divs.forEach((d, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const cx = -totalW / 2 + ROOM_W / 2 + c * (ROOM_W + GAP);
    const cz = -totalD / 2 + ROOM_D / 2 + r * (ROOM_D + GAP);
    const room = new THREE.Group();
    room.position.set(cx, 0, cz);
    office.add(room);

    const tint = new THREE.Color(d.color || '#9aa7c7').lerp(new THREE.Color('#ffffff'), 0.82);
    const floor = box(ROOM_W, 0.04, ROOM_D, mat(tint), 0, 0.02, 0);
    floor.castShadow = false;
    room.add(floor);
    const wh = 1.1;
    room.add(box(ROOM_W, wh, 0.12, M.wall, 0, wh / 2, -ROOM_D / 2));
    room.add(box(0.12, wh, ROOM_D, M.wall, -ROOM_W / 2, wh / 2, 0));
    room.add(box(0.12, wh, ROOM_D, M.wall, ROOM_W / 2, wh / 2, 0));
    room.add(box(ROOM_W * 0.3, wh * 0.5, 0.12, M.wall, -ROOM_W * 0.35, wh / 4, ROOM_D / 2));
    room.add(box(ROOM_W * 0.3, wh * 0.5, 0.12, M.wall, ROOM_W * 0.35, wh / 4, ROOM_D / 2));
    const tagAnchor = new THREE.Object3D();
    tagAnchor.position.set(0, 1.6, -ROOM_D / 2);
    room.add(tagAnchor);
    label('room-tag', d.name, tagAnchor, 0);

    const emps = d.employees || [];
    const perRow = Math.min(emps.length, 3);
    emps.forEach((e, j) => {
      const dr = Math.floor(j / 3), dc = j % 3;
      const n = Math.min(perRow, emps.length - dr * 3);
      const x = (dc - (n - 1) / 2) * 3.4;
      const z = -1.4 + dr * 3.2;
      const dk = desk(d.color || '#7c9cff');
      dk.group.position.set(x, 0, z);
      room.add(dk.group);
      const anchor = new THREE.Object3D();
      anchor.position.set(x, 0, z);
      room.add(anchor);
      const nameTag = label('name-tag', e.name, anchor, 0.25);
      nameTag.obj.position.z = 1.9;
      const task = label('task-tag hidden', '', anchor, 2.35);
      const prev = old.get(key(d.id, e.name));
      state.employees.set(key(d.id, e.name), {
        division: d.id, divisionName: d.name, color: d.color, name: e.name, role: e.role || '',
        screenMat: dk.screenMat, figure: dk.figure, taskEl: task.el,
        active: false, label: prev ? prev.label : '', flag: false, lastTs: prev ? prev.lastTs : 0,
        offAt: 0, glow: 0,
      });
    });
  });

  // Lobby: the boss's desk and the Manager.
  const lobbyZ = totalD / 2 + lobbyD / 2 + 0.5;
  bossDeskPos = new THREE.Vector3(0, 0, lobbyZ);
  const bossDesk = new THREE.Group();
  bossDesk.add(box(3.2, 0.1, 1.4, mat('#cdb79a', { roughness: 0.5 }), 0, 0.8, 0));
  bossDesk.add(box(3.0, 0.75, 0.08, mat('#bba387'), 0, 0.38, 0.6));
  bossDesk.position.copy(bossDeskPos);
  office.add(bossDesk);
  boss = person('#2f3a4f');
  boss.position.set(0, 0, lobbyZ - 1.1);
  boss.add(box(0.8, 0.9, 0.15, M.chair, 0, 0.9, -0.45)); // chair back
  office.add(boss);
  label('name-tag', 'You (Boss)', boss, 2.35);
  boss.userData.bubble = label('bubble hidden', '', boss, 2.95);

  managerHome = new THREE.Vector3(-4.5, 0, lobbyZ - 0.5);
  manager = person('#4f7cff');
  manager.position.copy(managerHome);
  office.add(manager);
  label('name-tag', 'Manager', manager, 2.35);
  manager.userData.bubble = label('bubble hidden', '', manager, 2.95);
  manager.userData.target = managerHome.clone();

  const span = Math.max(totalW, totalD + lobbyD);
  camera.position.set(0, span * 0.95, span * 1.0 + lobbyD);
  controls.target.set(0, 0, lobbyD / 3);
  controls.update();
  renderAll();
}

// ---------- event handling ----------
function onAction(a, replay) {
  state.lastEventTs = a.ts;
  state.turnActive = true;
  state.turnActions++;
  pushFeed(a);
  const emp = state.employees.get(key(a.division, a.employee));
  if (emp) {
    emp.active = true; emp.offAt = 0; emp.lastTs = a.ts;
    emp.label = a.label; emp.flag = !!a.flag;
    emp.taskEl.textContent = a.label;
    emp.taskEl.classList.toggle('flag', emp.flag);
  }
  if (!replay) renderPanel();
}
function onPrompt(p, replay) {
  state.lastEventTs = p.ts;
  state.turnActive = true;
  state.turnActions = 0;
  pushFeed(p);
  if (!replay) say(boss, 'New request →', false, 4000);
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
    const short = r.actionCount === 0 ? 'Report: no actions this turn' :
      `Report: ${r.actionCount} action${r.actionCount === 1 ? '' : 's'}` + (r.flags.length ? ` · ⚠ ${r.flags.length} external` : '');
    walkManagerToBoss(short, r.flags.length > 0);
    renderPanel();
  }
}
function pushFeed(item) {
  state.feed.push(item);
  if (state.feed.length > MAX_FEED) state.feed.shift();
}

const handlers = { action: onAction, prompt: onPrompt, stop: onStop, report: onReport };

function connect() {
  const es = new EventSource('/events');
  es.addEventListener('hello', (ev) => {
    const d = JSON.parse(ev.data);
    state.clockSkew = d.now - Date.now();
    state.feed = []; state.reports = []; state.turnActions = 0; state.turnActive = false;
    state.config = d.config;
    buildOffice(d.config);
    for (const m of d.history) handlers[m.type] && handlers[m.type](m, true);
    // After replay, anything that already ended, or went stale, is idle.
    for (const emp of state.employees.values()) {
      if (emp.offAt || now() - emp.lastTs > IDLE_AFTER_MS) { emp.active = false; emp.offAt = 0; }
    }
    if (now() - state.lastEventTs > IDLE_AFTER_MS) state.turnActive = false;
    state.connected = true;
    renderAll();
  });
  for (const t of Object.keys(handlers)) es.addEventListener(t, (ev) => handlers[t](JSON.parse(ev.data), false));
  es.addEventListener('config', (ev) => { state.config = JSON.parse(ev.data); buildOffice(state.config); });
  es.onerror = () => { state.connected = false; renderStatus(); };
  es.onopen = () => { state.connected = true; renderStatus(); };
}

// ---------- characters ----------
function say(who, text, flag, ms) {
  const b = who.userData.bubble;
  b.el.textContent = text;
  b.el.classList.toggle('flag', !!flag);
  b.el.classList.remove('hidden');
  clearTimeout(b.timer);
  b.timer = setTimeout(() => b.el.classList.add('hidden'), ms);
}
function walkManagerToBoss(text, flag) {
  manager.userData.target = bossDeskPos.clone().add(new THREE.Vector3(-1.2, 0, 1.4));
  manager.userData.onArrive = () => {
    say(manager, text, flag, 7000);
    setTimeout(() => { manager.userData.target = managerHome.clone(); }, 7000);
  };
}

// ---------- panel ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmmss = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
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
  const html = (state.config.divisions || []).map((d) => {
    const rows = (d.employees || []).map((e) => {
      const emp = state.employees.get(key(d.id, e.name));
      const on = emp && emp.active;
      const task = on ? emp.label : 'idle';
      return `<div class="emp ${on ? 'on' : ''}" title="${esc(e.role)}"><span class="light"></span><span class="nm">${esc(e.name)}</span><span class="task">${esc(task)}</span></div>`;
    }).join('');
    return `<div class="div-name"><span class="dot" style="background:${esc(d.color)}"></span>${esc(d.name)}</div>${rows}`;
  }).join('');
  document.getElementById('team').innerHTML = html;
}

function renderFeed() {
  const items = state.feed.slice().reverse();
  document.getElementById('activity-count').textContent = state.feed.filter((f) => f.type === 'action').length;
  const el = document.getElementById('activity');
  if (!items.length) { el.innerHTML = '<div class="empty">No activity yet. Actions appear here the moment Claude Code uses a tool in this project.</div>'; return; }
  el.innerHTML = items.map((f) => {
    if (f.type === 'prompt') return `<div class="feed-item prompt"><time>${hhmmss(f.ts)}</time><span>New request from you</span></div>`;
    if (f.type === 'stop') return `<div class="feed-item stop"><time>${hhmmss(f.ts)}</time><span>Turn finished · Manager filed a report</span></div>`;
    const who = f.employee ? `<span class="who" style="color:${esc(colorOf(f.division))}">${esc(f.employee)}</span>` : '';
    const badge = f.flag ? `<span class="badge">⚠ ${esc(f.flag)}</span>` : '';
    return `<div class="feed-item"><time>${hhmmss(f.ts)}</time><span>${who}${esc(f.label)}${badge}</span></div>`;
  }).join('');
}

function renderReports() {
  document.getElementById('reports-count').textContent = state.reports.length;
  const el = document.getElementById('reports');
  if (!state.reports.length) { el.innerHTML = '<div class="empty">No reports yet. When Claude finishes a response, the Manager summarizes who did what during that turn.</div>'; return; }
  el.innerHTML = state.reports.slice().reverse().map((r) => {
    const dur = r.durationMs != null ? ` · ${Math.max(1, Math.round(r.durationMs / 1000))}s` : '';
    const lines = r.lines.map((l) => `<li><span class="who" style="color:${esc(colorOf(l.division))}">${esc(l.employee)}</span>${esc(l.text)}</li>`).join('');
    const flags = r.flags.length ? `<div class="flags">${r.flags.map((f) => `<div>⚠ ${esc(f.text)}</div>`).join('')}</div>` : '';
    return `<article class="report ${r.flags.length ? 'has-flags' : ''}"><header><span>Manager → You</span><span>${hhmmss(r.ts)}${dur}</span></header>
      <div class="summary">${esc(r.summary)}</div><ul>${lines}</ul>${flags}</article>`;
  }).join('');
}

function renderPanel() { renderStatus(); renderTeam(); renderFeed(); renderReports(); }
function renderAll() {
  for (const emp of state.employees.values()) {
    emp.taskEl.textContent = emp.label;
    emp.taskEl.classList.toggle('flag', emp.flag);
  }
  renderPanel();
}

document.getElementById('tabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  for (const x of document.querySelectorAll('#tabs button')) x.classList.toggle('active', x === b);
  for (const x of document.querySelectorAll('.tab')) x.classList.toggle('active', x.id === b.dataset.tab);
});

// ---------- loop ----------
function resize() {
  const w = container.clientWidth, h = container.clientHeight;
  renderer.setSize(w, h); labelRenderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

const clock = new THREE.Clock();
let lastCheck = 0;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.1);
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

  for (const emp of state.employees.values()) {
    emp.glow += ((emp.active ? 1 : 0) - emp.glow) * Math.min(1, dt * 6);
    emp.screenMat.emissiveIntensity = emp.glow * 0.9;
    emp.taskEl.classList.toggle('hidden', !emp.active);
    // Typing nod only while actually working.
    emp.figure.userData.head.position.y = 1.75 + (emp.active ? Math.sin(t * 9) * 0.025 : 0);
  }

  if (manager) {
    const tgt = manager.userData.target;
    const d = tgt.clone().sub(manager.position); d.y = 0;
    const dist = d.length();
    if (dist > 0.05) {
      manager.position.add(d.normalize().multiplyScalar(Math.min(dist, dt * 3.2)));
      manager.position.y = Math.abs(Math.sin(t * 10)) * 0.06;
      manager.rotation.y = Math.atan2(d.x, d.z);
    } else {
      manager.position.y = 0;
      if (manager.userData.onArrive) { const f = manager.userData.onArrive; manager.userData.onArrive = null; f(); }
    }
  }

  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(tick);
}

resize();
renderPanel();
connect();
tick();
