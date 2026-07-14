/**
 * Saturn simulation: geometry, materials and uniform management.
 *
 * Builds a tilted group holding the oblate planet mesh and the flat ring mesh
 * (so a single axial-tilt rotation orients the whole system), plus a large
 * inverted background sphere for the procedural sky. All shader parameters live
 * as TSL uniforms here and are updated live from the UI.
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createPlanetShader, createRingShader } from './saturn-shader.js';
import { createBackgroundShader } from './background-shader.js';

const DEG2RAD = Math.PI / 180;

export class SaturnSimulation {
  constructor(scene, config) {
    this.scene = scene;
    this.config = config;
    this.group = null;
    this.planetMesh = null;
    this.ringMesh = null;
    this.backgroundMesh = null;
    this.time = 0;
    this.initializeUniforms(config);
  }

  /**
   * Ring inner/outer radii as absolute planet-plane distances, derived from
   * planetRadius * ratio so the rings always scale with the planet (real
   * Saturn's C ring starts at ~1.11 planet radii, A ring ends at ~2.27).
   */
  ringRadii(config) {
    const radius = config.planetRadius ?? 6.0;
    return {
      inner: radius * (config.ringInnerRatio ?? 1.233),
      outer: radius * (config.ringOuterRatio ?? 2.3)
    };
  }

  /** Real NASA/JPL-derived Saturn albedo (Solar System Scope, CC-BY 4.0), equirectangular. */
  loadSaturnMap() {
    const tex = new THREE.TextureLoader().load('/saturn_2k.jpg');
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 8;
    return tex;
  }

  /** Real Cassini-derived ring radial density/alpha profile (same source), 1D across width. */
  loadRingAlphaMap() {
    const tex = new THREE.TextureLoader().load('/saturn_ring_alpha_2k.png');
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  initializeUniforms(config) {
    this.uniforms = {
      // === Planet geometry / animation ===
      planetRadius: uniform(config.planetRadius ?? 6.0),
      spinPhase: uniform(0.0),
      time: uniform(0.0),

      // === Real texture maps (not scalar uniforms — sampled directly via texture() in TSL) ===
      saturnMap: this.loadSaturnMap(),
      ringAlphaMap: this.loadRingAlphaMap(),
      textureBlend: uniform(config.textureBlend ?? 0.85),

      // === Planet bands ===
      bandCount: uniform(config.bandCount ?? 11.0),
      bandTurbScale: uniform(config.bandTurbScale ?? 1.6),
      bandWarp: uniform(config.bandWarp ?? 0.7),
      bandMicroCount: uniform(config.bandMicroCount ?? 34.0),
      bandMicroAmp: uniform(config.bandMicroAmp ?? 0.12),
      bandShear: uniform(config.bandShear ?? 0.35),
      bandEddyStrength: uniform(config.bandEddyStrength ?? 0.3),
      zoneColor: uniform(new THREE.Color(config.zoneColor ?? '#e8d9b0')),
      beltColor: uniform(new THREE.Color(config.beltColor ?? '#b18f5c')),
      goldColor: uniform(new THREE.Color(config.goldColor ?? '#d8b877')),
      poleColor: uniform(new THREE.Color(config.poleColor ?? '#8f9a9a')),
      poleTint: uniform(config.poleTint ?? 0.45),

      // === Planet lighting ===
      ambient: uniform(config.ambient ?? 0.06),
      terminatorSoftness: uniform(config.terminatorSoftness ?? 0.28),
      limbDarkening: uniform(config.limbDarkening ?? 0.55),
      rimStrength: uniform(config.rimStrength ?? 0.5),
      rimColor: uniform(new THREE.Color(config.rimColor ?? '#ffdca8')),
      sunHotspotPower: uniform(config.sunHotspotPower ?? 10.0),
      sunHotspotStrength: uniform(config.sunHotspotStrength ?? 0.55),

      // === Rings geometry / appearance ===
      // Stored as absolute radii but always derived from planetRadius * ratio
      // (see ringRadii()) so the rings scale with the planet instead of
      // drifting independently.
      ringInner: uniform(this.ringRadii(config).inner),
      ringOuter: uniform(this.ringRadii(config).outer),
      ringDetail: uniform(config.ringDetail ?? 26.0),
      ringContrast: uniform(config.ringContrast ?? 0.55),
      ringBrightness: uniform(config.ringBrightness ?? 1.4),
      ringOpacity: uniform(config.ringOpacity ?? 0.95),
      ringAmbient: uniform(config.ringAmbient ?? 0.25),
      ringColorInner: uniform(new THREE.Color(config.ringColorInner ?? '#b9a37c')),
      ringColorOuter: uniform(new THREE.Color(config.ringColorOuter ?? '#d8cdb4')),
      ringTextureBlend: uniform(config.ringTextureBlend ?? 0.85),
      ringScatterStrength: uniform(config.ringScatterStrength ?? 1.3),
      ringScatterPower: uniform(config.ringScatterPower ?? 4.0),

      // === Shadows ===
      ringShadowStrength: uniform(config.ringShadowStrength ?? 0.85),
      ringShadowDark: uniform(config.ringShadowDark ?? 0.12),

      // === Sun / lighting direction ===
      sunDirection: uniform(new THREE.Vector3(1, 0.3, 0.4).normalize()),      // local (untilted) frame
      sunDirectionWorld: uniform(new THREE.Vector3(1, 0.3, 0.4).normalize()), // world frame (for glow)
      sunColor: uniform(new THREE.Color(config.sunColor ?? '#fff2d6')),
      sunGlowEnabled: uniform(config.sunGlowEnabled ? 1.0 : 0.0),
      sunGlowIntensity: uniform(config.sunGlowIntensity ?? 1.2),

      // === Background: stars ===
      spaceColor: uniform(new THREE.Color(config.spaceColor ?? '#000000')),
      starsEnabled: uniform(config.starsEnabled ? 1.0 : 0.0),
      starDensity: uniform(config.starDensity ?? 0.08),
      starSize: uniform(config.starSize ?? 1.2),
      starBrightness: uniform(config.starBrightness ?? 0.7),

      // === Background: nebula ===
      nebulaEnabled: uniform(config.nebulaEnabled ? 1.0 : 0.0),
      nebula1Scale: uniform(config.nebula1Scale ?? 2.0),
      nebula1Density: uniform(config.nebula1Density ?? 0.4),
      nebula1Brightness: uniform(config.nebula1Brightness ?? 0.05),
      nebula1Color: uniform(new THREE.Color(config.nebula1Color ?? '#2a1c10')),
      nebula2Scale: uniform(config.nebula2Scale ?? 5.5),
      nebula2Density: uniform(config.nebula2Density ?? 0.15),
      nebula2Brightness: uniform(config.nebula2Brightness ?? 0.08),
      nebula2Color: uniform(new THREE.Color(config.nebula2Color ?? '#241a2e'))
    };
  }

  // ==========================================================================
  // MESH CONSTRUCTION
  // ==========================================================================

  createSaturn() {
    this.disposeMeshes();

    const config = this.config;

    // --- Tilted system group (axial tilt orients planet + rings together) ---
    this.group = new THREE.Group();
    this.group.rotation.x = (config.axialTilt ?? 26.7) * DEG2RAD;
    this.scene.add(this.group);

    // --- Planet: oblate sphere (poles flattened) ---
    const radius = config.planetRadius ?? 6.0;
    const oblate = config.planetOblate ?? 0.9;
    const planetGeo = new THREE.SphereGeometry(radius, 128, 96);
    planetGeo.scale(1, oblate, 1); // bakes oblateness into positions + normals

    const planetMat = new THREE.MeshBasicNodeMaterial();
    planetMat.colorNode = createPlanetShader(this.uniforms);

    this.planetMesh = new THREE.Mesh(planetGeo, planetMat);
    this.planetMesh.renderOrder = 0;
    this.group.add(this.planetMesh);

    // --- Rings: flat annulus in the XZ plane (y = 0) ---
    const { inner: ringInner, outer: ringOuter } = this.ringRadii(config);
    const ringGeo = new THREE.RingGeometry(ringInner, ringOuter, 256, 64);
    ringGeo.rotateX(-Math.PI / 2); // lay flat into the ring plane

    const ringShader = createRingShader(this.uniforms);
    const ringMat = new THREE.MeshBasicNodeMaterial();
    ringMat.colorNode = ringShader.colorNode;
    ringMat.opacityNode = ringShader.opacityNode;
    ringMat.transparent = true;
    ringMat.side = THREE.DoubleSide;
    ringMat.depthWrite = false;

    this.ringMesh = new THREE.Mesh(ringGeo, ringMat);
    this.ringMesh.renderOrder = 1;
    this.group.add(this.ringMesh);

    // --- Background sky (large inverted sphere) ---
    const bgGeo = new THREE.SphereGeometry(500, 64, 32);
    const bgMat = new THREE.MeshBasicNodeMaterial();
    bgMat.colorNode = createBackgroundShader(this.uniforms);
    bgMat.side = THREE.BackSide;
    bgMat.depthWrite = false;
    this.backgroundMesh = new THREE.Mesh(bgGeo, bgMat);
    this.backgroundMesh.renderOrder = -1;
    this.backgroundMesh.frustumCulled = false;
    this.scene.add(this.backgroundMesh);

    this.updateSunDirection();
  }

  disposeMeshes() {
    for (const mesh of [this.planetMesh, this.ringMesh, this.backgroundMesh]) {
      if (mesh) {
        mesh.parent?.remove(mesh);
        mesh.material?.dispose();
        mesh.geometry?.dispose();
      }
    }
    if (this.group) {
      this.scene.remove(this.group);
      this.group = null;
    }
    this.planetMesh = this.ringMesh = this.backgroundMesh = null;
  }

  // ==========================================================================
  // SUN DIRECTION
  // ==========================================================================

  /**
   * Recompute the local + world sun direction from the azimuth/elevation
   * config and the current group tilt. Local drives lighting/shadows; world
   * drives the background sun glow.
   */
  updateSunDirection() {
    const az = (this.config.sunAzimuth ?? 40) * DEG2RAD;
    const el = (this.config.sunElevation ?? 12) * DEG2RAD;

    const local = new THREE.Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az)
    ).normalize();
    this.uniforms.sunDirection.value.copy(local);

    // Express the same direction in world space using the group's tilt.
    const world = local.clone();
    if (this.group) {
      this.group.updateMatrixWorld(true);
      world.applyQuaternion(this.group.quaternion);
    }
    this.uniforms.sunDirectionWorld.value.copy(world.normalize());
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  updateUniforms(config) {
    const u = this.uniforms;
    const setF = (key) => { if (config[key] !== undefined) u[key].value = config[key]; };
    const setB = (key) => { if (config[key] !== undefined) u[key].value = config[key] ? 1.0 : 0.0; };
    const setC = (key) => {
      if (config[key] === undefined) return;
      const v = config[key];
      // Tweakpane may hand back a hex string or an {r,g,b} object (0-255).
      if (typeof v === 'string' || typeof v === 'number') u[key].value.set(v);
      else if (v && typeof v === 'object') u[key].value.setRGB((v.r ?? 0) / 255, (v.g ?? 0) / 255, (v.b ?? 0) / 255);
    };

    // Geometry radii (also update the uniforms so shadow/density math matches
    // the rebuilt meshes; the UI pairs these with a regenerate()).
    setF('planetRadius');
    if (config.planetRadius !== undefined || config.ringInnerRatio !== undefined || config.ringOuterRatio !== undefined) {
      const { inner, outer } = this.ringRadii(config);
      u.ringInner.value = inner;
      u.ringOuter.value = outer;
    }

    setF('textureBlend');

    // Planet bands
    ['bandCount', 'bandTurbScale', 'bandWarp', 'bandMicroCount', 'bandMicroAmp',
      'bandShear', 'bandEddyStrength', 'poleTint'].forEach(setF);
    ['zoneColor', 'beltColor', 'goldColor', 'poleColor'].forEach(setC);

    // Planet lighting
    ['ambient', 'terminatorSoftness', 'limbDarkening', 'rimStrength', 'sunHotspotPower', 'sunHotspotStrength'].forEach(setF);
    setC('rimColor');

    // Rings
    ['ringDetail', 'ringContrast', 'ringBrightness', 'ringOpacity', 'ringAmbient',
      'ringTextureBlend', 'ringScatterStrength', 'ringScatterPower'].forEach(setF);
    ['ringColorInner', 'ringColorOuter'].forEach(setC);

    // Shadows
    ['ringShadowStrength', 'ringShadowDark'].forEach(setF);

    // Sun
    setC('sunColor');
    setB('sunGlowEnabled');
    setF('sunGlowIntensity');

    // Stars
    setC('spaceColor');
    setB('starsEnabled');
    ['starDensity', 'starSize', 'starBrightness'].forEach(setF);

    // Nebula
    setB('nebulaEnabled');
    ['nebula1Scale', 'nebula1Density', 'nebula1Brightness',
      'nebula2Scale', 'nebula2Density', 'nebula2Brightness'].forEach(setF);
    ['nebula1Color', 'nebula2Color'].forEach(setC);

    // Direction-dependent config
    if (config.axialTilt !== undefined && this.group) {
      this.group.rotation.x = config.axialTilt * DEG2RAD;
    }
    if (config.sunAzimuth !== undefined || config.sunElevation !== undefined || config.axialTilt !== undefined) {
      this.updateSunDirection();
    }
  }

  update(deltaTime) {
    this.time += deltaTime;
    this.uniforms.time.value = this.time;
    this.uniforms.spinPhase.value = this.time * (this.config.spinSpeed ?? 0.05);
  }

  regenerate() {
    this.createSaturn();
  }
}
