// Articulated, blocky office people: legs with knees, arms with elbows,
// shirt/pants/shoes, hair. Faces +z in local space. Standing height ≈ 1.95.
import * as THREE from 'three';
import { mat, box } from './kit.js';

const SKIN = ['#f1cfb3', '#e0b18f', '#c68e68', '#8d5b3e'];
const HAIR = ['#2b2321', '#4a3426', '#7a5434', '#1d1d24', '#a8794e'];
const PANTS = ['#2f3644', '#3d3f4a', '#5a5246', '#27303c'];
const SHOES = ['#2a2a2e', '#5b4334', '#1f2329'];

export const HIP_Y = 0.95;
export const SEATED_DROP = 0.36; // root y offset when sitting on a 0.55 m seat

function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

// Deterministic look for a name (never random between page loads).
export function lookFor(name, shirt) {
  const h = hash(name);
  return {
    shirt, skin: SKIN[h % SKIN.length], hair: HAIR[(h >> 3) % HAIR.length],
    pants: PANTS[(h >> 6) % PANTS.length], shoes: SHOES[(h >> 9) % SHOES.length], hairStyle: (h >> 12) % 3,
  };
}

function limb(w, len, material, y0 = 0) {
  const m = box(w, len, w, material, 0, y0 - len / 2, 0);
  return m;
}

export function createPerson(look) {
  const p = new THREE.Group();
  const shirt = mat(look.shirt, { roughness: 0.8 });
  const pants = mat(look.pants, { roughness: 0.85 });
  const skin = mat(look.skin, { roughness: 0.7 });
  const hairM = mat(look.hair, { roughness: 0.9 });
  const shoes = mat(look.shoes, { roughness: 0.6 });
  const j = {};

  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0.11 * side, HIP_Y, 0);
    hip.add(limb(0.17, 0.44, pants));
    const knee = new THREE.Group();
    knee.position.y = -0.44;
    knee.add(limb(0.15, 0.47, pants));
    const shoe = box(0.16, 0.07, 0.27, shoes, 0, -0.47, 0.05);
    knee.add(shoe);
    hip.add(knee);
    p.add(hip);
    j[side < 0 ? 'legL' : 'legR'] = hip;
    j[side < 0 ? 'kneeL' : 'kneeR'] = knee;
  }

  const torso = new THREE.Group();
  p.add(torso);
  torso.add(box(0.46, 0.2, 0.27, pants, 0, HIP_Y + 0.02, 0)); // waist
  torso.add(box(0.5, 0.52, 0.29, shirt, 0, HIP_Y + 0.33, 0));  // shirt
  if (look.jacket) {
    const jm = mat(look.jacket, { roughness: 0.6 });
    torso.add(box(0.53, 0.5, 0.31, jm, 0, HIP_Y + 0.33, -0.005));
    torso.add(box(0.14, 0.42, 0.02, shirt, 0, HIP_Y + 0.37, 0.16)); // shirt front
    if (look.tie) torso.add(box(0.05, 0.32, 0.02, mat(look.tie), 0, HIP_Y + 0.35, 0.175));
  }
  torso.add(box(0.1, 0.08, 0.1, skin, 0, HIP_Y + 0.63, 0)); // neck

  const headPivot = new THREE.Group();
  headPivot.position.y = HIP_Y + 0.66;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 16), skin);
  head.position.y = 0.17; head.castShadow = true;
  headPivot.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.215, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
  cap.position.set(0, 0.19, -0.01); cap.castShadow = true;
  headPivot.add(cap);
  if (look.hairStyle === 1) headPivot.add(box(0.36, 0.34, 0.12, hairM, 0, 0.06, -0.14)); // long hair
  if (look.hairStyle === 2) { const bun = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), hairM); bun.position.set(0, 0.36, -0.12); headPivot.add(bun); }
  for (const side of [-1, 1]) { // eyes
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), mat('#2a2f38'));
    eye.position.set(0.07 * side, 0.19, 0.18);
    headPivot.add(eye);
  }
  torso.add(headPivot);
  j.head = headPivot;

  const sleeve = look.jacket ? mat(look.jacket, { roughness: 0.6 }) : shirt;
  for (const side of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(0.31 * side, HIP_Y + 0.52, 0);
    sh.add(limb(0.12, 0.3, sleeve));
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    elbow.add(limb(0.11, 0.26, sleeve));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), skin);
    hand.position.y = -0.3; hand.castShadow = true;
    elbow.add(hand);
    sh.add(elbow);
    torso.add(sh);
    j[side < 0 ? 'armL' : 'armR'] = sh;
    j[side < 0 ? 'elbowL' : 'elbowR'] = elbow;
  }
  j.torso = torso;
  p.userData.j = j;
  p.userData.phase = (hash(look.shirt + look.hair + look.skin) % 100) / 16; // per-person animation offset
  return p;
}

const POSES = {
  stand: { legL: 0, legR: 0, kneeL: 0, kneeR: 0, armL: 0.05, armR: 0.05, elbowL: -0.15, elbowR: -0.15, armLz: 0.08, armRz: -0.08 },
  sit:   { legL: -1.5, legR: -1.5, kneeL: 1.5, kneeR: 1.5, armL: -0.35, armR: -0.35, elbowL: -0.95, elbowR: -0.95, armLz: 0.05, armRz: -0.05 },
  type:  { legL: -1.5, legR: -1.5, kneeL: 1.5, kneeR: 1.5, armL: -0.75, armR: -0.75, elbowL: -0.85, elbowR: -0.85, armLz: 0.12, armRz: -0.12 },
  talk:  { legL: 0, legR: 0, kneeL: 0, kneeR: 0, armL: 0.05, armR: -0.55, elbowL: -0.15, elbowR: -0.9, armLz: 0.08, armRz: -0.15 },
};

// Blend joints toward the pose for `mode`, with procedural motion on top.
// modes: stand | walk | sit | type | talk
export function animatePerson(p, mode, t, dt, speed = 1) {
  const j = p.userData.j;
  const ph = t * 1 + p.userData.phase;
  let target;
  if (mode === 'walk') {
    const s = Math.sin(ph * 7 * speed);
    target = { legL: s * 0.55, legR: -s * 0.55, kneeL: Math.max(0, -s) * 0.7, kneeR: Math.max(0, s) * 0.7,
      armL: -s * 0.45, armR: s * 0.45, elbowL: -0.3, elbowR: -0.3, armLz: 0.08, armRz: -0.08 };
  } else {
    target = { ...POSES[mode] || POSES.stand };
    if (mode === 'type') { target.elbowL += Math.sin(ph * 14) * 0.08; target.elbowR += Math.sin(ph * 14 + 1.7) * 0.08; }
    if (mode === 'talk') { target.armR += Math.sin(ph * 3) * 0.25; target.elbowR += Math.sin(ph * 2.3) * 0.2; }
    if (mode === 'stand') { target.armL += Math.sin(ph * 1.3) * 0.03; target.armR -= Math.sin(ph * 1.3) * 0.03; }
  }
  const k = Math.min(1, dt * 10);
  for (const name of ['legL', 'legR', 'kneeL', 'kneeR', 'armL', 'armR', 'elbowL', 'elbowR']) {
    j[name].rotation.x += (target[name] - j[name].rotation.x) * k;
  }
  j.armL.rotation.z += (target.armLz - j.armL.rotation.z) * k;
  j.armR.rotation.z += (target.armRz - j.armR.rotation.z) * k;
  // head: look at the screen while typing, small nods while talking, gentle idle sway
  const nod = mode === 'type' ? -0.12 + Math.sin(ph * 9) * 0.03 : mode === 'talk' ? Math.sin(ph * 4) * 0.08 : Math.sin(ph * 0.7) * 0.03;
  j.head.rotation.x += (nod - j.head.rotation.x) * k;
  j.torso.position.y = mode === 'walk' ? Math.abs(Math.sin(ph * 7 * speed)) * 0.04 : mode === 'stand' || mode === 'talk' ? Math.sin(ph * 1.6) * 0.006 : 0;
}
