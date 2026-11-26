import * as THREE from 'three';
import {
  setFaceOpacity,
  hideBehindLayersForTri,
  showBehindLayersForTri,
} from './svgParser.js';

const tmpVec = new THREE.Vector3();
const SPAWN_DEPTH_SCALE = 0.1;

function getEmissiveTweenTarget(mat) {
  if (mat.isLineMaterial) {
    if (!mat.userData.glow) mat.userData.glow = { emissiveIntensity: 0 };
    return mat.userData.glow;
  }
  if (!mat.emissive) return null;
  return mat;
}

function syncEmissiveGlow(mat, intensity) {
  if (mat.isLineMaterial) {
    mat.userData.glow.emissiveIntensity = intensity;
    const base = mat.userData.baseColor;
    if (!base) return;
    const scale = intensity <= 0.01 ? 0.3 : Math.min(1.6, 0.5 + intensity * 0.75);
    mat.color.copy(base).multiplyScalar(scale);
    return;
  }

  if (!mat.emissive) return;

  mat.emissive.copy(mat.color);
  mat.emissiveIntensity = intensity;
}

function seededRandom(index, salt = 0) {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export const PATTERN_NAMES = [
  'explode-in',
  'cascade',
  'depth-pull',
  'shatter-reverse',
  'random-pop',
  'spiral',
  'digital-blink',
];

export function isDigitalBlinkPattern(pattern) {
  return pattern === 'digital-blink';
}

export function shouldUseBlinkTweens(pattern, reverse) {
  return isDigitalBlinkPattern(pattern) || reverse;
}

export const BLINK_FPS = 30;
export const BLINK_FRAME_HOLD = 2;
export const BLINK_COUNT = 2;

export const DOT_BLINK_FPS = BLINK_FPS;
export const DOT_BLINK_FRAME_HOLD = BLINK_FRAME_HOLD;
export const DOT_BLINK_COUNT = BLINK_COUNT;

export function getBlinkStepDuration() {
  return BLINK_FRAME_HOLD / BLINK_FPS;
}

export function getDigitalBlinkDuration() {
  return getBlinkStepDuration() * (BLINK_COUNT * 2 + 1);
}

export function getDotBlinkDuration() {
  return getDigitalBlinkDuration();
}

export function getDotBlinkStepDuration() {
  return getBlinkStepDuration();
}

function buildBlinkPhases(dissolve = false) {
  const phases = [];
  for (let i = 0; i < BLINK_COUNT; i++) {
    phases.push(dissolve ? 0 : 1, dissolve ? 1 : 0);
  }
  phases.push(dissolve ? 0 : 1);
  return phases;
}

function scheduleBlinkOpacityHold(timeline, materials, opacity, t, onOpacity) {
  timeline.call(() => {
    setMaterialOpacity(materials, opacity);
    onOpacity?.(opacity);
  }, null, t);
  return t + getBlinkStepDuration();
}

export function buildDotRevealTweens(
  timeline,
  targets,
  { startOffset = 0 } = {},
) {
  for (const { tri, delay } of targets) {
    const materials = getBlinkMaterials(tri);

    tri.mesh.position.copy(tri.homePosition);
    tri.mesh.scale.copy(tri.homeScale);
    tri.mesh.visible = true;
    setMaterialOpacity(materials, 0);

    const t = startOffset + delay;
    timeline.call(() => setMaterialOpacity(materials, 1), null, t);
  }
}

export function buildDotDissolveTweens(
  timeline,
  targets,
  { startOffset = 0 } = {},
) {
  for (const { delay, materials, meshes } of targets) {
    const t = startOffset + delay;

    timeline.call(() => setMaterialOpacity(materials, 0), null, t);

    for (const mesh of meshes) {
      timeline.set(mesh, { visible: false }, t);
    }
  }
}

export function buildDotBlinkTweens(timeline, targets, options = {}) {
  return buildDotRevealTweens(timeline, targets, options);
}

export function buildDotDissolveBlinkTweens(timeline, targets, options = {}) {
  return buildDotDissolveTweens(timeline, targets, options);
}

export function computeStartState(triangle, pattern, params, shapeCentroid, staggerDelay) {
  const { index, centroid, homePosition, homeScale } = triangle;
  const intensity = params.intensity ?? 1;

  const state = {
    position: homePosition.clone(),
    scale: homeScale.clone(),
    delay: staggerDelay,
  };

  switch (pattern) {
    case 'explode-in':
      applyExplodeIn(state, centroid, shapeCentroid, index, intensity, 1.2);
      break;
    case 'cascade':
      applyCascade(state, intensity);
      break;
    case 'depth-pull':
      applyDepthPull(state, intensity);
      break;
    case 'shatter-reverse':
      applyShatterReverse(state, centroid, shapeCentroid, index, intensity);
      break;
    case 'random-pop':
      applyRandomPop(state, index, params.duration, intensity);
      break;
    case 'spiral':
      applySpiral(state, centroid, shapeCentroid, index, intensity);
      break;
    case 'digital-blink':
      applyDigitalBlink(state);
      break;
    default:
      applyExplodeIn(state, centroid, shapeCentroid, index, intensity, 1.2);
  }

  return state;
}

function applyExplodeIn(state, centroid, shapeCentroid, index, intensity, distance) {
  const dir = tmpVec.subVectors(centroid, shapeCentroid);
  if (dir.lengthSq() < 0.001) {
    dir.set(
      seededRandom(index, 1) - 0.5,
      seededRandom(index, 2) - 0.5,
      seededRandom(index, 3) - 0.5,
    );
  }
  dir.normalize();
  dir.z += (seededRandom(index, 4) - 0.5) * 1.5 * SPAWN_DEPTH_SCALE;
  dir.normalize().multiplyScalar(distance * 8 * intensity * SPAWN_DEPTH_SCALE);

  state.position.add(dir);
  state.scale.multiplyScalar(0.01);
}

function applyCascade(state, intensity) {
  state.position.y += 6 * intensity;
  state.position.x -= 4 * intensity;
  state.scale.multiplyScalar(0.2);
}

function applyDepthPull(state, intensity) {
  state.position.z -= 30 * intensity * SPAWN_DEPTH_SCALE;
  state.scale.multiplyScalar(0.3);
}

function applyShatterReverse(state, centroid, shapeCentroid, index, intensity) {
  applyExplodeIn(state, centroid, shapeCentroid, index, intensity, 2);
  state.scale.multiplyScalar(0.5);
}

function applyRandomPop(state, index, duration, intensity) {
  state.scale.multiplyScalar(0);
  const window = duration * 0.8 * intensity;
  state.delay += seededRandom(index, 11) * window;
}

function applySpiral(state, centroid, shapeCentroid, index, intensity) {
  const offset = tmpVec.subVectors(centroid, shapeCentroid);
  const angle = Math.atan2(offset.y, offset.x) + Math.PI * 0.75 * intensity;
  const radius = offset.length() + 4 * intensity;
  state.position.x = shapeCentroid.x + Math.cos(angle) * radius;
  state.position.y = shapeCentroid.y + Math.sin(angle) * radius;
  state.position.z += 3 * intensity * SPAWN_DEPTH_SCALE;
  state.scale.multiplyScalar(0.15);
}

function applyDigitalBlink(state) {
  state.opacity = 0;
}

function getBlinkMaterials(tri) {
  if (tri.dotFaceMeshes?.length) {
    return tri.dotFaceMeshes.map((mesh) => mesh.material);
  }
  return [tri.faceMesh.material];
}

function setMaterialOpacity(materials, opacity) {
  for (const mat of materials) {
    setFaceOpacity(mat, opacity);
  }
}

export function buildDissolveBlinkTweens(
  timeline,
  targets,
  { startOffset = 0 } = {},
) {
  const phases = buildBlinkPhases(true);

  for (const { delay, materials, meshes, sourceTri } of targets) {
    setMaterialOpacity(materials, 1);

    let t = startOffset + delay;
    for (const opacity of phases) {
      t = scheduleBlinkOpacityHold(timeline, materials, opacity, t);
    }

    for (const mesh of meshes) {
      timeline.set(mesh, { visible: false }, t);
    }
    if (sourceTri) {
      timeline.call(() => showBehindLayersForTri(sourceTri), null, t);
    }
  }
}

export function buildDigitalBlinkTweens(
  timeline,
  targets,
  { reverse = false, emissiveStrength = 0, startOffset = 0 } = {},
) {
  const phases = buildBlinkPhases(reverse);
  const flashEmissive = (settle) =>
    settle <= 0.01 ? 0 : Math.min(settle + 0.12, settle * 1.15);

  for (const { tri, delay, sourceTri } of targets) {
    const materials = getBlinkMaterials(tri);
    const mat = materials[0];
    const emissiveTarget = getEmissiveTweenTarget(mat);
    const settleEmissive = reverse
      ? mat.isLineMaterial && emissiveTarget
        ? emissiveTarget.emissiveIntensity
        : mat.emissiveIntensity ?? 0
      : emissiveStrength;
    const emissiveOff = settleEmissive <= 0.01 || !emissiveTarget;

    tri.mesh.position.copy(tri.homePosition);
    tri.mesh.scale.copy(tri.homeScale);
    tri.mesh.visible = true;
    setMaterialOpacity(materials, reverse ? 1 : 0);
    if (!emissiveOff) {
      syncEmissiveGlow(mat, reverse ? settleEmissive : 0);
    }

    let t = startOffset + delay;
    for (let i = 0; i < phases.length; i++) {
      const opacity = phases[i];
      const isLast = i === phases.length - 1;

      timeline.call(() => setMaterialOpacity(materials, opacity), null, t);

      if (!emissiveOff) {
        const emissiveIntensity =
          opacity === 0
            ? 0
            : isLast && !reverse
              ? settleEmissive
              : isLast
                ? 0
                : flashEmissive(settleEmissive);
        timeline.call(() => syncEmissiveGlow(mat, emissiveIntensity), null, t);
      }

      // Hide behind layers only after white finishes settling — not during blink gaps.
      if (sourceTri && isLast && !reverse && opacity > 0.01) {
        timeline.call(() => hideBehindLayersForTri(sourceTri), null, t);
      }

      t += getBlinkStepDuration();
    }

    if (reverse) {
      timeline.set(tri.mesh, { visible: false }, t);
      if (sourceTri) {
        timeline.call(() => showBehindLayersForTri(sourceTri), null, t);
      }
    }
  }
}

export function applyStateToMesh(triangle, state) {
  triangle.mesh.position.copy(state.position);
  triangle.mesh.scale.copy(state.scale);
  if (state.opacity !== undefined) {
    if (triangle.dotFaceMeshes?.length) {
      triangle.dotFaceMeshes.forEach((mesh) => {
        setFaceOpacity(mesh.material, state.opacity);
      });
    } else {
      setFaceOpacity(triangle.faceMesh.material, state.opacity);
    }
  }
}

export function resetToHome(triangle) {
  triangle.mesh.position.copy(triangle.homePosition);
  triangle.mesh.scale.copy(triangle.homeScale);
  if (triangle.dotFaceMeshes?.length) {
    triangle.dotFaceMeshes.forEach((mesh) => {
      setFaceOpacity(mesh.material, 1);
    });
  } else {
    setFaceOpacity(triangle.faceMesh.material, 1);
  }
}
