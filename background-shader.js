/**
 * Deep-space background (Three.js TSL).
 *
 * Rendered on a large inverted sphere. The view ray for each fragment is just
 * the direction from the camera to that fragment's world position, which we
 * feed into a procedural starfield + two nebula layers + an optional sun glow
 * (the bright "sun peeking past Saturn" look). Bloom in the post chain turns
 * the sun core and brightest stars into soft highlights.
 */

import {
  vec2,
  vec3,
  float,
  Fn,
  length,
  normalize,
  dot,
  atan,
  asin,
  clamp,
  floor,
  fract,
  step,
  pow,
  max,
  smoothstep,
  mix,
  positionWorld,
  cameraPosition
} from 'three/tsl';

import { hash21, hash22, fbm } from './noise.js';

// Procedural star field using grid-based placement on the celestial sphere.
const createStarField = (u) => Fn(([rayDir]) => {
  const theta = atan(rayDir.z, rayDir.x);
  const phi = asin(clamp(rayDir.y, float(-1.0), float(1.0)));

  const gridScale = float(60.0).div(u.starSize);
  const scaledCoord = vec2(theta, phi).mul(gridScale);
  const cell = floor(scaledCoord);
  const cellUV = fract(scaledCoord);

  const cellHash = hash21(cell);
  const starProb = step(float(1.0).sub(u.starDensity), cellHash);

  const starPos = hash22(cell.add(42.0)).mul(0.8).add(0.1);
  const distToStar = length(cellUV.sub(starPos));

  const baseSizeVar = hash21(cell.add(100.0)).mul(0.03).add(0.01);
  const finalStarSize = baseSizeVar.mul(u.starSize);

  const starCore = smoothstep(finalStarSize, float(0.0), distToStar);
  const starGlow = smoothstep(finalStarSize.mul(3.0), float(0.0), distToStar).mul(0.3);
  const starIntensity = starCore.add(starGlow).mul(starProb);

  const colorTemp = hash21(cell.add(200.0));
  const starColor = mix(vec3(0.8, 0.9, 1.0), vec3(1.0, 0.95, 0.85), colorTemp);

  return starColor.mul(starIntensity).mul(u.starBrightness);
});

// Two FBM nebula layers with independent colour, scale and density.
const createNebulaField = (u) => Fn(([rayDir]) => {
  const n1 = fbm(rayDir.mul(u.nebula1Scale), float(2.0), float(0.5)).mul(2.0).sub(1.0);
  const layer1 = clamp(n1.add(u.nebula1Density), float(0.0), float(1.0));
  const color1 = u.nebula1Color.mul(layer1).mul(u.nebula1Brightness);

  const n2 = fbm(rayDir.mul(u.nebula2Scale), float(2.0), float(0.5)).mul(2.0).sub(1.0);
  const layer2 = clamp(n2.add(u.nebula2Density), float(0.0), float(1.0));
  const color2 = u.nebula2Color.mul(layer2).mul(u.nebula2Brightness);

  return color1.add(color2);
});

// Soft sun disk + halo in the world sun direction.
const createSunGlow = (u) => Fn(([rayDir]) => {
  const d = clamp(dot(rayDir, u.sunDirectionWorld), float(0.0), float(1.0));
  const core = pow(d, float(2200.0)).mul(u.sunGlowIntensity.mul(6.0)); // tight bright disk
  const halo = pow(d, float(80.0)).mul(u.sunGlowIntensity);            // broad warm halo
  return u.sunColor.mul(core.add(halo));
});

export function createBackgroundShader(uniforms) {
  const u = uniforms;
  const starField = createStarField(u);
  const nebulaField = createNebulaField(u);
  const sunGlow = createSunGlow(u);

  return Fn(() => {
    const rayDir = normalize(positionWorld.sub(cameraPosition));

    const col = u.spaceColor.toVar('bgCol');
    col.addAssign(nebulaField(rayDir).mul(u.nebulaEnabled));
    col.addAssign(starField(rayDir).mul(u.starsEnabled));
    col.addAssign(sunGlow(rayDir).mul(u.sunGlowEnabled));

    return col;
  })();
}
