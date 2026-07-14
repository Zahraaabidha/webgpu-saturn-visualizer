/**
 * Cinematic camera flythrough.
 * Catmull-Rom spline through a set of keyframes for smooth, pause-free motion
 * that orbits Saturn and opens/closes the ring plane toward the viewer.
 */

import * as THREE from 'three/webgpu';

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

// Perlin's smootherstep — used *only* for the one-time blend-in from the
// user's current camera position when cinematic mode starts. NOT used for
// per-segment playback: easing velocity to zero at every keyframe boundary
// is what makes a spline flythrough look like it stops and starts, since our
// keyframes are ~5-6s apart, that reads as "pausing every six seconds".
// Real fluid motion instead comes from arc-length reparametrization below.
function smootherstep(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Keyframes chosen to sweep around the planet and vary the ring-plane opening.
const cinematicKeyframes = [
  { position: { x: 0, y: 10, z: 34 }, target: { x: 0, y: 0, z: 0 }, duration: 6 },   // 3/4 wide shot, rings open
  { position: { x: 28, y: 4, z: 18 }, target: { x: 0, y: 0, z: 0 }, duration: 5 },   // swing round the side
  { position: { x: 30, y: 1.5, z: -6 }, target: { x: 0, y: 0, z: 0 }, duration: 5 }, // near ring-plane, edge-on
  { position: { x: 6, y: -14, z: -30 }, target: { x: 0, y: 0, z: 0 }, duration: 6 }, // under the rings
  { position: { x: -22, y: -6, z: -20 }, target: { x: 0, y: 0, z: 0 }, duration: 5 },// back around the far side
  { position: { x: -26, y: 12, z: 16 }, target: { x: 0, y: 0, z: 0 }, duration: 6 }, // rise back to a hero angle
];

// Every keyframe above targets the planet's center, so the look-at point
// never actually moves — only camera position needs arc-length correction.
const ARC_SAMPLES = 480;

export class CameraAnimation {
  constructor(camera, controls) {
    this.camera = camera;
    this.controls = controls;
    this.keyframes = cinematicKeyframes;

    this.isPlaying = false;
    this.currentTime = 0;
    this.elapsedSinceStart = 0;
    this.totalDuration = this.calculateTotalDuration();

    // Smoothly ease the camera from wherever the user left it into the
    // flythrough's start, instead of snapping there on the first frame.
    this.blendInDuration = 2.5;

    this.tempPosition = new THREE.Vector3();
    this.tempTarget = new THREE.Vector3();
    this.originalPosition = new THREE.Vector3();
    this.originalTarget = new THREE.Vector3();

    this.buildArcLengthTable();
  }

  calculateTotalDuration() {
    return this.keyframes.reduce((sum, kf) => sum + kf.duration, 0);
  }

  getKeyframe(index) {
    const len = this.keyframes.length;
    return this.keyframes[((index % len) + len) % len];
  }

  // ==========================================================================
  // ARC-LENGTH REPARAMETRIZATION
  //
  // Catmull-Rom parametrized by raw keyframe duration moves at constant
  // *parametric* speed per segment, not constant *physical* speed — a short
  // segment with a long duration crawls, a long segment with a short
  // duration rushes, and averaged across the whole loop that unevenness
  // reads as the camera hitching near certain keyframes. Sampling the curve
  // once up front and walking it by cumulative distance instead of
  // cumulative time gives genuinely uniform dolly speed with zero per-frame
  // cost (one binary search per frame).
  // ==========================================================================

  /** Raw (non-arc-corrected) position on the spline at a given global time. */
  rawPositionAt(globalTime, out) {
    const wrapped = ((globalTime % this.totalDuration) + this.totalDuration) % this.totalDuration;
    const info = this.getKeyframeInfo(wrapped);
    const t = info.duration > 0 ? info.localTime / info.duration : 0;
    const p0 = this.getKeyframe(info.index - 1);
    const p1 = this.getKeyframe(info.index);
    const p2 = this.getKeyframe(info.index + 1);
    const p3 = this.getKeyframe(info.index + 2);
    return out.set(
      catmullRom(p0.position.x, p1.position.x, p2.position.x, p3.position.x, t),
      catmullRom(p0.position.y, p1.position.y, p2.position.y, p3.position.y, t),
      catmullRom(p0.position.z, p1.position.z, p2.position.z, p3.position.z, t)
    );
  }

  buildArcLengthTable() {
    const table = new Float64Array(ARC_SAMPLES + 1);
    const scratch = new THREE.Vector3();
    const prev = this.rawPositionAt(0, scratch).clone();
    let total = 0;
    table[0] = 0;
    for (let i = 1; i <= ARC_SAMPLES; i++) {
      const t = (i / ARC_SAMPLES) * this.totalDuration;
      this.rawPositionAt(t, scratch);
      total += prev.distanceTo(scratch);
      table[i] = total;
      prev.copy(scratch);
    }
    this.arcTable = table;
    this.totalArcLength = total;
  }

  /** Binary-search the arc table for the parametric time at a given distance along the path. */
  arcLengthToTime(targetDistance) {
    const table = this.arcTable;
    if (targetDistance <= 0) return 0;
    if (targetDistance >= this.totalArcLength) return this.totalDuration;

    let lo = 0, hi = ARC_SAMPLES;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (table[mid] < targetDistance) lo = mid + 1; else hi = mid;
    }
    const i1 = lo, i0 = Math.max(0, lo - 1);
    const d0 = table[i0], d1 = table[i1];
    const segFrac = d1 > d0 ? (targetDistance - d0) / (d1 - d0) : 0;
    const time0 = (i0 / ARC_SAMPLES) * this.totalDuration;
    const time1 = (i1 / ARC_SAMPLES) * this.totalDuration;
    return time0 + (time1 - time0) * segFrac;
  }

  // ==========================================================================
  // PLAYBACK
  // ==========================================================================

  start() {
    if (this.isPlaying) return;
    this.originalPosition.copy(this.camera.position);
    this.originalTarget.copy(this.controls.target);
    this.controls.enabled = false;
    this.isPlaying = true;
    this.currentTime = 0;
    this.elapsedSinceStart = 0; // unlike currentTime, never wraps — gates the one-time blend-in
  }

  stop() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.controls.enabled = true;
    this.controls.target.copy(this.tempTarget);
  }

  toggle() {
    if (this.isPlaying) this.stop();
    else this.start();
    return this.isPlaying;
  }

  getKeyframeInfo(globalTime) {
    let accumulatedTime = 0;
    for (let i = 0; i < this.keyframes.length; i++) {
      const kf = this.keyframes[i];
      if (globalTime < accumulatedTime + kf.duration) {
        return { index: i, localTime: globalTime - accumulatedTime, duration: kf.duration };
      }
      accumulatedTime += kf.duration;
    }
    const lastIndex = this.keyframes.length - 1;
    return { index: lastIndex, localTime: this.keyframes[lastIndex].duration, duration: this.keyframes[lastIndex].duration };
  }

  interpolateSpline(index, t) {
    const p0 = this.getKeyframe(index - 1);
    const p1 = this.getKeyframe(index);
    const p2 = this.getKeyframe(index + 1);
    const p3 = this.getKeyframe(index + 2);

    this.tempPosition.set(
      catmullRom(p0.position.x, p1.position.x, p2.position.x, p3.position.x, t),
      catmullRom(p0.position.y, p1.position.y, p2.position.y, p3.position.y, t),
      catmullRom(p0.position.z, p1.position.z, p2.position.z, p3.position.z, t)
    );
    this.tempTarget.set(
      catmullRom(p0.target.x, p1.target.x, p2.target.x, p3.target.x, t),
      catmullRom(p0.target.y, p1.target.y, p2.target.y, p3.target.y, t),
      catmullRom(p0.target.z, p1.target.z, p2.target.z, p3.target.z, t)
    );
  }

  update(deltaTime) {
    if (!this.isPlaying) return;
    this.currentTime += deltaTime;
    this.elapsedSinceStart += deltaTime;
    if (this.currentTime >= this.totalDuration) {
      this.currentTime = this.currentTime % this.totalDuration;
    }

    // Walk the path by constant distance-per-second (arc length) rather than
    // constant time-per-segment, so speed is uniform along the whole loop —
    // no lingering near any keyframe, no rushing through others.
    const targetDistance = (this.currentTime / this.totalDuration) * this.totalArcLength;
    const remappedTime = this.arcLengthToTime(targetDistance);
    const info = this.getKeyframeInfo(remappedTime);
    const t = info.duration > 0 ? info.localTime / info.duration : 0;
    this.interpolateSpline(info.index, t);

    // Ease in from the camera's actual position/target when playback starts
    // (gated on elapsedSinceStart, which never wraps, so this only fires
    // once — not on every subsequent lap of the loop) so starting cinematic
    // mode never produces a hard cut from wherever the user had orbited to.
    if (this.elapsedSinceStart < this.blendInDuration) {
      const blend = smootherstep(this.elapsedSinceStart / this.blendInDuration);
      this.tempPosition.lerpVectors(this.originalPosition, this.tempPosition, blend);
      this.tempTarget.lerpVectors(this.originalTarget, this.tempTarget, blend);
    }

    this.camera.position.copy(this.tempPosition);
    this.controls.target.copy(this.tempTarget);
    this.camera.lookAt(this.tempTarget);
  }

  getProgress() {
    return this.currentTime / this.totalDuration;
  }

  get playing() {
    return this.isPlaying;
  }
}
