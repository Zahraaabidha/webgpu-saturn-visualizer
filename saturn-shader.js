/**
 * Saturn shaders (Three.js TSL).
 *
 * Two surface shaders, both authored as MeshBasicNodeMaterial color nodes so
 * lighting is fully hand-rolled (gives us the soft gas-giant terminator, the
 * ring shadow banding on the globe, and the planet's shadow thrown across the
 * rings — none of which a stock lit material would give us):
 *
 *   - createPlanetShader : oblate globe with procedural, turbulence-warped
 *     latitude bands, sun lighting, limb darkening + atmospheric rim, and the
 *     ring system's shadow cast onto the planet.
 *   - createRingShader   : flat annulus with a radial density profile (C/B/A
 *     rings, Cassini division, Encke gap) plus fine ringlets, lit by the sun
 *     and darkened where the planet's shadow falls on it.
 *
 * Everything is evaluated in the planet's *untilted local frame*, where the
 * ring plane is y = 0 and the spin axis is +y. Because a dot product is
 * invariant under the shared group tilt, computing lighting from the local
 * normal and a local sun direction is identical to doing it in world space —
 * and it keeps the shadow-ray math (which needs the y = 0 ring plane) simple.
 */

import {
  vec2,
  vec3,
  float,
  Fn,
  length,
  normalize,
  dot,
  sin,
  cos,
  atan,
  asin,
  pow,
  clamp,
  smoothstep,
  mix,
  step,
  abs,
  max,
  texture,
  positionLocal,
  normalLocal,
  positionWorld,
  normalWorld,
  cameraPosition
} from 'three/tsl';

import { fbm, gaussian } from './noise.js';

const PI = 3.14159265;
const HALF_PI = 1.5707963;

// ============================================================================
// RING RADIAL DENSITY PROFILE
// ============================================================================

/**
 * Broad radial "zone" profile only — the C/B/A ring brightness zones and the
 * Cassini/Encke gaps, with NO fine ringlet noise. Used directly for the ring
 * shadow cast on the planet, where we want a clean dark band rather than a
 * speckled one; also the base that `createRingDensity` multiplies fine
 * ringlets into for the ring's own (detailed) appearance.
 */
export const createRingZoneProfile = (u) => Fn(([r]) => {
  const span = u.ringOuter.sub(u.ringInner).max(0.001);
  const rn = clamp(r.sub(u.ringInner).div(span), float(0.0), float(1.0));

  // Hand-tuned gaussian approximation of the C/B/A zones + Cassini/Encke
  // gaps — kept as a fallback/blend partner for the real data below.
  const procedural = float(0.0).toVar();
  procedural.assign(procedural.max(gaussian(rn, float(0.10), float(0.11)).mul(0.45))); // C ring (faint, inner)
  procedural.assign(procedural.max(gaussian(rn, float(0.38), float(0.17)).mul(1.00))); // B ring (brightest)
  procedural.assign(procedural.max(gaussian(rn, float(0.78), float(0.13)).mul(0.82))); // A ring
  procedural.mulAssign(float(1.0).sub(gaussian(rn, float(0.575), float(0.028)).mul(0.92))); // Cassini division
  procedural.mulAssign(float(1.0).sub(gaussian(rn, float(0.880), float(0.010)).mul(0.85))); // Encke gap

  // Real Cassini-derived radial density/alpha profile (Solar System Scope
  // ring-alpha map) — a 1D lookup across the ring's radial extent, sampled
  // at the mid-row since it varies only along U.
  const real = texture(u.ringAlphaMap, vec2(rn, 0.5)).a;

  const prof = mix(procedural, real, u.ringTextureBlend).toVar();

  // Hard-ish inner/outer edges so the annulus fades in and out cleanly.
  prof.mulAssign(smoothstep(float(0.0), float(0.035), rn));
  prof.mulAssign(float(1.0).sub(smoothstep(float(0.965), float(1.0), rn)));

  return clamp(prof, float(0.0), float(1.0));
});

/**
 * Full ring optical density at planet-plane radius `r` (in planet-radius
 * units), returned in 0..1: the zone profile above multiplied by
 * high-frequency FBM to get the thousands of fine ringlets. Used for the
 * ring surface shader's own colour + opacity.
 */
export const createRingDensity = (u) => Fn(([r]) => {
  const prof = createRingZoneProfile(u)(r).toVar();

  // Fine concentric ringlets: 1-D FBM sampled along radius only.
  const fine = fbm(vec3(r.mul(u.ringDetail), float(0.0), float(0.0)), float(2.0), float(0.65));
  const ringlets = mix(float(1.0).sub(u.ringContrast), float(1.0), fine);
  prof.mulAssign(ringlets);

  return clamp(prof, float(0.0), float(1.0));
});

// ============================================================================
// SHADOWS
// ============================================================================

/**
 * Ring shadow cast onto the planet surface.
 * From surface point P, march toward the sun to the ring plane (y = 0); if the
 * crossing lands inside the ring annulus, darken by that radius' ring zone
 * density. Uses the fine-detail-free zone profile so the shadow reads as a
 * clean dark band rather than a speckled one.
 */
const createRingShadowOnPlanet = (u, ringZoneProfile) => Fn(([P]) => {
  const S = u.sunDirection;

  // Parametric distance along the sun ray to the y = 0 plane.
  const t = P.y.negate().div(S.y);
  const hx = P.x.add(S.x.mul(t));
  const hz = P.z.add(S.z.mul(t));
  const r = length(vec2(hx, hz));

  const dens = ringZoneProfile(r);
  const inRing = step(u.ringInner, r).mul(step(r, u.ringOuter));
  const toward = step(float(0.0001), t);          // ring must be between point and sun
  const active = step(float(0.02), abs(S.y));      // sun not (near) edge-on to the ring plane

  const occl = dens.mul(inRing).mul(toward).mul(active).mul(u.ringShadowStrength);
  return clamp(float(1.0).sub(occl), float(0.0), float(1.0));
});

/**
 * Planet's shadow cast onto the rings.
 * From ring point Q, find the closest approach of the sun ray to the planet
 * centre; if it passes within the planet radius on the sun-facing side, Q is
 * in shadow (soft penumbra via smoothstep at the limb).
 */
const createPlanetShadowOnRings = (u) => Fn(([Q]) => {
  const S = u.sunDirection;
  const tStar = dot(Q, S).negate();               // closest-approach parameter
  const cp = Q.add(S.mul(tStar));                  // closest point on the ray to origin
  const d = length(cp);

  const R = u.planetRadius;
  const edge = smoothstep(R.mul(0.98), R.mul(1.10), d); // 0 inside umbra -> 1 fully lit
  const behind = step(float(0.0001), tStar);            // planet between ring point and sun

  const shade = mix(u.ringShadowDark, float(1.0), edge);
  return mix(float(1.0), shade, behind);
});

// ============================================================================
// PLANET SHADER
// ============================================================================

export function createPlanetShader(uniforms) {
  const u = uniforms;
  const ringZoneProfile = createRingZoneProfile(u);
  const ringShadow = createRingShadowOnPlanet(u, ringZoneProfile);

  return Fn(() => {
    const P = positionLocal;
    const N = normalize(normalLocal);
    const dir = normalize(P);

    // Latitude in -1..1 from the (unit-sphere) surface direction.
    const lat = asin(clamp(dir.y, float(-1.0), float(1.0)));
    const latN = lat.div(HALF_PI);

    // Radius of the latitude circle (1 at the equator, 0 at the poles). Real
    // latitude bands are flat concentric rings around the poles, so any
    // azimuthally-varying noise must be faded out by this factor near the
    // poles — otherwise a tiny coordinate wobble gets hugely magnified by
    // the shrinking circle and the bands spiral into a soft-serve swirl.
    const poleRadius = clamp(float(1.0).sub(dir.y.mul(dir.y)), float(0.0), float(1.0)).sqrt();

    // Rotate the sampling direction about the spin axis so band turbulence
    // appears to rotate, while lighting (below) stays fixed to the world sun.
    //
    // Differential (zonal) rotation: real Saturn's equator rotates faster
    // than its mid-latitudes (~10h14m vs ~10h40m), and the alternating
    // zonal jets mean adjacent latitude bands don't even shear in the same
    // direction. `shear` modulates the per-fragment spin phase by latitude
    // so each band visibly drifts at its own rate instead of the whole
    // globe rotating as one rigid sheet.
    const shear = float(1.0).add(cos(latN.mul(3.1)).mul(u.bandShear));
    const spLat = u.spinPhase.mul(shear);
    const cs = cos(spLat);
    const sn = sin(spLat);
    const spun = vec3(
      dir.x.mul(cs).sub(dir.z.mul(sn)),
      dir.y,
      dir.x.mul(sn).add(dir.z.mul(cs))
    );

    // Turbulence-warped latitude bands (warp vanishes at the poles).
    const warp = fbm(spun.mul(u.bandTurbScale), float(2.0), float(0.55)).sub(0.5).mul(poleRadius);
    const detail = fbm(spun.mul(u.bandTurbScale.mul(3.0)).add(vec3(11.0, 7.0, 3.0)), float(2.2), float(0.5));

    const bandCoord = latN.mul(u.bandCount).add(warp.mul(u.bandWarp));
    const b = sin(bandCoord.mul(PI)).mul(0.5).add(0.5); // 0..1 alternating zones/belts

    // Kelvin-Helmholtz-style eddies where adjacent zonal jets shear against
    // each other — concentrated at band *boundaries* (where |cos(bandCoord*PI)|
    // peaks, i.e. where b changes fastest) rather than smeared uniformly
    // across the whole surface. The sampling coordinate is itself warped by a
    // lower-frequency FBM first (domain warping) so the eddies swirl instead
    // of reading as static high-frequency grain.
    const edgeMask = abs(cos(bandCoord.mul(PI))).mul(poleRadius);
    const eddyWarp = fbm(spun.mul(u.bandTurbScale.mul(0.5)).add(vec3(3.0, 9.0, 2.0)), float(2.0), float(0.5)).sub(0.5);
    const eddyCoord = spun.mul(u.bandTurbScale.mul(7.0)).add(vec3(eddyWarp, eddyWarp.mul(0.5), eddyWarp).mul(1.5));
    const eddies = fbm(eddyCoord, float(2.3), float(0.5)).sub(0.5);

    // A second, higher-frequency layer of thin stripes within each zone/belt —
    // real Saturn photos show dozens of fine bands, not just a handful of big
    // ones. Also fades to nothing at the poles.
    const micro = sin(latN.mul(u.bandMicroCount).mul(PI)).mul(0.5).add(0.5);
    const microAmt = u.bandMicroAmp.mul(poleRadius);

    // Colour ramp: belt (dark) -> zone (light) -> gold accent highlights.
    // This procedural ramp is the *fallback/animated* layer — it still drives
    // the fine micro-banding and detail multipliers below even once the real
    // texture is blended in, so the surface keeps moving with spin/turbulence
    // instead of the photo just sitting there static.
    const proceduralBase = mix(u.beltColor, u.zoneColor, smoothstep(float(0.35), float(0.65), b)).toVar('proceduralBase');
    proceduralBase.assign(mix(proceduralBase, u.goldColor, smoothstep(float(0.75), float(1.0), b).mul(0.5)));

    // Real NASA/JPL-derived albedo, sampled in equirectangular lat/lon using
    // the same spin-rotated direction as the procedural bands so both layers
    // rotate together.
    const theta = atan(spun.z, spun.x);
    const mapUV = vec2(theta.div(PI * 2.0).add(0.5), float(0.5).sub(latN.mul(0.5)));
    const texColor = texture(u.saturnMap, mapUV).rgb;

    const base = mix(proceduralBase, texColor, u.textureBlend).toVar('base');
    base.mulAssign(mix(float(1.0).sub(microAmt), float(1.0).add(microAmt), micro));
    base.mulAssign(mix(float(0.92), float(1.08), detail.mul(poleRadius).add(float(1.0).sub(poleRadius).mul(0.5))));

    // Apply the boundary-concentrated eddies on top of both the procedural
    // and real-texture base alike, so the turbulence reads as genuine
    // atmospheric motion rather than a decal painted over the photo.
    const eddyAmt = edgeMask.mul(u.bandEddyStrength);
    base.mulAssign(mix(float(1.0).sub(eddyAmt), float(1.0).add(eddyAmt), eddies.add(0.5)));

    // Cool, desaturated polar caps (as seen near Saturn's poles) — smoothly
    // overrides the (by now already-clean, concentric) bands.
    const polar = smoothstep(float(0.7), float(0.94), abs(latN));
    base.assign(mix(base, u.poleColor, polar.mul(u.poleTint)));

    const col = base.toVar('col');

    // ---- Sun lighting (local frame; dot product is tilt-invariant) ----
    const S = u.sunDirection;
    const ndl = dot(N, S);
    const lightT = smoothstep(u.terminatorSoftness.negate(), u.terminatorSoftness, ndl);
    const lit = u.ambient.add(float(1.0).sub(u.ambient).mul(lightT)).toVar('lit');
    lit.mulAssign(ringShadow(P)); // ring shadow banding on the globe
    col.mulAssign(lit);

    // Warm, tight "hotspot" glow where the surface faces the sun directly —
    // the blown-out golden highlight that bloom turns into a soft glow,
    // giving the globe a lit-from-within, out-of-this-world quality instead
    // of flat, uniform diffuse shading.
    const hotspot = pow(clamp(ndl, float(0.0), float(1.0)), u.sunHotspotPower).mul(u.sunHotspotStrength);
    col.addAssign(u.sunColor.mul(hotspot).mul(ringShadow(P)));

    // ---- Limb darkening + atmospheric backscatter rim (world frame) ----
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const facing = clamp(dot(normalize(normalWorld), viewDir), float(0.0), float(1.0));
    const limb = mix(u.limbDarkening, float(1.0), smoothstep(float(0.0), float(0.55), facing));
    col.mulAssign(limb);

    const rim = pow(float(1.0).sub(facing), float(3.0)).mul(lightT).mul(u.rimStrength);
    col.addAssign(u.rimColor.mul(rim));

    return col;
  })();
}

// ============================================================================
// RING SHADER
// ============================================================================

export function createRingShader(uniforms) {
  const u = uniforms;
  const ringDensity = createRingDensity(u);
  const planetShadow = createPlanetShadowOnRings(u);

  const colorNode = Fn(() => {
    const Q = positionLocal;
    const r = length(Q.xz);
    const span = u.ringOuter.sub(u.ringInner).max(0.001);
    const rn = clamp(r.sub(u.ringInner).div(span), float(0.0), float(1.0));

    const dens = ringDensity(r);

    // Icy-tan particle colour, warmer inner -> cooler outer, with per-ringlet
    // variation so adjacent bands read as slightly different material.
    const col = mix(u.ringColorInner, u.ringColorOuter, rn).toVar('ringCol');
    const tint = fbm(vec3(r.mul(u.ringDetail.mul(0.5)), float(5.0), float(0.0)), float(2.0), float(0.5));
    col.mulAssign(mix(float(0.9), float(1.15), tint));

    // Sun illumination: brighter when the sun is more perpendicular to the
    // ring plane. Denser ringlets read brighter, but never fully black.
    const S = u.sunDirection;
    const litFace = mix(u.ringAmbient, float(1.0), abs(S.y));
    const sh = planetShadow(Q);
    const bright = u.ringBrightness.mul(litFace).mul(sh).mul(mix(float(0.35), float(1.0), dens)).toVar('bright');

    // Forward scattering: real ring ice grains scatter light preferentially
    // forward through themselves, so the rings glow brightest when backlit
    // (camera looking roughly toward the sun through the ring) rather than
    // simply reflecting toward the viewer — the effect visible in Cassini's
    // famous backlit ring mosaics. Cheap single-lobe approximation instead of
    // a full Henyey-Greenstein evaluation, since only the forward lobe (the
    // visually dominant one for icy particles) matters here.
    const viewDirWorld = normalize(cameraPosition.sub(positionWorld));
    const backlitAmount = clamp(dot(viewDirWorld, u.sunDirectionWorld).negate(), float(0.0), float(1.0));
    const forwardScatter = pow(backlitAmount, u.ringScatterPower).mul(u.ringScatterStrength).mul(sh);
    bright.addAssign(forwardScatter.mul(dens));

    return col.mul(bright);
  })();

  const opacityNode = Fn(() => {
    const Q = positionLocal;
    const r = length(Q.xz);
    const dens = ringDensity(r);
    return clamp(dens.mul(u.ringOpacity), float(0.0), float(1.0));
  })();

  return { colorNode, opacityNode };
}
