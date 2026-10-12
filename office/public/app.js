// AI Marketing Office: 3D view + side panel (team, chat, reports, activity).
// Everything shown is driven by server events, which come from the Claude Code
// hook log and the chat relay. Nothing is randomized: with no events, the
// office stays idle.
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
controls.minDistance = 12;
controls.maxDistance = 90;

scene.add(new THREE.HemisphereLight('#fffaf2', '#e3dccf', 1.5));
const sun = new THREE.DirectionalLight('#fff6ea', 1.5);
sun.position.set(16, 30, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40 });
sun.shadow.radius = 5;
sun.shadow.bias = -0.0004;
scene.add(sun);

const office = new THREE.Group();
scene.add(office);

const matCache = new Map();
function mat(color, extra = {}) {
  const k = color + JSON.stringify(extra);
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra }));
  return matCache.get(k);
}
const M = {
  ground: mat('#ece4d8', { roughness: 0.95 }),
  wall: mat('#fbfaf7', { roughness: 0.9 }),
  deskTop: mat('#e4d2b8', { roughness: 0.55 }),
  metal: mat('#b9bec8', { roughness: 0.35, metalness: 0.6 }),
  dark: mat('#2a2f38', { roughness: 0.4 }),
  keyboard: mat('#f2f2f0', { roughness: 0.5 }),
  skin: mat('#efcaa9'),
  pot: mat('#c9744f', { roughness: 0.85 }),
  leaf: mat('#5f9e6e', { roughness: 0.8 }),
  leafDark: mat('#4a8259', { roughness: 0.8 }),
  mug: mat('#ffffff', { roughness: 0.35 }),
  coffee: mat('#5a3a26', { roughness: 0.3 }),
};

function box(w, h, d, material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, material, x = 0, y = 0, z = 0, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
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

// ---------- props ----------
function person(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.5, 4, 14), mat(color));
  body.position.y = 0.95; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 22, 16), M.skin);
  head.position.y = 1.7; head.castShadow = true;
  g.add(body, head);
  g.userData.head = head;
  return g;
}

function chair(color, executive = false) {
  const g = new THREE.Group();
  const seatMat = mat(color, { roughness: 0.7 });
  g.add(box(0.62, 0.1, 0.6, seatMat, 0, 0.5, 0));
  g.add(box(0.62, executive ? 1.0 : 0.62, 0.1, seatMat, 0, executive ? 1.02 : 0.86, 0.27));
  g.add(cyl(0.04, 0.04, 0.36, M.metal, 0, 0.27, 0, 10));
  g.add(box(0.62, 0.04, 0.07, M.metal, 0, 0.08, 0));
  g.add(box(0.07, 0.04, 0.62, M.metal, 0, 0.08, 0));
  return g;
}

function mug(color) {
  const g = new THREE.Group();
  g.add(cyl(0.07, 0.065, 0.16, mat(color, { roughness: 0.35 }), 0, 0.08, 0, 16));
  const top = cyl(0.062, 0.062, 0.01, M.coffee, 0, 0.155, 0, 16);
  top.castShadow = false;
  g.add(top);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 8, 16), mat(color, { roughness: 0.35 }));
  handle.position.set(0.08, 0.085, 0);
  g.add(handle);
  return g;
}

function plant(scale = 1) {
  const g = new THREE.Group();
  g.add(cyl(0.11 * scale, 0.08 * scale, 0.18 * scale, M.pot, 0, 0.09 * scale, 0, 14));
  const leaves = [[0, 0.32, 0, 0.14, M.leaf], [0.07, 0.26, 0.04, 0.1, M.leafDark], [-0.07, 0.27, -0.03, 0.1, M.leafDark]];
  for (const [x, y, z, r, m] of leaves) {
    const l = new THREE.Mesh(new THREE.IcosahedronGeometry(r * scale, 0), m);
    l.position.set(x * scale, y * scale, z * scale);
    l.castShadow = true;
    g.add(l);
  }
  return g;
}

function floorPlant() {
  const g = new THREE.Group();
  g.add(cyl(0.28, 0.22, 0.5, mat('#e9e4dc', { roughness: 0.6 }), 0, 0.25, 0, 18));
  const leaves = [[0, 1.0, 0, 0.4], [0.18, 0.75, 0.1, 0.3], [-0.17, 0.8, -0.08, 0.3], [0.05, 1.3, -0.05, 0.25]];
  leaves.forEach(([x, y, z, r], i) => {
    const l = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), i % 2 ? M.leafDark : M.leaf);
    l.position.set(x, y, z); l.castShadow = true;
    g.add(l);
  });
  return g;
}

// A workstation. The screen faces the camera (+z); the employee sits on the
// +z side with their back to the camera, looking at it.
function desk(color, index) {
  const g = new THREE.Group();
  g.add(box(2.2, 0.07, 1.05, M.deskTop, 0, 0.78, 0));
  g.add(box(0.05, 0.75, 0.9, M.metal, -1.02, 0.375, 0));
  g.add(box(0.05, 0.75, 0.9, M.metal, 1.02, 0.375, 0));
  g.add(box(0.45, 0.55, 0.85, mat('#efe6d8', { roughness: 0.6 }), 0.72, 0.3, -0.05)); // drawer pedestal
  // monitor
  g.add(box(0.36, 0.03, 0.22, M.dark, 0, 0.83, -0.25));
  g.add(box(0.06, 0.3, 0.05, M.dark, 0, 0.98, -0.28));
  g.add(box(1.12, 0.68, 0.06, M.dark, 0, 1.44, -0.25));
  const screenMat = new THREE.MeshStandardMaterial({ color: '#39404c', emissive: new THREE.Color(color), emissiveIntensity: 0, roughness: 0.25 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.02, 0.58), screenMat);
  screen.position.set(0, 1.44, -0.215);
  g.add(screen);
  // soft glow panel in front of the screen, visible only while active
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.0), glowMat);
  glow.position.set(0, 1.44, -0.2);
  g.add(glow);
  const ledMat = new THREE.MeshBasicMaterial({ color: '#c9ced8' });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), ledMat);
  led.position.set(0.5, 1.13, -0.215);
  g.add(led);
  // keyboard + mouse
  g.add(box(0.62, 0.02, 0.2, M.keyboard, -0.05, 0.825, 0.18));
  g.add(box(0.07, 0.02, 0.11, M.keyboard, 0.4, 0.825, 0.2));
  // decorations (deterministic by desk position, never random)
  const m = mug(index % 2 ? '#ffffff' : color);
  m.position.set(-0.85, 0.815, 0.12);
  g.add(m);
  if (index % 2 === 0) { const p = plant(1); p.position.set(0.82, 0.815, -0.32); g.add(p); }
  else { const p = plant(0.8); p.position.set(-0.82, 0.815, -0.3); g.add(p); }
  // chair + seated person
  const c = chair(new THREE.Color(color).lerp(new THREE.Color('#3a3f4a'), 0.45).getStyle());
  c.position.set(0, 0, 1.0);
  g.add(c);
  const p = person(color);
  p.position.set(0, -0.12, 1.02);
  p.rotation.y = Math.PI;
  g.add(p);
  return { group: g, screenMat, glowMat, ledMat, figure: p };
}

// ---------- build office from config ----------
const ROOM_W = 11, ROOM_D = 8, GAP = 2.6, DOOR = 2.4, WALL_H = 0.9;
let manager = null, boss = null, bossDesk = null;
const bounds = { w: 30, zMin: -5, zMax: 10 };

function roomShell(room, d) {
  const accent = new THREE.Color(d.color || '#9aa7c7');
  const tint = accent.clone().lerp(new THREE.Color('#f6efe4'), 0.88);
  const floor = box(ROOM_W, 0.04, ROOM_D, mat(tint.getStyle(), { roughness: 0.9 }), 0, 0.02, 0, false);
  room.add(floor);
  const cap = mat(accent.clone().lerp(new THREE.Color('#ffffff'), 0.25).getStyle(), { roughness: 0.6 });
  const wall = (w, d_, x, z) => {
    room.add(box(w, WALL_H, d_, M.wall, x, WALL_H / 2, z));
    room.add(box(w + 0.02, 0.05, d_ + 0.02, cap, x, WALL_H + 0.025, z));
  };
  wall(ROOM_W, 0.14, 0, -ROOM_D / 2);
  wall(0.14, ROOM_D, -ROOM_W / 2, 0);
  wall(0.14, ROOM_D, ROOM_W / 2, 0);
  const side = (ROOM_W - DOOR) / 2;
  wall(side, 0.14, -(DOOR / 2 + side / 2), ROOM_D / 2); // front wall with a door opening
  wall(side, 0.14, DOOR / 2 + side / 2, ROOM_D / 2);
  // accent board on the back wall
  room.add(box(3.2, 0.5, 0.04, mat(accent.getStyle(), { roughness: 0.5 }), 0, 0.55, -ROOM_D / 2 + 0.1));
  const fp = floorPlant();
  fp.position.set(ROOM_W / 2 - 0.6, 0, ROOM_D / 2 - 0.7);
  room.add(fp);
  const tag = new THREE.Object3D();
  tag.position.set(-DOOR / 2 - 1.6, 0.25, ROOM_D / 2 + 0.55); // entrance sign, clear of desk labels
  room.add(tag);
  label('room-tag', d.name, tag, 0);
}

function buildBossArea(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  office.add(g);
  g.add(box(7.5, 0.03, 4.6, mat('#3d4656', { roughness: 0.95 }), 0, 0.015, 0, false)); // rug
  g.add(box(7.1, 0.035, 4.2, mat('#4a5466', { roughness: 0.95 }), 0, 0.02, 0, false));
  // sleek desk: walnut slab on two panel legs
  const walnut = mat('#5b4334', { roughness: 0.45 });
  g.add(box(3.4, 0.09, 1.3, walnut, 0, 0.8, 0));
  g.add(box(0.08, 0.76, 1.15, M.dark, -1.55, 0.38, 0));
  g.add(box(0.08, 0.76, 1.15, M.dark, 1.55, 0.38, 0));
  g.add(box(3.1, 0.45, 0.04, M.dark, 0, 0.5, 0.5)); // modesty panel
  // dual monitors (lit while the team is working on your request)
  const screens = [];
  for (const x of [-0.6, 0.6]) {
    g.add(box(0.05, 0.28, 0.05, M.dark, x, 0.98, -0.32));
    g.add(box(1.05, 0.62, 0.05, M.dark, x, 1.4, -0.32));
    const sm = new THREE.MeshStandardMaterial({ color: '#39404c', emissive: new THREE.Color('#9fb1ff'), emissiveIntensity: 0, roughness: 0.25 });
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.54), sm);
    s.position.set(x, 1.4, -0.29);
    s.rotation.y = x < 0 ? 0.12 : -0.12;
    g.add(s);
    screens.push(sm);
  }
  g.add(box(0.6, 0.02, 0.18, M.keyboard, 0, 0.855, 0.15));
  const m = mug('#2a2f38'); m.position.set(1.2, 0.845, 0.2); g.add(m);
  const nameplate = box(0.5, 0.1, 0.06, mat('#c9a96e', { roughness: 0.3, metalness: 0.6 }), -1.15, 0.9, 0.45);
  g.add(nameplate);
  // executive chair behind the desk; boss faces the room (and the camera)
  const ch = chair('#23272f', true);
  ch.rotation.y = Math.PI;
  ch.position.set(0, 0, -1.15);
  g.add(ch);
  const b = person('#2f3a4f');
  b.position.set(0, -0.12, -1.05);
  g.add(b);
  // shelf + plants
  const shelf = new THREE.Group();
  shelf.add(box(1.6, 1.3, 0.4, mat('#f3efe8', { roughness: 0.7 }), 0, 0.65, 0));
  ['#e8835a', '#7b8cf0', '#3fa98c', '#d6337f', '#c9a96e'].forEach((c, i) => shelf.add(box(0.12, 0.34, 0.26, mat(c), -0.55 + i * 0.16, 0.95, 0.03)));
  shelf.add(box(1.5, 0.03, 0.36, mat('#e2dbcf'), 0, 0.76, 0));
  shelf.position.set(-3.0, 0, -1.6);
  g.add(shelf);
  const fp = floorPlant(); fp.position.set(3.1, 0, -1.6); g.add(fp);
  const small = plant(1.1); small.position.set(-2.9, 1.3, -1.6); g.add(small);
  label('name-tag', 'You (Boss)', b, 2.3);
  b.userData.bubble = label('bubble hidden', '', b, 3.2);
  return { group: g, boss: b, screens, x, z };
}

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

function buildOffice(config) {
  office.clear();
  const old = state.employees;
  state.employees = new Map();
  const divs = config.divisions || [];
  // Grid of rooms plus one extra cell for the Boss area (3 rooms → 2×2).
  const cells = divs.length + 1;
  const cols = Math.ceil(Math.sqrt(cells));
  const rows = Math.ceil(cells / cols);
  const totalW = cols * ROOM_W + (cols - 1) * GAP;
  const totalD = rows * ROOM_D + (rows - 1) * GAP;
  const cellCenter = (i) => [
    -totalW / 2 + ROOM_W / 2 + (i % cols) * (ROOM_W + GAP),
    -totalD / 2 + ROOM_D / 2 + Math.floor(i / cols) * (ROOM_D + GAP),
  ];
  const managerName = config.manager || 'Manager';
  manager = null;

  office.add(box(totalW + 8, 0.2, totalD + 8, M.ground, 0, -0.1, 0, false));

  divs.forEach((d, i) => {
    const [cx, cz] = cellCenter(i);
    const room = new THREE.Group();
    room.position.set(cx, 0, cz);
    office.add(room);
    roomShell(room, d);

    const emps = d.employees || [];
    emps.forEach((e, j) => {
      const dr = Math.floor(j / 3), dc = j % 3;
      const n = Math.min(3, emps.length - dr * 3);
      const x = (dc - (n - 1) / 2) * 4.0;
      const z = -1.6 + dr * 3.3;
      const dk = desk(d.color || '#7c9cff', i * 3 + j);
      dk.group.position.set(x, 0, z);
      room.add(dk.group);
      const anchor = new THREE.Object3D();
      anchor.position.set(x, 0, z);
      room.add(anchor);
      const task = label('task-tag hidden', '', anchor, 2.35);
      task.obj.position.x = (dc - (n - 1) / 2) * 0.6; // nudge outward so neighbouring labels don't overlap

      // The Manager's figure lives in world space so it can walk to the Boss.
      let figure = dk.figure;
      let nameParent = figure;
      if (e.name === managerName) {
        dk.group.remove(figure);
        figure = person(d.color || '#4f6bed');
        const home = new THREE.Vector3(cx + x, -0.12, cz + z + 1.02);
        figure.position.copy(home);
        figure.rotation.y = Math.PI;
        office.add(figure);
        figure.userData.home = home;
        figure.userData.target = home.clone();
        figure.userData.door = new THREE.Vector3(cx, 0, cz + ROOM_D / 2 + 0.9); // walk out through the door opening
        figure.userData.route = [];
        figure.userData.bubble = label('bubble hidden', '', figure, 2.85);
        manager = figure;
        nameParent = figure;
      }
      label('name-tag', e.name, nameParent, -0.05);
      const prev = old.get(key(d.id, e.name));
      state.employees.set(key(d.id, e.name), {
        division: d.id, divisionName: d.name, color: d.color, name: e.name, role: e.role || '',
        screenMat: dk.screenMat, glowMat: dk.glowMat, ledMat: dk.ledMat, figure, taskEl: task.el,
        active: false, label: prev ? prev.label : '', flag: false, watch: null, lastTs: prev ? prev.lastTs : 0,
        offAt: 0, glow: 0,
      });
    });
  });

  const [bx, bz] = cellCenter(divs.length);
  bossDesk = buildBossArea(bx, bz);
  boss = bossDesk.boss;
  if (!manager) { // config without a Manager employee: standalone Manager in the lobby
    manager = person('#4f6bed');
    const home = new THREE.Vector3(bossDesk.x - 4.5, 0, bossDesk.z + 2.5);
    manager.position.copy(home);
    office.add(manager);
    manager.userData.home = home;
    manager.userData.target = home.clone();
    manager.userData.route = [];
    label('name-tag', 'Manager', manager, -0.05);
    manager.userData.bubble = label('bubble hidden', '', manager, 2.85);
  }

  Object.assign(bounds, { w: totalW + 3, zMin: -totalD / 2 - 0.5, zMax: totalD / 2 + 1.4 });
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
  es.addEventListener('chat-state', (ev) => { Object.assign(state.chat, JSON.parse(ev.data)); renderChat(); });
  es.addEventListener('chat-reset', (ev) => { state.chat = JSON.parse(ev.data); renderChat(); });
  es.onerror = () => { state.connected = false; renderStatus(); };
  es.onopen = () => { state.connected = true; renderStatus(); };
}

// ---------- characters ----------
function say(who, text, flag, ms) {
  if (!who) return;
  const b = who.userData.bubble;
  b.el.textContent = text;
  b.el.classList.toggle('flag', !!flag);
  b.el.classList.remove('hidden');
  clearTimeout(b.timer);
  b.timer = setTimeout(() => b.el.classList.add('hidden'), ms);
}
function walkManagerToBoss(text, flag) {
  if (!manager || !bossDesk) return;
  const u = manager.userData;
  const spot = new THREE.Vector3(bossDesk.x - 1.0, 0, bossDesk.z + 1.5);
  u.route = u.door ? [u.door.clone(), spot] : [spot];
  u.onArrive = () => {
    say(manager, text, flag, 7000);
    setTimeout(() => { u.route = u.door ? [u.door.clone(), u.home.clone()] : [u.home.clone()]; }, 7000);
  };
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
    emp.screenMat.emissiveIntensity = emp.glow * 0.95;
    emp.glowMat.opacity = emp.glow * 0.22;
    emp.ledMat.color.set(emp.active ? '#34d399' : '#c9ced8');
    emp.taskEl.classList.toggle('hidden', !emp.active);
    // Typing nod only while actually working (and not while walking).
    const seated = emp.figure !== manager || emp.figure.position.distanceTo(emp.figure.userData.home) < 0.05;
    if (seated) emp.figure.userData.head.position.y = 1.7 + (emp.active ? Math.sin(t * 9) * 0.025 : 0);
  }
  if (bossDesk) {
    const k = state.turnActive || state.chat.busy ? 0.8 : 0;
    for (const s of bossDesk.screens) s.emissiveIntensity += (k - s.emissiveIntensity) * Math.min(1, dt * 4);
  }

  if (manager) {
    const u = manager.userData;
    const flatDist = manager.position.clone().setY(0).distanceTo(u.target.clone().setY(0));
    if (flatDist <= 0.05 && u.route.length) u.target = u.route.shift(); // reached a waypoint: take the next one
    const tgt = u.target;
    const d = tgt.clone().sub(manager.position); d.y = 0;
    const dist = d.length();
    const home = manager.userData.home;
    if (dist > 0.05) {
      manager.position.add(d.normalize().multiplyScalar(Math.min(dist, dt * 3.2)));
      manager.position.y = Math.abs(Math.sin(t * 10)) * 0.06;
      manager.rotation.y = Math.atan2(d.x, d.z);
    } else {
      manager.position.y = tgt.distanceTo(home) < 0.1 ? home.y : 0; // sit back down at the desk
      if (tgt.distanceTo(home) < 0.1) manager.rotation.y = Math.PI;
      if (!u.route.length && u.onArrive) { const f = u.onArrive; u.onArrive = null; f(); }
    }
  }

  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(tick);
}

resize();
renderPanel();
renderChat();
connect();
tick();
