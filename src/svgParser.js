import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

const CLASS_COLORS = {
  st0: '#ff4400',
  st1: '#ffc400',
  st2: '#c300ff',
};

const PALETTE = Object.values(CLASS_COLORS);
export const DEFAULT_WIREFRAME_COLOR = '#ff4a1c';
export const DEFAULT_CONSTRUCTION_COLOR = '#ff4a1c';
export const DEFAULT_SOLID_COLOR = '#ffffff';
export const DEFAULT_WIREFRAME_LINE_WIDTH = 2;
export const DEFAULT_DOT_PIXEL_SIZE = 6;
const WIREFRAME_EMISSIVE_BOOST = 1.25;
/** Default spacing between the 3 primary logo planes (wire+dots / colored / white). */
export const DEFAULT_LOGO_DEPTH = 0.188;
/** Merge SVG triangle corners that land on the same point into one shared vertex. */
const VERTEX_MERGE_DECIMALS = 4;

/**
 * Bottom plane = wire + dots (same Z).
 * Layer 2 (colored) and layer 3 (white) step toward the camera by `depth`.
 */
export function applyLogoLayerDepth(
  { wireLayer, dotsLayer, coloredLayer, whiteLayer },
  depth = DEFAULT_LOGO_DEPTH,
) {
  const d = Math.max(0, depth);
  if (wireLayer) wireLayer.position.z = 0;
  if (dotsLayer) dotsLayer.position.z = 0;
  if (coloredLayer) coloredLayer.position.z = d;
  if (whiteLayer) whiteLayer.position.z = d * 2;
}

export function parseSvgTriangles(svgText) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const polygons = [...doc.querySelectorAll('polygon')];

  if (polygons.length === 0) {
    throw new Error('No <polygon> elements found in SVG');
  }

  const rawTriangles = polygons.map((polygon, index) => {
    const points = parsePoints(polygon.getAttribute('points'));
    const color = resolveColor(polygon);
    const centroid = computeCentroid2D(points);
    return { points, color, centroid, index };
  });

  assignLetterIndices(rawTriangles);

  const bounds = computeBounds(rawTriangles);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const maxDim = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const scale = 10 / maxDim;

  const wireframeLayer = new THREE.Group();
  wireframeLayer.name = 'wireframeLayer';
  wireframeLayer.renderOrder = 0;

  const dotsLayer = new THREE.Group();
  dotsLayer.name = 'vertexDotsLayer';
  dotsLayer.renderOrder = 1;

  const coloredGroup = new THREE.Group();
  coloredGroup.name = 'coloredLayer';
  coloredGroup.renderOrder = 2;

  const whiteLayer = new THREE.Group();
  whiteLayer.name = 'whiteLayer';
  whiteLayer.renderOrder = 3;

  applyLogoLayerDepth(
    {
      wireLayer: wireframeLayer,
      dotsLayer,
      coloredLayer: coloredGroup,
      whiteLayer,
    },
    DEFAULT_LOGO_DEPTH,
  );

  const prepared = rawTriangles.map((raw) => {
    const worldVerts = raw.points.map(
      ([x, y]) => new THREE.Vector3((x - centerX) * scale, -(y - centerY) * scale, 0),
    );
    ensureFacingCamera(worldVerts);

    const centroid3 = new THREE.Vector3();
    worldVerts.forEach((v) => centroid3.add(v));
    centroid3.divideScalar(worldVerts.length);

    const localVerts = worldVerts.map((v) => v.clone().sub(centroid3));
    return { raw, worldVerts, centroid3, localVerts };
  });

  // One shared vertex / one dot per unique position (first triangle owns it for reveal anim).
  const vertexOwnerByKey = new Map();
  prepared.forEach((item, triIndex) => {
    item.worldVerts.forEach((worldVert) => {
      const key = vertexKey(worldVert);
      if (!vertexOwnerByKey.has(key)) {
        vertexOwnerByKey.set(key, {
          world: worldVert.clone(),
          ownerIndex: triIndex,
        });
      }
    });
  });

  const triangles = [];

  for (let triIndex = 0; triIndex < prepared.length; triIndex++) {
    const { raw, worldVerts, centroid3, localVerts } = prepared[triIndex];

    const geometry = createFlatTriangleGeometry(localVerts);
    const wireGeometry = createTriangleWireGeometry(localVerts);

    const wireMaterial = new LineMaterial({
      color: new THREE.Color(DEFAULT_WIREFRAME_COLOR),
      linewidth: DEFAULT_WIREFRAME_LINE_WIDTH,
      transparent: true,
      opacity: 1,
      depthTest: true,
      depthWrite: true,
      toneMapped: false,
    });
    wireMaterial.userData.baseColor = wireMaterial.color.clone();
    wireMaterial.userData.glow = { emissiveIntensity: 0 };

    const wireFaceMesh = new Line2(wireGeometry, wireMaterial);
    wireFaceMesh.frustumCulled = false;
    wireFaceMesh.renderOrder = raw.index;
    const wireChip = new THREE.Group();
    wireChip.frustumCulled = false;
    wireChip.add(wireFaceMesh);
    wireChip.position.copy(centroid3);
    wireChip.visible = false;
    wireframeLayer.add(wireChip);

    const dotChip = new THREE.Group();
    dotChip.frustumCulled = false;
    const dotFaceMeshes = [];
    worldVerts.forEach((worldVert) => {
      const owned = vertexOwnerByKey.get(vertexKey(worldVert));
      if (!owned || owned.ownerIndex !== triIndex) return;

      const dotMesh = createVertexDotMesh();
      // Place from welded world position so shared corners stay coincident.
      dotMesh.position.copy(owned.world).sub(centroid3);
      dotMesh.renderOrder = raw.index + 500;
      dotChip.add(dotMesh);
      dotFaceMeshes.push(dotMesh);
    });
    dotChip.position.copy(centroid3);
    dotChip.visible = false;
    dotsLayer.add(dotChip);

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(raw.color),
      emissive: new THREE.Color(raw.color),
      emissiveIntensity: 0,
      roughness: 0.25,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
      depthWrite: true,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const faceMesh = new THREE.Mesh(geometry, material);
    faceMesh.frustumCulled = false;
    faceMesh.renderOrder = raw.index;
    const chip = new THREE.Group();
    chip.frustumCulled = false;
    chip.add(faceMesh);
    chip.position.copy(centroid3);
    coloredGroup.add(chip);

    const whiteGeometry = createFlatTriangleGeometry(localVerts);
    const whiteMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(DEFAULT_SOLID_COLOR),
      side: THREE.FrontSide,
      transparent: false,
      opacity: 1,
      depthTest: true,
      depthWrite: true,
      toneMapped: false,
    });
    whiteMaterial.userData.solidWhenOpaque = true;
    const whiteFaceMesh = new THREE.Mesh(whiteGeometry, whiteMaterial);
    whiteFaceMesh.frustumCulled = false;
    whiteFaceMesh.renderOrder = raw.index + 1000;
    const whiteChip = new THREE.Group();
    whiteChip.frustumCulled = false;
    whiteChip.add(whiteFaceMesh);
    whiteChip.position.copy(centroid3);
    whiteChip.visible = false;
    whiteLayer.add(whiteChip);

    triangles.push({
      mesh: chip,
      faceMesh,
      wireMesh: wireChip,
      wireFaceMesh,
      dotMesh: dotChip,
      dotFaceMeshes,
      whiteMesh: whiteChip,
      whiteFaceMesh,
      color: raw.color,
      colorGroup: colorGroupIndex(raw.color),
      centroid: centroid3.clone(),
      worldVerts: worldVerts.map((v) => v.clone()),
      letterIndex: raw.letterIndex ?? 0,
      index: raw.index,
      homePosition: chip.position.clone(),
      homeScale: chip.scale.clone(),
      wireHomePosition: wireChip.position.clone(),
      dotHomePosition: dotChip.position.clone(),
      whiteHomePosition: whiteChip.position.clone(),
    });
  }

  return {
    group: coloredGroup,
    wireLayer: wireframeLayer,
    dotsLayer,
    whiteLayer,
    triangles,
    palette: PALETTE,
    letterCount: getLetterCount(rawTriangles),
  };
}

export function resetChipVisibility(triangles) {
  triangles.forEach((tri) => {
    tri.mesh.visible = true;
    setFaceOpacity(tri.faceMesh.material, 1);
  });
}

export function hideColoredLayer(triangles) {
  triangles.forEach((tri) => {
    tri.mesh.visible = false;
  });
}

export function resetWireLayer(triangles) {
  triangles.forEach((tri) => {
    tri.wireMesh.visible = false;
    tri.wireMesh.position.copy(tri.wireHomePosition);
    tri.wireMesh.scale.copy(tri.homeScale);
    tri.wireFaceMesh.material.opacity = 0;
  });
}

export function resetDotsLayer(triangles) {
  triangles.forEach((tri) => {
    tri.dotMesh.visible = false;
    tri.dotMesh.position.copy(tri.dotHomePosition);
    tri.dotMesh.scale.copy(tri.homeScale);
    tri.dotFaceMeshes.forEach((mesh) => {
      setFaceOpacity(mesh.material, 0);
    });
  });
}

export function resetWhiteLayer(triangles) {
  triangles.forEach((tri) => {
    tri.whiteMesh.visible = false;
    tri.whiteMesh.position.copy(tri.whiteHomePosition);
    tri.whiteMesh.scale.copy(tri.homeScale);
    setFaceOpacity(tri.whiteFaceMesh.material, 0);
  });
}

export function setFaceOpacity(material, opacity) {
  const opaque = opacity >= 0.999;
  material.opacity = opacity;
  // Transparent/invisible faces must not write depth or they punch holes in
  // wireframe/dots sitting on the plane behind (classic alpha sorting artifact).
  material.depthWrite = opaque;

  if (material.userData.solidWhenOpaque) {
    if (material.transparent !== !opaque) {
      material.transparent = !opaque;
      material.needsUpdate = true;
    }
  }
}

export function hideBehindLayersForTri(tri) {
  if (!tri) return;

  if (tri.dotFaceMeshes?.length) {
    tri.dotFaceMeshes.forEach((mesh) => setFaceOpacity(mesh.material, 0));
  }
  if (tri.dotMesh) tri.dotMesh.visible = false;
  if (tri.wireFaceMesh) setFaceOpacity(tri.wireFaceMesh.material, 0);
  if (tri.wireMesh) tri.wireMesh.visible = false;
  if (tri.faceMesh) setFaceOpacity(tri.faceMesh.material, 0);
  if (tri.mesh) tri.mesh.visible = false;
}

export function showBehindLayersForTri(tri) {
  if (!tri) return;

  // Restore wire + dots only. Keep construction (orange) hidden under white so
  // it can't pop out at the logo-depth gap after the solid reveal.
  if (tri.dotFaceMeshes?.length) {
    tri.dotFaceMeshes.forEach((mesh) => setFaceOpacity(mesh.material, 1));
  }
  if (tri.dotMesh) tri.dotMesh.visible = true;
  if (tri.wireFaceMesh) {
    setFaceOpacity(tri.wireFaceMesh.material, 1);
    // Full base color — don't inherit the dimmed "emissive off" wire look.
    const mat = tri.wireFaceMesh.material;
    if (mat.isLineMaterial && mat.userData.baseColor) {
      mat.color.copy(mat.userData.baseColor);
      if (mat.userData.glow) mat.userData.glow.emissiveIntensity = 0;
    }
  }
  if (tri.wireMesh) tri.wireMesh.visible = true;
  if (tri.faceMesh) setFaceOpacity(tri.faceMesh.material, 0);
  if (tri.mesh) tri.mesh.visible = false;
}

function vertexKey(vertex) {
  return [
    vertex.x.toFixed(VERTEX_MERGE_DECIMALS),
    vertex.y.toFixed(VERTEX_MERGE_DECIMALS),
    vertex.z.toFixed(VERTEX_MERGE_DECIMALS),
  ].join(',');
}

function createVertexDotMesh() {
  const geometry = new THREE.SphereGeometry(0.5, 10, 10);
  const material = new THREE.MeshBasicMaterial({
    color: DEFAULT_WIREFRAME_COLOR,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

function createTriangleWireGeometry(verts) {
  const geometry = new LineGeometry();
  const [a, b, c] = verts;
  geometry.setPositions([
    a.x, a.y, a.z, b.x, b.y, b.z,
    b.x, b.y, b.z, c.x, c.y, c.z,
    c.x, c.y, c.z, a.x, a.y, a.z,
  ]);
  return geometry;
}

function createFlatTriangleGeometry(verts) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(9);

  verts.forEach((vertex, index) => {
    positions[index * 3] = vertex.x;
    positions[index * 3 + 1] = vertex.y;
    positions[index * 3 + 2] = vertex.z;
  });

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();
  return geometry;
}

function getLetterCount(rawTriangles) {
  if (rawTriangles.length === 0) return 0;
  return Math.max(...rawTriangles.map((tri) => tri.letterIndex ?? 0)) + 1;
}

function assignLetterIndices(rawTriangles) {
  if (rawTriangles.length === 0) return;

  let minX = Infinity;
  let maxX = -Infinity;

  for (const tri of rawTriangles) {
    for (const [x] of tri.points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }

  const span = maxX - minX || 1;
  const estimatedLetters = Math.max(1, Math.round(span / (36 * 4)));
  const letterWidth = span / estimatedLetters;

  for (const tri of rawTriangles) {
    tri.letterIndex = Math.min(
      estimatedLetters - 1,
      Math.max(0, Math.floor((tri.centroid.x - minX) / letterWidth)),
    );
  }
}


function ensureFacingCamera(verts) {
  const cross =
    (verts[1].x - verts[0].x) * (verts[2].y - verts[0].y) -
    (verts[1].y - verts[0].y) * (verts[2].x - verts[0].x);
  if (cross < 0) {
    const swap = verts[1];
    verts[1] = verts[2];
    verts[2] = swap;
  }
}

function parsePoints(pointsAttr) {
  const nums = pointsAttr
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => !Number.isNaN(n));

  const pairs = [];
  for (let i = 0; i < nums.length - 1; i += 2) {
    const pair = [nums[i], nums[i + 1]];
    const prev = pairs[pairs.length - 1];
    if (!prev || prev[0] !== pair[0] || prev[1] !== pair[1]) {
      pairs.push(pair);
    }
  }

  if (pairs.length > 1) {
    const first = pairs[0];
    const last = pairs[pairs.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) {
      pairs.pop();
    }
  }

  if (pairs.length < 3) {
    throw new Error(`Polygon needs at least 3 unique points: ${pointsAttr}`);
  }

  if (pairs.length === 3) {
    return pairs;
  }

  if (pairs.length === 4) {
    return triangulateQuad(pairs);
  }

  throw new Error(`Expected 3 or 4 polygon points, got ${pairs.length}: ${pointsAttr}`);
}

function triangulateQuad(points) {
  const [a, b, c, d] = points;
  const diag1 = distSq(a, c);
  const diag2 = distSq(b, d);
  return diag1 <= diag2 ? [a, b, c] : [a, b, d];
}

function distSq(p1, p2) {
  const dx = p1[0] - p2[0];
  const dy = p1[1] - p2[1];
  return dx * dx + dy * dy;
}

function resolveColor(polygon) {
  const className = polygon.getAttribute('class')?.trim();
  if (className && CLASS_COLORS[className]) {
    return CLASS_COLORS[className];
  }

  const fill = polygon.getAttribute('fill');
  if (fill && fill !== 'none') {
    return fill;
  }

  return PALETTE[0];
}

function computeCentroid2D(points) {
  const x = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const y = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  return { x, y };
}

function computeBounds(triangles) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const tri of triangles) {
    for (const [x, y] of tri.points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return { minX, minY, maxX, maxY };
}

function colorGroupIndex(color) {
  const idx = PALETTE.indexOf(color.toLowerCase());
  return idx >= 0 ? idx : 0;
}

export function applyColorMode(triangles, mode, options = {}) {
  const {
    overrideColor = DEFAULT_CONSTRUCTION_COLOR,
    palette = PALETTE,
    wireframeColor = DEFAULT_WIREFRAME_COLOR,
    solidColor = DEFAULT_SOLID_COLOR,
  } = options;

  triangles.forEach((tri, i) => {
    let color;

    switch (mode) {
      case 'original':
        color = tri.color;
        break;
      case 'override':
        color = overrideColor;
        break;
      case 'gradient':
        color = gradientColor(tri.centroid.x, tri.centroid.y, palette);
        break;
      case 'random':
        color = palette[i % palette.length];
        break;
      default:
        color = tri.color;
    }

    tri.faceMesh.material.color.set(color);
    applyWireframeColor(tri.wireFaceMesh.material, wireframeColor);
    applyWireEmissive(
      tri.wireFaceMesh.material,
      tri.wireFaceMesh.material.userData.glow?.emissiveIntensity ?? 0,
    );
    tri.whiteFaceMesh.material.color.set(solidColor);
  });

  applyDotColors(triangles, wireframeColor);
}

function applyDotColors(triangles, color = DEFAULT_WIREFRAME_COLOR) {
  triangles.forEach((tri) => {
    tri.dotFaceMeshes?.forEach((mesh) => {
      mesh.material.color.set(color);
    });
  });
}

function applyWireframeColor(material, color = DEFAULT_WIREFRAME_COLOR) {
  if (!material.isLineMaterial) return;
  material.color.set(color);
  material.userData.baseColor.set(color);
}

export function applyWireEmissive(material, strength) {
  if (!material.isLineMaterial) return;

  material.userData.glow.emissiveIntensity = strength;
  const base = material.userData.baseColor;
  if (!base) return;

  // Glow may only brighten the wire — never dim it below its base color.
  const scale = Math.min(1.6, Math.max(1, 0.5 + strength * 0.75));
  material.color.copy(base).multiplyScalar(scale);
}

export function updateWireframeLineResolutions(triangles, width, height) {
  const resolution = new THREE.Vector2(width, height);
  triangles.forEach((tri) => {
    const material = tri.wireFaceMesh.material;
    if (material.isLineMaterial) {
      material.resolution.copy(resolution);
    }
  });
}

export function updateWireframeLineWidths(triangles, lineWidth) {
  triangles.forEach((tri) => {
    const material = tri.wireFaceMesh.material;
    if (material.isLineMaterial) {
      material.linewidth = lineWidth;
    }
  });
}

export function updateVertexDotSizes(
  triangles,
  camera,
  width,
  height,
  pixelSize = DEFAULT_DOT_PIXEL_SIZE,
) {
  const target = new THREE.Vector3();
  const vFov = (camera.fov * Math.PI) / 180;
  const distance = camera.position.distanceTo(target);
  const visibleHeight = 2 * Math.tan(vFov / 2) * distance;
  const worldSize = (pixelSize / height) * visibleHeight;

  triangles.forEach((tri) => {
    tri.dotFaceMeshes?.forEach((mesh) => {
      mesh.scale.set(worldSize, worldSize, worldSize);
    });
  });
}

const COLORED_EMISSIVE_BOOST = 1.5;

export function getWireEmissiveStrength(strength) {
  return strength * WIREFRAME_EMISSIVE_BOOST;
}

export function getColoredEmissiveStrength(strength) {
  return strength * COLORED_EMISSIVE_BOOST;
}

export function applyEmissiveStrength(triangles, strength, options = {}) {
  const coloredStrength = getColoredEmissiveStrength(strength);
  const wireframeColor = options.wireframeColor ?? DEFAULT_WIREFRAME_COLOR;

  triangles.forEach((tri) => {
    const material = tri.faceMesh.material;
    material.toneMapped = false;
    material.emissive.copy(material.color);
    material.emissiveIntensity = coloredStrength;

    applyWireframeColor(tri.wireFaceMesh.material, wireframeColor);
    applyWireEmissive(tri.wireFaceMesh.material, getWireEmissiveStrength(strength));
  });

  applyDotColors(triangles, wireframeColor);
}

function gradientColor(x, y, palette) {
  const t = (Math.atan2(y, x) + Math.PI) / (2 * Math.PI);
  const idx = Math.floor(t * palette.length) % palette.length;
  const next = (idx + 1) % palette.length;
  const blend = (t * palette.length) % 1;
  const c1 = new THREE.Color(palette[idx]);
  const c2 = new THREE.Color(palette[next]);
  return `#${c1.lerp(c2, blend).getHexString()}`;
}
