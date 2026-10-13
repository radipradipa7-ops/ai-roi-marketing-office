// Rooms and furniture. Every room is built in a group whose origin is the room
// centre, with its door opening on the +z (front) wall. Rooms return "spots":
// places people can go, each with approach waypoints (room-local) that keep
// walking paths clear of furniture.
import * as THREE from 'three';
import { M, mat, box, cyl, label, chair, mug, plant, floorPlant, rug, couch, coffeeTable, bookshelf } from './kit.js';
import { HIP_Y } from './people.js';

export const ROOM_W = 11, ROOM_D = 8, DOOR = 2.4, WALL_H = 0.9;
export const DOOR_IN = new THREE.Vector3(0, 0, ROOM_D / 2 - 0.8);
const seatRootY = (seatTop) => seatTop - HIP_Y + 0.04;

const V = (x, z) => new THREE.Vector3(x, 0, z);
function spot(x, z, yaw, mode, approach = [], y = 0) { return { pos: V(x, z), yaw, mode, y, approach, taken: null }; }

// Walls with a door gap on the front, accent caps, an entrance sign.
export function roomShell(room, { name, color }, { floor, wallH = WALL_H } = {}) {
  const accent = new THREE.Color(color || '#9aa7c7');
  const tint = floor ? new THREE.Color(floor) : accent.clone().lerp(new THREE.Color('#f6efe4'), 0.88);
  room.add(box(ROOM_W, 0.04, ROOM_D, mat(tint.getStyle(), { roughness: 0.9 }), 0, 0.02, 0, false));
  const cap = mat(accent.clone().lerp(new THREE.Color('#ffffff'), 0.25).getStyle(), { roughness: 0.6 });
  const wall = (w, d, x, z) => {
    room.add(box(w, wallH, d, M.wall, x, wallH / 2, z));
    room.add(box(w + 0.02, 0.05, d + 0.02, cap, x, wallH + 0.025, z));
  };
  wall(ROOM_W, 0.14, 0, -ROOM_D / 2);
  wall(0.14, ROOM_D, -ROOM_W / 2, 0);
  wall(0.14, ROOM_D, ROOM_W / 2, 0);
  const side = (ROOM_W - DOOR) / 2;
  wall(side, 0.14, -(DOOR / 2 + side / 2), ROOM_D / 2);
  wall(side, 0.14, DOOR / 2 + side / 2, ROOM_D / 2);
  const tag = new THREE.Object3D();
  tag.position.set(-DOOR / 2 - 1.6, 0.25, ROOM_D / 2 + 0.55);
  room.add(tag);
  label('room-tag', name, tag, 0);
}

// Workstation: screen faces +z (camera); the seat is on the +z side.
export function desk(color, index) {
  const g = new THREE.Group();
  g.add(box(2.2, 0.07, 1.05, M.deskTop, 0, 0.78, 0));
  g.add(box(0.05, 0.75, 0.9, M.metal, -1.02, 0.375, 0));
  g.add(box(0.05, 0.75, 0.9, M.metal, 1.02, 0.375, 0));
  g.add(box(0.45, 0.55, 0.85, mat('#efe6d8', { roughness: 0.6 }), 0.72, 0.3, -0.05));
  g.add(box(0.36, 0.03, 0.22, M.dark, 0, 0.83, -0.25));
  g.add(box(0.06, 0.3, 0.05, M.dark, 0, 0.98, -0.28));
  g.add(box(1.12, 0.68, 0.06, M.dark, 0, 1.44, -0.25));
  const screenMat = new THREE.MeshStandardMaterial({ color: '#39404c', emissive: new THREE.Color(color), emissiveIntensity: 0, roughness: 0.25 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.02, 0.58), screenMat);
  screen.position.set(0, 1.44, -0.215);
  g.add(screen);
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.0), glowMat);
  glow.position.set(0, 1.44, -0.2);
  g.add(glow);
  const ledMat = new THREE.MeshBasicMaterial({ color: '#c9ced8' });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), ledMat);
  led.position.set(0.5, 1.13, -0.215);
  g.add(led);
  g.add(box(0.62, 0.02, 0.2, M.keyboard, -0.05, 0.825, 0.18));
  g.add(box(0.07, 0.02, 0.11, M.keyboard, 0.4, 0.825, 0.2));
  const m = mug(index % 2 ? '#ffffff' : color);
  m.position.set(-0.85, 0.815, 0.12);
  g.add(m);
  const p = plant(index % 2 ? 0.8 : 1);
  p.position.set(index % 2 ? -0.82 : 0.82, 0.815, -0.32);
  g.add(p);
  const c = chair(new THREE.Color(color).lerp(new THREE.Color('#3a3f4a'), 0.45).getStyle());
  c.position.set(0, 0, 1.0);
  g.add(c);
  return { group: g, screenMat, glowMat, ledMat, seat: new THREE.Vector3(0, seatRootY(0.55), 1.0) };
}

// A division room with desks. Returns per-employee seats and visitor spots (room-local).
export function teamRoom(room, d, colorIndexBase) {
  roomShell(room, d);
  const accent = new THREE.Color(d.color || '#9aa7c7');
  room.add(rug(ROOM_W - 1.6, 3.6, accent.clone().lerp(new THREE.Color('#f3ece2'), 0.7).getStyle(), accent.clone().lerp(new THREE.Color('#ffffff'), 0.45).getStyle()).translateZ(-0.9));
  room.add(box(3.2, 0.5, 0.04, mat(accent.getStyle(), { roughness: 0.5 }), 0, 0.55, -ROOM_D / 2 + 0.1));
  const fp = floorPlant(); fp.position.set(ROOM_W / 2 - 0.6, 0, ROOM_D / 2 - 0.7); room.add(fp);
  const fp2 = floorPlant(true); fp2.position.set(-ROOM_W / 2 + 0.6, 0, -ROOM_D / 2 + 0.6); room.add(fp2);
  const emps = d.employees || [];
  const desks = [];
  emps.forEach((e, j) => {
    const dr = Math.floor(j / 3), dc = j % 3;
    const n = Math.min(3, emps.length - dr * 3);
    const x = (dc - (n - 1) / 2) * 3.7;
    const z = -1.6 + dr * 3.3;
    const dk = desk(d.color || '#7c9cff', colorIndexBase + j);
    dk.group.position.set(x, 0, z);
    room.add(dk.group);
    const seatZ = z + dk.seat.z;
    desks.push({
      e, x, z, dk, labelOffset: (dc - (n - 1) / 2) * 0.6,
      seat: spot(x, seatZ + 0.02, Math.PI, 'sit', [V(x, seatZ + 0.85)], dk.seat.y),
      visit: spot(x + 0.95, seatZ + 0.15, -Math.PI / 2 - 0.35, 'talk', [V(x + 0.95, seatZ + 0.85)]),
    });
  });
  return desks;
}

export function breakRoom(room) {
  roomShell(room, { name: 'Break Room', color: '#c9a96e' }, { floor: '#f1e7d6' });
  const spots = { counter: [], table: [], couch: [] };
  // kitchen along the back wall
  const cab = mat('#f7f4ee', { roughness: 0.6 });
  const top = mat('#d8cfc2', { roughness: 0.35 });
  room.add(box(6.2, 0.86, 0.62, cab, -1.6, 0.43, -3.55));
  room.add(box(6.3, 0.05, 0.68, top, -1.6, 0.885, -3.53));
  for (let i = 0; i < 6; i++) room.add(box(0.02, 0.7, 0.01, mat('#d9d2c6'), -4.6 + i * 1.0, 0.45, -3.235)); // cabinet seams
  room.add(box(0.62, 0.02, 0.42, M.dark, -3.0, 0.915, -3.5)); // sink
  room.add(cyl(0.025, 0.025, 0.3, M.metal, -3.0, 1.06, -3.72, 8));
  room.add(box(0.03, 0.03, 0.18, M.metal, -3.0, 1.2, -3.64));
  room.add(box(0.55, 0.32, 0.38, mat('#3a3f48', { roughness: 0.4 }), -1.6, 1.07, -3.55)); // microwave
  room.add(box(0.36, 0.46, 0.32, M.dark, -0.3, 1.14, -3.55)); // coffee machine
  room.add(box(0.2, 0.06, 0.04, mat('#d9a63c', { roughness: 0.3, metalness: 0.5 }), -0.3, 1.25, -3.38));
  const m1 = mug('#e8835a'); m1.position.set(0.15, 0.91, -3.45); room.add(m1);
  const m2 = mug('#ffffff'); m2.position.set(0.4, 0.91, -3.5); room.add(m2);
  const p1 = plant(0.9); p1.position.set(1.1, 0.91, -3.5); room.add(p1);
  room.add(box(0.85, 1.9, 0.72, mat('#eef0f2', { roughness: 0.3, metalness: 0.2 }), 2.2, 0.95, -3.48)); // fridge
  room.add(box(0.03, 0.5, 0.04, M.metal, 1.86, 1.35, -3.1));
  room.add(box(0.03, 0.35, 0.04, M.metal, 1.86, 0.6, -3.1));
  room.add(box(0.83, 0.01, 0.01, mat('#cfd3d8'), 2.2, 1.1, -3.115));
  room.add(box(0.36, 0.95, 0.36, mat('#e9edf2'), 3.1, 0.475, -3.5)); // water cooler
  const bottle = cyl(0.13, 0.13, 0.42, mat('#9cc7f0', { transparent: true, opacity: 0.75, roughness: 0.1 }), 3.1, 1.16, -3.5, 16);
  room.add(bottle);
  for (const x of [-3.0, -1.6, -0.3]) spots.counter.push(spot(x, -2.75, Math.PI, 'stand', [V(0, -1.9)]));

  // round table with stools
  const tc = V(-2.6, 0.7);
  room.add(cyl(0.72, 0.72, 0.05, M.wood, tc.x, 0.76, tc.z, 32));
  room.add(cyl(0.06, 0.08, 0.74, M.metal, tc.x, 0.37, tc.z, 12));
  room.add(cyl(0.35, 0.35, 0.03, M.metal, tc.x, 0.015, tc.z, 20));
  const tm = mug('#7b8cf0'); tm.position.set(tc.x + 0.2, 0.785, tc.z - 0.1); room.add(tm);
  const tableSeats = [
    { a: 0, approach: [] },                                   // east
    { a: Math.PI / 2, approach: [V(tc.x, tc.z + 1.9)] },       // south (front)
    { a: -Math.PI / 2, approach: [V(0, -1.9), V(tc.x, -1.4)] }, // north (back)
  ];
  for (const s of tableSeats) {
    const x = tc.x + Math.cos(s.a) * 1.05, z = tc.z + Math.sin(s.a) * 1.05;
    room.add(cyl(0.22, 0.2, 0.06, mat('#c9744f', { roughness: 0.7 }), x, 0.52, z, 16));
    room.add(cyl(0.035, 0.035, 0.5, M.metal, x, 0.25, z, 8));
    const yaw = Math.atan2(tc.x - x, tc.z - z);
    spots.table.push(spot(x, z, yaw, 'sit', s.approach, seatRootY(0.55)));
  }

  // lounge: rug, couch, coffee table, plants
  room.add(rug(3.9, 2.9, '#b9c7b4', '#9fb39a').translateX(2.7).translateZ(1.25));
  const c = couch('#6f86a6', 3);
  c.group.position.set(2.7, 0, 0.45);
  room.add(c.group);
  for (const sp of c.spots) spots.couch.push(spot(2.7 + sp.x, 0.45 + sp.z, 0, 'sit', [V(1.0, 1.05), V(2.7 + sp.x, 1.05)], seatRootY(c.seatY)));
  const ct = coffeeTable(1.3, 0.55); ct.position.set(2.7, 0, 1.6); room.add(ct);
  const cm = mug('#d6337f'); cm.position.set(2.5, 0.43, 1.6); room.add(cm);
  const fp = floorPlant(true); fp.position.set(ROOM_W / 2 - 0.6, 0, ROOM_D / 2 - 0.7); room.add(fp);
  const fp2 = floorPlant(); fp2.position.set(-ROOM_W / 2 + 0.6, 0, ROOM_D / 2 - 0.7); room.add(fp2);
  return spots;
}

// The Boss's personal office: executive desk with dual monitors, sofa corner, shelf, plants.
export function bossOffice(room) {
  roomShell(room, { name: 'Your Office', color: '#5b6b86' }, { floor: '#ece6dc' });
  room.add(rug(7.2, 4.4, '#4a5466', '#3d4656').translateZ(-1.0));
  room.add(box(3.4, 0.09, 1.3, M.walnut, 0, 0.8, -1.3));
  room.add(box(0.08, 0.76, 1.15, M.dark, -1.55, 0.38, -1.3));
  room.add(box(0.08, 0.76, 1.15, M.dark, 1.55, 0.38, -1.3));
  room.add(box(3.1, 0.45, 0.04, M.dark, 0, 0.5, -0.8));
  const screens = [];
  for (const x of [-0.6, 0.6]) {
    room.add(box(0.05, 0.28, 0.05, M.dark, x, 0.98, -1.62));
    room.add(box(1.05, 0.62, 0.05, M.dark, x, 1.4, -1.62));
    const sm = new THREE.MeshStandardMaterial({ color: '#39404c', emissive: new THREE.Color('#9fb1ff'), emissiveIntensity: 0, roughness: 0.25 });
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.54), sm);
    s.position.set(x, 1.4, -1.59);
    s.rotation.y = x < 0 ? 0.12 : -0.12;
    room.add(s);
    screens.push(sm);
  }
  room.add(box(0.6, 0.02, 0.18, M.keyboard, 0, 0.855, -1.15));
  const m = mug('#2a2f38'); m.position.set(1.2, 0.845, -1.1); room.add(m);
  room.add(box(0.5, 0.1, 0.06, mat('#c9a96e', { roughness: 0.3, metalness: 0.6 }), -1.15, 0.9, -0.85)); // nameplate
  const ch = chair('#23272f', true);
  ch.rotation.y = Math.PI;
  ch.position.set(0, 0, -2.45);
  room.add(ch);
  const shelf = bookshelf(1.8, 1.3); shelf.position.set(-3.6, 0, -3.55); room.add(shelf);
  const sp = plant(1.1); sp.position.set(-3.2, 1.3, -3.55); room.add(sp);
  const fp = floorPlant(true); fp.position.set(ROOM_W / 2 - 0.6, 0, -ROOM_D / 2 + 0.6); room.add(fp);
  const fp2 = floorPlant(); fp2.position.set(-ROOM_W / 2 + 0.6, 0, ROOM_D / 2 - 0.7); room.add(fp2);
  // sofa corner facing the room centre
  const c = couch('#8a6f5a', 2);
  c.group.position.set(4.2, 0, 1.5);
  c.group.rotation.y = -Math.PI / 2;
  room.add(c.group);
  const ct = coffeeTable(0.6, 1.1); ct.position.set(3.1, 0, 1.5); room.add(ct);
  const pl = plant(0.8); pl.position.set(3.1, 0.43, 1.3); room.add(pl);
  return {
    screens,
    bossSeat: spot(0, -2.4, 0, 'sit', [], seatRootY(0.55)),
    visitor: spot(-0.5, 0.05, Math.PI, 'talk', []),
  };
}
