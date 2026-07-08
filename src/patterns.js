import * as THREE from 'three';

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

export const DISSOLVE_DURATION_SCALE = 0.5;

function getDissolveBlinkTimings(duration, options) {
  return getDigitalBlinkTimings(duration * DISSOLVE_DURATION_SCALE, options);
}

export function getDigitalBlinkTimings(
  duration = 2,
  { triangleCount = 1, staggerSpread = 0.65 } = {},
) {
  const maxDelay = duration * staggerSpread;
  const staggerStep = triangleCount > 1 ? maxDelay / (triangleCount - 1) : maxDelay;
  const pulse = Math.min(0.022, Math.max(0.004, staggerStep * 0.55));

  return {
    blinkOn: pulse,
    blinkOff: pulse * 0.75,
    gap: pulse * 0.4,
  };
}

export function getDigitalBlinkDuration(
  duration = 2,
  staggerOptions = {},
) {
  const { blinkOn, blinkOff, gap } = getDigitalBlinkTimings(duration, staggerOptions);
  return blinkOn * 3 + blinkOff * 2 + gap * 2;
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
    mat.opacity = opacity;
  }
}

export function buildDissolveBlinkTweens(
  timeline,
  targets,
  { duration = 2, staggerSpread = 0.65, startOffset = 0 } = {},
) {
  const { blinkOn, blinkOff, gap } = getDissolveBlinkTimings(duration, {
    triangleCount: targets.length,
    staggerSpread,
  });

  for (const { delay, materials, meshes } of targets) {
    for (const mat of materials) {
      mat.opacity = 1;
    }

    let t = startOffset + delay * DISSOLVE_DURATION_SCALE;
    const steps = [
      { opacity: 0, duration: blinkOff },
      { opacity: 1, duration: blinkOn },
      { opacity: 0, duration: blinkOff },
      { opacity: 1, duration: blinkOn },
      { opacity: 0, duration: blinkOff },
    ];

    steps.forEach((step, index) => {
      for (const mat of materials) {
        timeline.to(
          mat,
          {
            opacity: step.opacity,
            duration: step.duration,
            ease: 'none',
            immediateRender: false,
          },
          t,
        );
      }
      t += step.duration;
      if (index === 0 || index === 2) {
        t += gap;
      }
    });

    for (const mesh of meshes) {
      timeline.set(mesh, { visible: false }, t);
    }
  }
}

export function buildDigitalBlinkTweens(
  timeline,
  targets,
  { reverse = false, emissiveStrength = 0, duration = 2, staggerSpread = 0.65 } = {},
) {
  const timeScale = reverse ? DISSOLVE_DURATION_SCALE : 1;
  const { blinkOn, blinkOff, gap } = getDigitalBlinkTimings(duration * timeScale, {
    triangleCount: targets.length,
    staggerSpread,
  });
  const flashEmissive = (settle) =>
    settle <= 0.01 ? 0 : Math.min(settle + 0.12, settle * 1.15);

  for (const { tri, delay } of targets) {
    const materials = getBlinkMaterials(tri);
    const mat = materials[0];
    const emissiveTarget = getEmissiveTweenTarget(mat);
    const settleEmissive = emissiveStrength;
    const emissiveOff = settleEmissive <= 0.01 || !emissiveTarget;

    tri.mesh.position.copy(tri.homePosition);
    tri.mesh.scale.copy(tri.homeScale);
    tri.mesh.visible = true;

    if (!reverse) {
      setMaterialOpacity(materials, 0);
      if (!emissiveOff) {
        syncEmissiveGlow(mat, 0);
      }

      let t = delay;
      const blinks = emissiveOff
        ? [
            { opacity: 1, duration: blinkOn },
            { opacity: 0, duration: blinkOff },
            { opacity: 1, duration: blinkOn },
            { opacity: 0, duration: blinkOff },
            { opacity: 1, duration: blinkOn },
          ]
        : [
            { opacity: 1, emissiveIntensity: flashEmissive(settleEmissive), duration: blinkOn },
            { opacity: 0, emissiveIntensity: 0, duration: blinkOff },
            { opacity: 1, emissiveIntensity: flashEmissive(settleEmissive), duration: blinkOn },
            { opacity: 0, emissiveIntensity: 0, duration: blinkOff },
            { opacity: 1, emissiveIntensity: settleEmissive, duration: blinkOn },
          ];

      blinks.forEach((step, index) => {
        for (const material of materials) {
          timeline.to(
            material,
            {
              opacity: step.opacity,
              duration: step.duration,
              ease: 'none',
              immediateRender: false,
            },
            t,
          );
        }

        if (!emissiveOff) {
          timeline.to(
            emissiveTarget,
            {
              emissiveIntensity: step.emissiveIntensity,
              duration: step.duration,
              ease: 'none',
              immediateRender: false,
              onUpdate: () => syncEmissiveGlow(mat, emissiveTarget.emissiveIntensity),
            },
            t,
          );
        }

        t += step.duration;
        if (index === 1 || index === 3) {
          t += gap;
        }
      });
    } else {
      setMaterialOpacity(materials, 1);
      const baseEmissive =
        mat.isLineMaterial && emissiveTarget
          ? emissiveTarget.emissiveIntensity
          : mat.emissiveIntensity ?? 0;
      const reverseEmissiveOff = baseEmissive <= 0.01 || !emissiveTarget;

      let t = delay * timeScale;
      const blinks = reverseEmissiveOff
        ? [
            { opacity: 0, duration: blinkOff },
            { opacity: 1, duration: blinkOn },
            { opacity: 0, duration: blinkOff },
            { opacity: 1, duration: blinkOn },
            { opacity: 0, duration: blinkOff },
          ]
        : [
            { opacity: 0, emissiveIntensity: 0, duration: blinkOff },
            { opacity: 1, emissiveIntensity: flashEmissive(baseEmissive), duration: blinkOn },
            { opacity: 0, emissiveIntensity: 0, duration: blinkOff },
            { opacity: 1, emissiveIntensity: flashEmissive(baseEmissive), duration: blinkOn },
            { opacity: 0, emissiveIntensity: 0, duration: blinkOff },
          ];

      blinks.forEach((step, index) => {
        for (const material of materials) {
          timeline.to(
            material,
            {
              opacity: step.opacity,
              duration: step.duration,
              ease: 'none',
              immediateRender: false,
            },
            t,
          );
        }

        if (!reverseEmissiveOff) {
          timeline.to(
            emissiveTarget,
            {
              emissiveIntensity: step.emissiveIntensity,
              duration: step.duration,
              ease: 'none',
              immediateRender: false,
              onUpdate: () => syncEmissiveGlow(mat, emissiveTarget.emissiveIntensity),
            },
            t,
          );
        }

        t += step.duration;
        if (index === 0 || index === 2) {
          t += gap;
        }
      });

      timeline.set(tri.mesh, { visible: false }, t);
    }
  }
}

export function applyStateToMesh(triangle, state) {
  triangle.mesh.position.copy(state.position);
  triangle.mesh.scale.copy(state.scale);
  if (state.opacity !== undefined) {
    if (triangle.dotFaceMeshes?.length) {
      triangle.dotFaceMeshes.forEach((mesh) => {
        mesh.material.opacity = state.opacity;
      });
    } else {
      triangle.faceMesh.material.opacity = state.opacity;
    }
  }
}

export function resetToHome(triangle) {
  triangle.mesh.position.copy(triangle.homePosition);
  triangle.mesh.scale.copy(triangle.homeScale);
  if (triangle.dotFaceMeshes?.length) {
    triangle.dotFaceMeshes.forEach((mesh) => {
      mesh.material.opacity = 1;
    });
  } else {
    triangle.faceMesh.material.opacity = 1;
  }
}
