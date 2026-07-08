import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

const CLASS_COLORS = {
  st0: '#ff8ee3',
  st1: '#6b00e2',
  st2: '#fe00d2',
};

const PALETTE = Object.values(CLASS_COLORS);
const WIREFRAME_COLOR = CLASS_COLORS.st1;
const WIREFRAME_LINE_WIDTH = 2.5;
const WIREFRAME_EMISSIVE_BOOST = 1.25;
const LAYER_Z_STEP = 0.006;
const WIREFRAME_LAYER_Z_OFFSET = -1.5 * LAYER_Z_STEP;
const DOTS_LAYER_Z_OFFSET = -0.5 * LAYER_Z_STEP;
const COLORED_LAYER_Z_OFFSET = 0.5 * LAYER_Z_STEP;
const WHITE_LAYER_Z_OFFSET = 1.5 * LAYER_Z_STEP;
const WIREFRAME_CHIP_Z_EPSILON = 0.00005;
const DOTS_CHIP_Z_EPSILON = 0.000075;
const WHITE_CHIP_Z_EPSILON = 0.0001;
const DOT_PIXEL_SIZE = 8;

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
  wireframeLayer.position.z = WIREFRAME_LAYER_Z_OFFSET;
  wireframeLayer.renderOrder = 0;

  const dotsLayer = new THREE.Group();
  dotsLayer.name = 'vertexDotsLayer';
  dotsLayer.position.z = DOTS_LAYER_Z_OFFSET;
  dotsLayer.renderOrder = 1;

  const coloredGroup = new THREE.Group();
  coloredGroup.name = 'coloredLayer';
  coloredGroup.position.z = COLORED_LAYER_Z_OFFSET;
  coloredGroup.renderOrder = 2;

  const whiteLayer = new THREE.Group();
  whiteLayer.name = 'whiteLayer';
  whiteLayer.position.z = WHITE_LAYER_Z_OFFSET;
  whiteLayer.renderOrder = 3;

  const triangles = [];

  for (const raw of rawTriangles) {
    let worldVerts = raw.points.map(([x, y]) =>
      new THREE.Vector3((x - centerX) * scale, -(y - centerY) * scale, 0),
    );
    ensureFacingCamera(worldVerts);

    const centroid3 = new THREE.Vector3();
    worldVerts.forEach((v) => centroid3.add(v));
    centroid3.divideScalar(worldVerts.length);

    const localVerts = worldVerts.map((v) => v.clone().sub(centroid3));

    const geometry = createFlatTriangleGeometry(localVerts);
    const wireGeometry = createTriangleWireGeometry(localVerts);

    const wireMaterial = new LineMaterial({
      color: new THREE.Color(WIREFRAME_COLOR),
      linewidth: WIREFRAME_LINE_WIDTH,
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
    wireChip.position.z += raw.index * WIREFRAME_CHIP_Z_EPSILON;
    wireChip.visible = false;
    wireframeLayer.add(wireChip);

    const dotChip = new THREE.Group();
    dotChip.frustumCulled = false;
    const dotFaceMeshes = [];
    for (const localVert of localVerts) {
      const dotMesh = createVertexDotMesh();
      dotMesh.position.copy(localVert);
      dotMesh.renderOrder = raw.index + 500;
      dotChip.add(dotMesh);
      dotFaceMeshes.push(dotMesh);
    }
    dotChip.position.copy(centroid3);
    dotChip.position.z += raw.index * DOTS_CHIP_Z_EPSILON;
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
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
      depthTest: true,
      depthWrite: true,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const whiteFaceMesh = new THREE.Mesh(whiteGeometry, whiteMaterial);
    whiteFaceMesh.frustumCulled = false;
    whiteFaceMesh.renderOrder = raw.index + 1000;
    const whiteChip = new THREE.Group();
    whiteChip.frustumCulled = false;
    whiteChip.add(whiteFaceMesh);
    whiteChip.position.copy(centroid3);
    whiteChip.position.z += raw.index * WHITE_CHIP_Z_EPSILON;
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
    tri.faceMesh.material.opacity = 1;
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
      mesh.material.opacity = 0;
      mesh.material.color.set(0xffffff);
    });
  });
}

export function resetWhiteLayer(triangles) {
  triangles.forEach((tri) => {
    tri.whiteMesh.visible = false;
    tri.whiteMesh.position.copy(tri.whiteHomePosition);
    tri.whiteMesh.scale.copy(tri.homeScale);
    tri.whiteFaceMesh.material.opacity = 0;
    tri.whiteFaceMesh.material.color.set(0xffffff);
  });
}

function createVertexDotMesh() {
  const geometry = new THREE.SphereGeometry(0.5, 10, 10);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: true,
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
  const { overrideColor = '#ff8ee3', palette = PALETTE } = options;

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
    applyWireframeColor(tri.wireFaceMesh.material);
    applyWireEmissive(
      tri.wireFaceMesh.material,
      tri.wireFaceMesh.material.userData.glow?.emissiveIntensity ?? 0,
    );
  });
}

function applyWireframeColor(material) {
  if (!material.isLineMaterial) return;
  material.color.set(WIREFRAME_COLOR);
  material.userData.baseColor.set(WIREFRAME_COLOR);
}

export function applyWireEmissive(material, strength) {
  if (!material.isLineMaterial) return;

  material.userData.glow.emissiveIntensity = strength;
  const base = material.userData.baseColor;
  if (!base) return;

  const scale = strength <= 0.01 ? 0.3 : Math.min(1.6, 0.5 + strength * 0.75);
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

export function updateVertexDotSizes(triangles, camera, width, height) {
  const target = new THREE.Vector3();
  const vFov = (camera.fov * Math.PI) / 180;
  const distance = camera.position.distanceTo(target);
  const visibleHeight = 2 * Math.tan(vFov / 2) * distance;
  const worldSize = (DOT_PIXEL_SIZE / height) * visibleHeight;

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

export function applyEmissiveStrength(triangles, strength) {
  const coloredStrength = getColoredEmissiveStrength(strength);

  triangles.forEach((tri) => {
    const material = tri.faceMesh.material;
    material.toneMapped = false;
    material.emissive.copy(material.color);
    material.emissiveIntensity = coloredStrength;

    applyWireframeColor(tri.wireFaceMesh.material);
    applyWireEmissive(tri.wireFaceMesh.material, getWireEmissiveStrength(strength));
  });
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
