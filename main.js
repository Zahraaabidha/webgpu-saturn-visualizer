/**
 * Saturn Visualizer - Main Entry Point
 *
 * Sets up the Three.js WebGPU renderer, camera + orbit controls, the Saturn
 * simulation, bloom + cinematic post-processing, config persistence and the
 * Tweakpane UI, then drives the render loop.
 */

import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SaturnSimulation } from './saturn.js';
import { SaturnUI } from './ui.js';
import { CameraAnimation } from './camera-animation.js';
import { createPostFXUniforms, applyPostFX } from './postfx.js';
import { BackgroundAudio } from './audio.js';

// ============================================================================
// LOCAL STORAGE
// ============================================================================

const STORAGE_KEY = 'saturn-visualizer-config';

const COLOR_PROPERTIES = [
  'zoneColor', 'beltColor', 'goldColor', 'poleColor', 'rimColor',
  'ringColorInner', 'ringColorOuter', 'sunColor', 'spaceColor',
  'nebula1Color', 'nebula2Color'
];

function normalizeColorToHex(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const r = Math.round(value.r ?? 0);
    const g = Math.round(value.g ?? 0);
    const b = Math.round(value.b ?? 0);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  return '#000000';
}

function loadConfig(defaults) {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      for (const key of COLOR_PROPERTIES) {
        if (parsed[key] !== undefined) parsed[key] = normalizeColorToHex(parsed[key]);
      }
      return { ...defaults, ...parsed };
    }
  } catch (e) {
    console.warn('Failed to load config from localStorage:', e);
  }
  return { ...defaults };
}

function saveConfig(config) {
  try {
    const normalized = { ...config };
    for (const key of COLOR_PROPERTIES) {
      if (normalized[key] !== undefined) normalized[key] = normalizeColorToHex(normalized[key]);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    console.log('Configuration saved to localStorage');
  } catch (e) {
    console.warn('Failed to save config to localStorage:', e);
  }
}

function clearConfig() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear config from localStorage:', e);
  }
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const defaultConfig = {
  // Planet geometry / animation
  planetRadius: 7.7,
  planetOblate: 0.93,
  axialTilt: 16.2,
  spinSpeed: 0.05,

  // Real texture (Solar System Scope, CC-BY 4.0, NASA-derived)
  textureBlend: 0.85,

  // Planet bands
  bandCount: 11,
  bandTurbScale: 1.4,
  bandWarp: 0.5,
  bandMicroCount: 34,
  bandMicroAmp: 0.12,
  bandShear: 0.35,
  bandEddyStrength: 0.3,
  zoneColor: '#f4e3b0',
  beltColor: '#9c7440',
  goldColor: '#f2c077',
  poleColor: '#7f92a3',
  poleTint: 0.35,

  // Planet lighting
  ambient: 0.05,
  terminatorSoftness: 0.22,
  limbDarkening: 0.5,
  rimStrength: 0.85,
  rimColor: '#ffd699',
  sunHotspotPower: 10,
  sunHotspotStrength: 0.55,

  // Rings (expressed as multiples of planetRadius so they scale with the planet)
  ringInnerRatio: 1.233,
  ringOuterRatio: 2.3,
  ringDetail: 30,
  ringContrast: 0.6,
  ringBrightness: 1.5,
  ringOpacity: 0.95,
  ringAmbient: 0.22,
  ringColorInner: '#c7a06a',
  ringColorOuter: '#ecdfc0',
  ringTextureBlend: 0.85,
  ringScatterStrength: 1.3,
  ringScatterPower: 4.0,

  // Shadows
  ringShadowStrength: 0.85,
  ringShadowDark: 0.12,

  // Sun
  sunAzimuth: 50,
  sunElevation: 16,
  sunColor: '#fff3d9',
  sunGlowEnabled: true,
  sunGlowIntensity: 1.4,

  // Stars
  spaceColor: '#000000',
  starsEnabled: true,
  starDensity: 0.08,
  starSize: 1.2,
  starBrightness: 0.7,

  // Nebula
  nebulaEnabled: true,
  nebula1Scale: 2.0,
  nebula1Density: 0.4,
  nebula1Brightness: 0.05,
  nebula1Color: '#2a1c10',
  nebula2Scale: 5.5,
  nebula2Density: 0.15,
  nebula2Brightness: 0.08,
  nebula2Color: '#241a2e',

  // Bloom
  // Threshold raised from 0.42 -> 0.85: at 0.42 nearly the entire sunlit
  // hemisphere (base albedo already sits ~0.7-0.95) qualified as "bright",
  // so bloom washed the whole globe to white and hid all surface detail.
  // 0.85 keeps bloom reserved for genuine highlights (hotspot, rim glow,
  // ring backlight) instead of blanket-blooming the lit disc.
  bloomStrength: 0.6,
  bloomRadius: 0.35,
  bloomThreshold: 0.85,

  // Post FX
  vignetteStrength: 0.4,
  vignetteRadius: 0.75,
  vignetteSoftness: 0.45,
  chromaticAberration: 0.25,
  filmGrainAmount: 0,
  filmGrainSize: 1.6,

  // Background music
  musicVolume: 1.0,
  musicMuted: false,

  // Starting camera view
  cameraPosition: { x: 0, y: 12, z: 34 },
  cameraTarget: { x: 0, y: 0, z: 0 },
};

const config = loadConfig(defaultConfig);

// ============================================================================
// SCENE SETUP
// ============================================================================

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(config.cameraPosition.x, config.cameraPosition.y, config.cameraPosition.z);
camera.lookAt(config.cameraTarget.x, config.cameraTarget.y, config.cameraTarget.z);

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

// ============================================================================
// ORBIT CONTROLS
// ============================================================================

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.rotateSpeed = 0.5;
controls.minDistance = 12;
controls.maxDistance = 200;
controls.target.set(config.cameraTarget.x, config.cameraTarget.y, config.cameraTarget.z);

// ============================================================================
// CAMERA ANIMATION
// ============================================================================

const cameraAnimation = new CameraAnimation(camera, controls);

// ============================================================================
// POST-PROCESSING
// ============================================================================

let postProcessing = null;
let bloomPassNode = null;
const postFX = createPostFXUniforms(config);

function setupBloom() {
  if (!postProcessing) return;
  const scenePass = pass(scene, camera);
  const scenePassColor = scenePass.getTextureNode();

  bloomPassNode = bloom(scenePassColor);
  bloomPassNode.threshold.value = config.bloomThreshold;
  bloomPassNode.strength.value = config.bloomStrength;
  bloomPassNode.radius.value = config.bloomRadius;

  const beforeFX = scenePassColor.add(bloomPassNode);
  postProcessing.outputNode = applyPostFX(beforeFX, postFX);
}

// ============================================================================
// SATURN SIMULATION
// ============================================================================

const saturn = new SaturnSimulation(scene, config);
saturn.createSaturn();

// ============================================================================
// BACKGROUND MUSIC
// ============================================================================

const music = new BackgroundAudio('/music.mp3', { volume: config.musicVolume });
music.setMuted(config.musicMuted);

// ============================================================================
// UI CONTROLS
// ============================================================================

const ui = new SaturnUI(config, {
  onUniformChange: (key, value) => {
    saturn.updateUniforms({ [key]: value });
  },

  onBloomChange: (property, value) => {
    if (bloomPassNode) bloomPassNode[property].value = value;
  },

  onPostFXChange: (key, value) => {
    if (postFX[key]) postFX[key].value = value;
  },

  onRegenerate: () => {
    saturn.updateUniforms(config);
    saturn.regenerate();
  },

  onSaveConfig: () => {
    config.cameraPosition = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    config.cameraTarget = { x: controls.target.x, y: controls.target.y, z: controls.target.z };
    saveConfig(config);
  },

  onClearConfig: () => {
    clearConfig();
    window.location.reload();
  },

  onResetToDefaults: () => {
    Object.assign(config, defaultConfig);
    saturn.updateUniforms(config);
    saturn.regenerate();
    if (bloomPassNode) {
      bloomPassNode.threshold.value = config.bloomThreshold;
      bloomPassNode.strength.value = config.bloomStrength;
      bloomPassNode.radius.value = config.bloomRadius;
    }
    for (const key of ['vignetteStrength', 'vignetteRadius', 'vignetteSoftness', 'chromaticAberration', 'filmGrainAmount', 'filmGrainSize']) {
      if (postFX[key]) postFX[key].value = config[key];
    }
  },

  onToggleCameraAnimation: () => cameraAnimation.toggle(),
  getCameraAnimationState: () => cameraAnimation.playing,

  onMusicVolumeChange: (value) => music.setVolume(value),
  onMusicMutedChange: (value) => music.setMuted(value),
});

// ============================================================================
// FPS COUNTER
// ============================================================================

let frameCount = 0;
let lastTime = performance.now();

function updateFPS() {
  frameCount++;
  const currentTime = performance.now();
  const deltaTime = currentTime - lastTime;
  if (deltaTime >= 1000) {
    const fps = Math.round((frameCount * 1000) / deltaTime);
    frameCount = 0;
    lastTime = currentTime;
    const fpsElement = document.getElementById('fps');
    if (fpsElement) fpsElement.textContent = fps;
    ui.updateFPS(fps);
  }
}

// ============================================================================
// ANIMATION LOOP
// ============================================================================

let lastFrameTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const currentTime = performance.now();
  const deltaTime = Math.min((currentTime - lastFrameTime) / 1000, 0.033);
  lastFrameTime = currentTime;

  cameraAnimation.update(deltaTime);
  controls.update();
  saturn.update(deltaTime);

  if (postProcessing) postProcessing.render();
  else renderer.render(scene, camera);

  updateFPS();
}

// ============================================================================
// WINDOW RESIZE
// ============================================================================

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================================
// INITIALIZATION
// ============================================================================

renderer.init().then(() => {
  postProcessing = new THREE.PostProcessing(renderer);
  setupBloom();
  animate();
}).catch(err => {
  console.error('Failed to initialize WebGPU renderer:', err);
  document.body.innerHTML = `
    <div style="color: white; padding: 20px; text-align: center; font-family: monospace;">
      <h1>WebGPU Not Supported</h1>
      <p>This demo requires a browser with WebGPU support.</p>
      <p>Try Chrome 113+ or Edge 113+ on desktop.</p>
    </div>
  `;
});
