import * as THREE from 'three';
import gsap from 'gsap';

function easedStaggerT(order, count, easeName) {
  if (count <= 1) return 0;
  const linearT = order / (count - 1);
  if (!easeName) return linearT;
  const easeFn = gsap.parseEase(easeName);
  const eased = typeof easeFn === 'function' ? easeFn(linearT) : linearT;
  return Math.min(1, Math.max(0, eased));
}

const ORDERS = {
  'distance-from-center': (triangles, shapeCentroid) =>
    [...triangles]
      .map((tri) => ({
        tri,
        key: tri.centroid.distanceTo(shapeCentroid),
      }))
      .sort((a, b) => a.key - b.key)
      .map((entry, order) => ({ tri: entry.tri, order })),

  'left-to-right': (triangles) =>
    [...triangles]
      .map((tri) => ({ tri, key: tri.centroid.x }))
      .sort((a, b) => a.key - b.key)
      .map((entry, order) => ({ tri: entry.tri, order })),

  'top-to-bottom': (triangles) =>
    [...triangles]
      .map((tri) => ({ tri, key: -tri.centroid.y }))
      .sort((a, b) => a.key - b.key)
      .map((entry, order) => ({ tri: entry.tri, order })),

  random: (triangles) => {
    const shuffled = [...triangles].map((tri) => ({ tri, key: Math.random() }));
    shuffled.sort((a, b) => a.key - b.key);
    return shuffled.map((entry, order) => ({ tri: entry.tri, order }));
  },

  'color-group': (triangles) =>
    [...triangles]
      .map((tri) => ({ tri, key: tri.colorGroup }))
      .sort((a, b) => a.key - b.key || a.tri.centroid.x - b.tri.centroid.x)
      .map((entry, order) => ({ tri: entry.tri, order })),

  'letter-sequence': (triangles) =>
    [...triangles]
      .sort((a, b) => {
        const letterDelta = (a.letterIndex ?? 0) - (b.letterIndex ?? 0);
        if (letterDelta !== 0) return letterDelta;
        return a.centroid.x - b.centroid.x || a.centroid.y - b.centroid.y;
      })
      .map((tri, order) => ({ tri, order })),
};

export function computeStaggerDelays(
  triangles,
  orderName,
  staggerSpread,
  duration,
  shapeCentroid,
  { staggerEasing = null } = {},
) {
  if (orderName === 'letter-sequence') {
    return computeLetterSequenceDelays(triangles, staggerSpread, duration, staggerEasing);
  }

  const orderFn = ORDERS[orderName] ?? ORDERS['distance-from-center'];
  const ordered = orderFn(triangles, shapeCentroid);
  const count = ordered.length;

  if (count <= 1 || staggerSpread <= 0) {
    return new Map(ordered.map(({ tri }) => [tri, 0]));
  }

  const maxDelay = duration * staggerSpread;

  return new Map(
    ordered.map(({ tri, order }) => [
      tri,
      easedStaggerT(order, count, staggerEasing) * maxDelay,
    ]),
  );
}

export function getShapeCentroid(triangles) {
  const centroid = new THREE.Vector3();
  for (const tri of triangles) {
    centroid.add(tri.centroid);
  }
  return centroid.divideScalar(triangles.length);
}

function computeLetterSequenceDelays(triangles, staggerSpread, duration, staggerEasing = null) {
  const maxDelay = duration * staggerSpread;
  const letterCount = Math.max(...triangles.map((tri) => tri.letterIndex ?? 0)) + 1;

  if (letterCount <= 1) {
    const ordered = ORDERS['left-to-right'](triangles);
    const count = ordered.length;
    return new Map(
      ordered.map(({ tri, order }) => [
        tri,
        easedStaggerT(order, count, staggerEasing) * maxDelay,
      ]),
    );
  }

  const delays = new Map();
  const withinRatio = 0.4;

  for (let letterIndex = 0; letterIndex < letterCount; letterIndex++) {
    const letterTriangles = triangles
      .filter((tri) => (tri.letterIndex ?? 0) === letterIndex)
      .sort((a, b) => a.centroid.x - b.centroid.x || a.centroid.y - b.centroid.y);

    const letterStart = easedStaggerT(letterIndex, letterCount, staggerEasing) * maxDelay;
    const nextLetterStart =
      letterIndex < letterCount - 1
        ? easedStaggerT(letterIndex + 1, letterCount, staggerEasing) * maxDelay
        : maxDelay;
    const withinWindow = Math.max(0, nextLetterStart - letterStart) * withinRatio;
    const withinStep =
      letterTriangles.length > 1 ? withinWindow / (letterTriangles.length - 1) : 0;

    letterTriangles.forEach((tri, index) => {
      delays.set(tri, letterStart + index * withinStep);
    });
  }

  return delays;
}
