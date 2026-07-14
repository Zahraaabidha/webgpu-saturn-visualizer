/**
 * Tweakpane control panel for the Saturn visualizer.
 * Mirrors the reference project's structure: camera + save/load + performance
 * at the top, then folders for every group of shader parameters.
 */

import { Pane } from 'tweakpane';

export class SaturnUI {
  constructor(config, callbacks) {
    this.config = config;
    this.callbacks = callbacks;
    this.pane = new Pane({ title: 'Saturn Controls' });
    this.perfParams = { fps: 60 };
    this.setupUI();
  }

  setupUI() {
    this.setupCameraFolder();
    this.setupMusicFolder();
    this.setupConfigFolder();
    this.setupPerformanceFolder();
    this.setupPlanetFolder();
    this.setupRingsFolder();
    this.setupSunFolder();
    this.setupStarsFolder();
    this.setupNebulaFolder();
    this.setupBloomFolder();
    this.setupPostFXFolder();
  }

  // --- small binding helpers ------------------------------------------------

  /** Live uniform slider/color. */
  bind(folder, key, opts) {
    return folder.addBinding(this.config, key, opts).on('change', () => {
      this.callbacks.onUniformChange(key, this.config[key]);
    });
  }

  /** Slider that changes geometry -> rebuild the meshes. */
  bindGeo(folder, key, opts) {
    return folder.addBinding(this.config, key, opts).on('change', () => {
      this.callbacks.onRegenerate();
    });
  }

  // ==========================================================================
  // CAMERA
  // ==========================================================================

  setupCameraFolder() {
    const f = this.pane.addFolder({ title: 'Camera', expanded: true });
    this.cameraAnimState = { playing: false };
    this.animButton = f.addButton({ title: 'Start Cinematic Mode' }).on('click', () => {
      const playing = this.callbacks.onToggleCameraAnimation?.();
      this.cameraAnimState.playing = playing;
      this.animButton.title = playing ? 'Stop Cinematic Mode' : 'Start Cinematic Mode';
      this.showNotification(playing ? 'Cinematic mode started' : 'Cinematic mode stopped');
    });
    f.addBlade({ view: 'text', label: '', parse: (v) => String(v), value: 'Orbit flythrough' });
  }

  // ==========================================================================
  // MUSIC
  // ==========================================================================

  setupMusicFolder() {
    const f = this.pane.addFolder({ title: 'Music', expanded: true });
    f.addBinding(this.config, 'musicMuted', { label: 'Mute' })
      .on('change', () => this.callbacks.onMusicMutedChange?.(this.config.musicMuted));
    f.addBinding(this.config, 'musicVolume', { min: 0, max: 1, step: 0.01, label: 'Volume' })
      .on('change', () => this.callbacks.onMusicVolumeChange?.(this.config.musicVolume));
  }

  // ==========================================================================
  // SAVE / LOAD
  // ==========================================================================

  setupConfigFolder() {
    const f = this.pane.addFolder({ title: 'Save/Load', expanded: false });
    f.addButton({ title: 'Save Settings' }).on('click', () => {
      this.callbacks.onSaveConfig?.();
      this.showNotification('Settings saved!');
    });
    f.addButton({ title: 'Clear & Reload' }).on('click', () => {
      if (confirm('Clear saved settings and reload with defaults?')) this.callbacks.onClearConfig?.();
    });
    f.addButton({ title: 'Reset to Defaults' }).on('click', () => {
      if (confirm('Reset all settings to defaults?')) {
        this.callbacks.onResetToDefaults?.();
        this.pane.refresh();
        this.showNotification('Reset to defaults');
      }
    });
  }

  showNotification(message) {
    const n = document.createElement('div');
    n.textContent = message;
    n.style.cssText = `
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      background: rgba(0,0,0,0.8); color: #ffd27f; padding: 12px 24px;
      border-radius: 4px; font-family: monospace; font-size: 14px;
      z-index: 10000; pointer-events: none; opacity: 1; transition: opacity 0.3s ease;`;
    document.body.appendChild(n);
    setTimeout(() => { n.style.opacity = '0'; setTimeout(() => n.remove(), 300); }, 1500);
  }

  // ==========================================================================
  // PERFORMANCE
  // ==========================================================================

  setupPerformanceFolder() {
    const f = this.pane.addFolder({ title: 'Performance', expanded: false });
    f.addBinding(this.perfParams, 'fps', { readonly: true, label: 'FPS' });
  }

  // ==========================================================================
  // PLANET
  // ==========================================================================

  setupPlanetFolder() {
    const f = this.pane.addFolder({ title: 'Planet', expanded: true });

    this.bindGeo(f, 'planetRadius', { min: 3, max: 10, step: 0.1, label: 'Radius' });
    this.bindGeo(f, 'planetOblate', { min: 0.8, max: 1.0, step: 0.005, label: 'Oblateness' });
    this.bind(f, 'textureBlend', { min: 0, max: 1, step: 0.02, label: 'Real Texture Blend' });
    f.addBinding(this.config, 'axialTilt', { min: 0, max: 45, step: 0.5, label: 'Axial Tilt' })
      .on('change', () => this.callbacks.onUniformChange('axialTilt', this.config.axialTilt));
    f.addBinding(this.config, 'spinSpeed', { min: 0, max: 0.4, step: 0.005, label: 'Spin Speed' });

    const bands = f.addFolder({ title: 'Bands', expanded: true });
    this.bind(bands, 'bandCount', { min: 3, max: 24, step: 1, label: 'Count' });
    this.bind(bands, 'bandTurbScale', { min: 0.2, max: 4.0, step: 0.05, label: 'Turbulence' });
    this.bind(bands, 'bandWarp', { min: 0, max: 2.0, step: 0.05, label: 'Warp' });
    this.bind(bands, 'bandMicroCount', { min: 10, max: 80, step: 1, label: 'Micro-band Count' });
    this.bind(bands, 'bandMicroAmp', { min: 0, max: 0.4, step: 0.01, label: 'Micro-band Amount' });
    this.bind(bands, 'bandShear', { min: 0, max: 0.8, step: 0.02, label: 'Differential Rotation' });
    this.bind(bands, 'bandEddyStrength', { min: 0, max: 1, step: 0.02, label: 'Eddy Turbulence' });
    this.bind(bands, 'zoneColor', { label: 'Zone (light)' });
    this.bind(bands, 'beltColor', { label: 'Belt (dark)' });
    this.bind(bands, 'goldColor', { label: 'Accent' });
    this.bind(bands, 'poleColor', { label: 'Pole' });
    this.bind(bands, 'poleTint', { min: 0, max: 1, step: 0.02, label: 'Pole Tint' });

    const light = f.addFolder({ title: 'Lighting', expanded: false });
    this.bind(light, 'ambient', { min: 0, max: 0.4, step: 0.01, label: 'Ambient' });
    this.bind(light, 'terminatorSoftness', { min: 0.02, max: 0.6, step: 0.01, label: 'Terminator' });
    this.bind(light, 'limbDarkening', { min: 0.2, max: 1.0, step: 0.02, label: 'Limb Darkening' });
    this.bind(light, 'rimStrength', { min: 0, max: 2.0, step: 0.05, label: 'Atmos. Rim' });
    this.bind(light, 'rimColor', { label: 'Rim Color' });
    this.bind(light, 'sunHotspotPower', { min: 1, max: 40, step: 0.5, label: 'Hotspot Power' });
    this.bind(light, 'sunHotspotStrength', { min: 0, max: 2.0, step: 0.02, label: 'Hotspot Strength' });
  }

  // ==========================================================================
  // RINGS
  // ==========================================================================

  setupRingsFolder() {
    const f = this.pane.addFolder({ title: 'Rings', expanded: true });

    this.bindGeo(f, 'ringInnerRatio', { min: 1.05, max: 1.6, step: 0.005, label: 'Inner Radius (x planet)' });
    this.bindGeo(f, 'ringOuterRatio', { min: 1.8, max: 3.0, step: 0.01, label: 'Outer Radius (x planet)' });
    this.bind(f, 'ringDetail', { min: 5, max: 60, step: 1, label: 'Ringlet Detail' });
    this.bind(f, 'ringContrast', { min: 0, max: 1, step: 0.02, label: 'Ringlet Contrast' });
    this.bind(f, 'ringBrightness', { min: 0.2, max: 3.0, step: 0.05, label: 'Brightness' });
    this.bind(f, 'ringOpacity', { min: 0.2, max: 1.0, step: 0.02, label: 'Opacity' });
    this.bind(f, 'ringAmbient', { min: 0, max: 1, step: 0.02, label: 'Ambient' });
    this.bind(f, 'ringColorInner', { label: 'Inner Color' });
    this.bind(f, 'ringColorOuter', { label: 'Outer Color' });
    this.bind(f, 'ringTextureBlend', { min: 0, max: 1, step: 0.02, label: 'Real Texture Blend' });
    this.bind(f, 'ringScatterStrength', { min: 0, max: 3, step: 0.05, label: 'Backlit Glow' });
    this.bind(f, 'ringScatterPower', { min: 1, max: 12, step: 0.5, label: 'Backlit Glow Tightness' });
  }

  // ==========================================================================
  // SUN & SHADOWS
  // ==========================================================================

  setupSunFolder() {
    const f = this.pane.addFolder({ title: 'Sun & Shadows', expanded: false });

    f.addBinding(this.config, 'sunAzimuth', { min: 0, max: 360, step: 1, label: 'Sun Azimuth' })
      .on('change', () => this.callbacks.onUniformChange('sunAzimuth', this.config.sunAzimuth));
    f.addBinding(this.config, 'sunElevation', { min: -40, max: 40, step: 1, label: 'Sun Elevation' })
      .on('change', () => this.callbacks.onUniformChange('sunElevation', this.config.sunElevation));

    this.bind(f, 'ringShadowStrength', { min: 0, max: 1, step: 0.02, label: 'Ring Shadow' });
    this.bind(f, 'ringShadowDark', { min: 0, max: 0.6, step: 0.01, label: 'Planet Shadow' });

    const glow = f.addFolder({ title: 'Sun Glow', expanded: false });
    this.bind(glow, 'sunGlowEnabled', { label: 'Enable' });
    this.bind(glow, 'sunGlowIntensity', { min: 0, max: 4, step: 0.05, label: 'Intensity' });
    this.bind(glow, 'sunColor', { label: 'Color' });
  }

  // ==========================================================================
  // STARS
  // ==========================================================================

  setupStarsFolder() {
    const f = this.pane.addFolder({ title: 'Stars', expanded: false });
    this.bind(f, 'starsEnabled', { label: 'Enable Stars' });
    this.bind(f, 'spaceColor', { label: 'Space Color' });
    this.bind(f, 'starDensity', { min: 0.001, max: 0.2, step: 0.001, label: 'Density' });
    this.bind(f, 'starSize', { min: 0.5, max: 5.0, step: 0.1, label: 'Size' });
    this.bind(f, 'starBrightness', { min: 0.1, max: 3.0, step: 0.1, label: 'Brightness' });
  }

  // ==========================================================================
  // NEBULA
  // ==========================================================================

  setupNebulaFolder() {
    const f = this.pane.addFolder({ title: 'Nebula', expanded: false });
    this.bind(f, 'nebulaEnabled', { label: 'Enable Nebula' });

    const l1 = f.addFolder({ title: 'Layer 1', expanded: false });
    this.bind(l1, 'nebula1Scale', { min: 0.5, max: 10, step: 0.5, label: 'Scale' });
    this.bind(l1, 'nebula1Density', { min: -1, max: 1, step: 0.05, label: 'Density' });
    this.bind(l1, 'nebula1Brightness', { min: 0, max: 0.5, step: 0.005, label: 'Brightness' });
    this.bind(l1, 'nebula1Color', { label: 'Color' });

    const l2 = f.addFolder({ title: 'Layer 2', expanded: false });
    this.bind(l2, 'nebula2Scale', { min: 0.5, max: 20, step: 0.5, label: 'Scale' });
    this.bind(l2, 'nebula2Density', { min: -1, max: 1, step: 0.05, label: 'Density' });
    this.bind(l2, 'nebula2Brightness', { min: 0, max: 0.5, step: 0.005, label: 'Brightness' });
    this.bind(l2, 'nebula2Color', { label: 'Color' });
  }

  // ==========================================================================
  // BLOOM
  // ==========================================================================

  setupBloomFolder() {
    const f = this.pane.addFolder({ title: 'Bloom', expanded: false });
    f.addBinding(this.config, 'bloomStrength', { min: 0, max: 3, step: 0.01, label: 'Strength' })
      .on('change', () => this.callbacks.onBloomChange('strength', this.config.bloomStrength));
    f.addBinding(this.config, 'bloomRadius', { min: 0, max: 1, step: 0.01, label: 'Radius' })
      .on('change', () => this.callbacks.onBloomChange('radius', this.config.bloomRadius));
    f.addBinding(this.config, 'bloomThreshold', { min: 0, max: 1, step: 0.01, label: 'Threshold' })
      .on('change', () => this.callbacks.onBloomChange('threshold', this.config.bloomThreshold));
  }

  // ==========================================================================
  // CINEMATIC FX
  // ==========================================================================

  setupPostFXFolder() {
    const f = this.pane.addFolder({ title: 'Cinematic FX', expanded: false });
    f.addBinding(this.config, 'chromaticAberration', { min: 0, max: 2, step: 0.01, label: 'Chromatic Aberration' })
      .on('change', () => this.callbacks.onPostFXChange('chromaticAberration', this.config.chromaticAberration));

    const vig = f.addFolder({ title: 'Vignette', expanded: false });
    vig.addBinding(this.config, 'vignetteStrength', { min: 0, max: 1, step: 0.01, label: 'Strength' })
      .on('change', () => this.callbacks.onPostFXChange('vignetteStrength', this.config.vignetteStrength));
    vig.addBinding(this.config, 'vignetteRadius', { min: 0, max: 1.2, step: 0.01, label: 'Radius' })
      .on('change', () => this.callbacks.onPostFXChange('vignetteRadius', this.config.vignetteRadius));
    vig.addBinding(this.config, 'vignetteSoftness', { min: 0.01, max: 1.2, step: 0.01, label: 'Softness' })
      .on('change', () => this.callbacks.onPostFXChange('vignetteSoftness', this.config.vignetteSoftness));

    const grain = f.addFolder({ title: 'Film Grain', expanded: false });
    grain.addBinding(this.config, 'filmGrainAmount', { min: 0, max: 0.3, step: 0.005, label: 'Amount' })
      .on('change', () => this.callbacks.onPostFXChange('filmGrainAmount', this.config.filmGrainAmount));
    grain.addBinding(this.config, 'filmGrainSize', { min: 0.2, max: 5, step: 0.1, label: 'Grain Size' })
      .on('change', () => this.callbacks.onPostFXChange('filmGrainSize', this.config.filmGrainSize));
  }

  // ==========================================================================
  // PUBLIC
  // ==========================================================================

  updateFPS(fps) {
    this.perfParams.fps = fps;
    this.pane.refresh();
  }
}
