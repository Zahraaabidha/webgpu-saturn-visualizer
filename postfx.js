/**
 * Cinematic post-processing chain (Three.js TSL).
 * Vignette + film grain as a colour-grading pass, plus chromatic aberration
 * that resamples the source texture per channel. Applied after bloom.
 */

import { uniform, vec2, vec3, float, Fn, screenUV, time, fract, sin, dot, smoothstep, length } from 'three/tsl';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';

// Cheap hash-based white noise (same family as the shared noise idiom).
const grainHash = Fn(([p]) => {
  const n = sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453);
  return fract(n);
});

export function createPostFXUniforms(config) {
  return {
    vignetteStrength: uniform(config.vignetteStrength ?? 0.4),
    vignetteRadius: uniform(config.vignetteRadius ?? 0.75),
    vignetteSoftness: uniform(config.vignetteSoftness ?? 0.45),
    chromaticAberration: uniform(config.chromaticAberration ?? 0.25),
    filmGrainAmount: uniform(config.filmGrainAmount ?? 0.03),
    filmGrainSize: uniform(config.filmGrainSize ?? 1.6),
  };
}

function applyVignetteAndGrain(colorNode, fx) {
  return Fn(() => {
    const uv = screenUV;
    const centered = uv.sub(0.5);

    // Radial vignette darkening from the screen centre.
    const dist = length(centered);
    const vignette = float(1.0).sub(
      smoothstep(fx.vignetteRadius, fx.vignetteRadius.add(fx.vignetteSoftness).max(fx.vignetteRadius.add(0.001)), dist)
        .mul(fx.vignetteStrength)
    );

    // Time-varying film grain, added (not multiplied) so it doesn't crush shadows.
    const grainUV = uv.mul(fx.filmGrainSize).mul(800.0);
    const grain = grainHash(grainUV.add(time.mul(60.0))).sub(0.5).mul(fx.filmGrainAmount).mul(2.0);

    return colorNode.toVec3().mul(vignette).add(vec3(grain, grain, grain));
  })();
}

export function applyPostFX(sceneColorTextureNode, fx) {
  const aberrated = chromaticAberration(sceneColorTextureNode, fx.chromaticAberration, vec2(0.5, 0.5), 1.1);
  return applyVignetteAndGrain(aberrated, fx);
}
