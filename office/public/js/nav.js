// Walking routes through the office. Rooms sit in a grid; each has one door
// on its front (+z) wall. Corridors run along the front of every row, and
// vertical gaps between columns (plus the outer margins) connect the rows.
// A route: (exit current spot) → door → corridor → (vertical gap) → corridor
// → target door → approach waypoints → target spot.
import * as THREE from 'three';
import { ROOM_W, ROOM_D, DOOR_IN } from './rooms.js';

export class Nav {
  constructor({ cols, rows, gap, centers }) {
    this.cols = cols; this.rows = rows; this.gap = gap; this.centers = centers; // centers[i] = Vector3
    const totalW = cols * ROOM_W + (cols - 1) * gap;
    this.gapXs = [-totalW / 2 - 1.4, totalW / 2 + 1.4];
    for (let c = 1; c < cols; c++) this.gapXs.push(-totalW / 2 + c * (ROOM_W + gap) - gap / 2);
  }
  row(i) { return Math.floor(i / this.cols); }
  lineZ(row) { return this.centers[row * this.cols].z + ROOM_D / 2 + this.gap / 2; }
  toWorld(i, local) { return local.clone().add(this.centers[i]).setY(0); }
  doorIn(i) { return this.toWorld(i, DOOR_IN); }
  doorOut(i) { const c = this.centers[i]; return new THREE.Vector3(c.x, 0, this.lineZ(this.row(i))); }
  cellAt(p) {
    return this.centers.findIndex((c) => Math.abs(p.x - c.x) < ROOM_W / 2 && Math.abs(p.z - c.z) < ROOM_D / 2);
  }
  nearestRow(z) {
    let best = 0;
    for (let r = 1; r < this.rows; r++) if (Math.abs(this.lineZ(r) - z) < Math.abs(this.lineZ(best) - z)) best = r;
    return best;
  }

  // from: world position; exit: world waypoints that leave the current spot;
  // dest: { cell, approach: [world], pos: world }
  route(from, exit, dest) {
    const pts = [];
    const ci = this.cellAt(from);
    if (ci === dest.cell && ci >= 0) return [...exit, ...dest.approach, dest.pos];
    let cur, curRow;
    if (ci >= 0) {
      pts.push(...exit, this.doorIn(ci), this.doorOut(ci));
      cur = this.doorOut(ci); curRow = this.row(ci);
    } else {
      curRow = this.nearestRow(from.z);
      cur = new THREE.Vector3(from.x, 0, this.lineZ(curRow));
      pts.push(cur);
    }
    const out = this.doorOut(dest.cell);
    const destRow = this.row(dest.cell);
    if (curRow !== destRow) {
      const mid = (cur.x + out.x) / 2;
      const g = this.gapXs.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a));
      pts.push(new THREE.Vector3(g, 0, this.lineZ(curRow)), new THREE.Vector3(g, 0, this.lineZ(destRow)));
    }
    pts.push(out, this.doorIn(dest.cell), ...dest.approach, dest.pos);
    return pts;
  }
}
