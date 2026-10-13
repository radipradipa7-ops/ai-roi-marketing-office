// Shared Three.js building blocks: cached materials, primitive helpers,
// CSS2D labels, and small decorative props.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const matCache = new Map();
export function mat(color, extra = {}) {
  const k = color + JSON.stringify(extra);
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra }));
  return matCache.get(k);
}

export const M = {
  ground: mat('#ece4d8', { roughness: 0.95 }),
  wall: mat('#fbfaf7', { roughness: 0.9 }),
  deskTop: mat('#e4d2b8', { roughness: 0.55 }),
  metal: mat('#b9bec8', { roughness: 0.35, metalness: 0.6 }),
  dark: mat('#2a2f38', { roughness: 0.4 }),
  keyboard: mat('#f2f2f0', { roughness: 0.5 }),
  pot: mat('#c9744f', { roughness: 0.85 }),
  potLight: mat('#e9e4dc', { roughness: 0.6 }),
  leaf: mat('#5f9e6e', { roughness: 0.8 }),
  leafDark: mat('#4a8259', { roughness: 0.8 }),
  coffee: mat('#5a3a26', { roughness: 0.3 }),
  wood: mat('#c8a27a', { roughness: 0.6 }),
  walnut: mat('#5b4334', { roughness: 0.45 }),
};

export function box(w, h, d, material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}

export function cyl(rt, rb, h, material, x = 0, y = 0, z = 0, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function label(className, text, parent, y) {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  const obj = new CSS2DObject(el);
  obj.position.set(0, y, 0);
  parent.add(obj);
  return { el, obj };
}

export function chair(color, executive = false) {
  const g = new THREE.Group();
  const seatMat = mat(color, { roughness: 0.7 });
  g.add(box(0.62, 0.1, 0.6, seatMat, 0, 0.5, 0));
  g.add(box(0.62, executive ? 1.0 : 0.62, 0.1, seatMat, 0, executive ? 1.02 : 0.86, 0.27));
  g.add(cyl(0.04, 0.04, 0.36, M.metal, 0, 0.27, 0, 10));
  g.add(box(0.62, 0.04, 0.07, M.metal, 0, 0.08, 0));
  g.add(box(0.07, 0.04, 0.62, M.metal, 0, 0.08, 0));
  return g;
}

export function mug(color) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.35 });
  g.add(cyl(0.07, 0.065, 0.16, m, 0, 0.08, 0, 16));
  const top = cyl(0.062, 0.062, 0.01, M.coffee, 0, 0.155, 0, 16);
  top.castShadow = false;
  g.add(top);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 8, 16), m);
  handle.position.set(0.08, 0.085, 0);
  g.add(handle);
  return g;
}

export function plant(scale = 1) {
  const g = new THREE.Group();
  g.add(cyl(0.11 * scale, 0.08 * scale, 0.18 * scale, M.pot, 0, 0.09 * scale, 0, 14));
  for (const [x, y, z, r, m] of [[0, 0.32, 0, 0.14, M.leaf], [0.07, 0.26, 0.04, 0.1, M.leafDark], [-0.07, 0.27, -0.03, 0.1, M.leafDark]]) {
    const l = new THREE.Mesh(new THREE.IcosahedronGeometry(r * scale, 0), m);
    l.position.set(x * scale, y * scale, z * scale);
    l.castShadow = true;
    g.add(l);
  }
  return g;
}

export function floorPlant(tall = false) {
  const g = new THREE.Group();
  g.add(cyl(0.28, 0.22, 0.5, M.potLight, 0, 0.25, 0, 18));
  const leaves = tall
    ? [[0, 1.0, 0, 0.34], [0.16, 1.35, 0.06, 0.28], [-0.15, 1.5, -0.05, 0.26], [0.04, 1.85, 0, 0.24], [0, 0.7, 0.12, 0.26]]
    : [[0, 1.0, 0, 0.4], [0.18, 0.75, 0.1, 0.3], [-0.17, 0.8, -0.08, 0.3], [0.05, 1.3, -0.05, 0.25]];
  if (tall) g.add(cyl(0.03, 0.04, 1.4, M.walnut, 0, 1.0, 0, 8));
  leaves.forEach(([x, y, z, r], i) => {
    const l = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), i % 2 ? M.leafDark : M.leaf);
    l.position.set(x, y, z); l.castShadow = true;
    g.add(l);
  });
  return g;
}

export function rug(w, d, color, border) {
  const g = new THREE.Group();
  if (border) g.add(box(w, 0.02, d, mat(border, { roughness: 0.95 }), 0, 0.045, 0, false));
  g.add(box(border ? w - 0.3 : w, 0.025, border ? d - 0.3 : d, mat(color, { roughness: 0.95 }), 0, 0.05, 0, false));
  return g;
}

// Sofa facing +z. Returns the group plus local seat positions (for people to sit on).
export function couch(color, seats = 3) {
  const g = new THREE.Group();
  const w = seats * 0.75 + 0.3;
  const fabric = mat(color, { roughness: 0.9 });
  const cushion = mat(new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.12).getStyle(), { roughness: 0.9 });
  g.add(box(w, 0.4, 0.9, fabric, 0, 0.2, 0));
  g.add(box(w, 0.6, 0.22, fabric, 0, 0.6, -0.34));
  g.add(box(0.2, 0.55, 0.9, fabric, -w / 2 + 0.1, 0.35, 0));
  g.add(box(0.2, 0.55, 0.9, fabric, w / 2 - 0.1, 0.35, 0));
  const spots = [];
  for (let i = 0; i < seats; i++) {
    const x = -((seats - 1) * 0.75) / 2 + i * 0.75;
    g.add(box(0.7, 0.12, 0.66, cushion, x, 0.46, 0.06));
    spots.push(new THREE.Vector3(x, 0, 0.1));
  }
  return { group: g, spots, seatY: 0.52 };
}

export function coffeeTable(w = 1.2, d = 0.6) {
  const g = new THREE.Group();
  g.add(box(w, 0.06, d, M.walnut, 0, 0.4, 0));
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(box(0.05, 0.37, 0.05, M.metal, x * (w / 2 - 0.08), 0.185, z * (d / 2 - 0.08)));
  return g;
}

export function bookshelf(w = 1.6, h = 1.3) {
  const g = new THREE.Group();
  g.add(box(w, h, 0.4, mat('#f3efe8', { roughness: 0.7 }), 0, h / 2, 0));
  const colors = ['#e8835a', '#7b8cf0', '#3fa98c', '#d6337f', '#c9a96e', '#d9a63c', '#5b6b86'];
  for (let row = 0; row < 2; row++) {
    const y = 0.32 + row * (h / 2.2);
    g.add(box(w - 0.1, 0.03, 0.36, mat('#e2dbcf'), 0, y - 0.18, 0));
    for (let i = 0; i < 6; i++) g.add(box(0.12, 0.3, 0.26, mat(colors[(i + row * 3) % colors.length]), -w / 2 + 0.2 + i * 0.17, y, 0.03));
  }
  return g;
}
