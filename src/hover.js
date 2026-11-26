import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pane } from 'tweakpane';
import defaultSvg from '../pr02.svg?raw';
import {
  parseSvgTriangles,
  applyColorMode,
  applyEmissiveStrength,
  setFaceOpacity,
  updateWireframeLineResolutions,
  updateWireframeLineWidths,
  updateVertexDotSizes,
  applyLogoLayerDepth,
  DEFAULT_WIREFRAME_COLOR,
  DEFAULT_CONSTRUCTION_COLOR,
  DEFAULT_SOLID_COLOR,
  DEFAULT_WIREFRAME_LINE_WIDTH,
  DEFAULT_DOT_PIXEL_SIZE,
} from './svgParser.js';
import {
  AberrationShader,
  applyChromaticAberrationToPass,
  isChromaticAberrationActive,
  defaultAberration,
  ABERRATION_FALLOFF_MIN,
  ABERRATION_FALLOFF_MAX,
} from './chromaticAberration.js';
const DEFAULT_SVG = defaultSvg;

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const DEFAULT_PARAMS = {
  hoverMode: 'hole',
  hoverRadius: 0.08,
  coloredRadiusScale: 1.6,
  wireRadiusScale: 2.4,
  dotRadiusScale: 3.2,
  hoverDepth: 0.06,
  hoverSoftness: 0.6,
  hoverFadeIn: 0.08,
  hoverFadeOut: 0.6,
  hoverStyle: 'digital',
  colorMode: 'override',
  overrideColor: DEFAULT_CONSTRUCTION_COLOR,
  wireframeColor: DEFAULT_WIREFRAME_COLOR,
  dotColor: '#e064ff',
  constructionColor: DEFAULT_CONSTRUCTION_COLOR,
  solidColor: DEFAULT_SOLID_COLOR,
  wireframeLineWidth: DEFAULT_WIREFRAME_LINE_WIDTH,
  dotPixelSize: DEFAULT_DOT_PIXEL_SIZE,
  logoDepth: 0.5,
  logoScale: 0.93,
  layerDots: true,
  layerWireframe: true,
  layerColored: true,
  layerWhite: true,
  background: '#000000',
  emissiveStrength: 0.4,
  bloom: true,
  bloomIntensity: 0,
  fxaa: true,
};

const params = {
  ...DEFAULT_PARAMS,
  aberration: { ...defaultAberration },
};

const urlParams = new URLSearchParams(window.location.search);

function urlFlag(name) {
  const value = urlParams.get(name);
  return value === '' || value === '1' || value === 'true';
}

function applyUrlNumber(key) {
  const raw = urlParams.get(key);
  if (raw == null || raw === '') return;
  const value = Number(raw);
  if (!Number.isNaN(value)) params[key] = value;
}

// Same page for authoring + embed: ?embed=1 (or any iframe) strips chrome; ?ui=1 forces the panel hint.
const forceUi = urlFlag('ui');
const embedMode = forceUi ? false : urlFlag('embed') || window.self !== window.top;
const transparentMode = urlFlag('transparent');

const EMBED_NUMBER_KEYS = [
  'hoverRadius',
  'coloredRadiusScale',
  'wireRadiusScale',
  'dotRadiusScale',
  'hoverDepth',
  'logoDepth',
  'logoScale',
  'bloomIntensity',
  'dotPixelSize',
  'wireframeLineWidth',
  'emissiveStrength',
];

const EMBED_COLOR_KEYS = [
  'background',
  'wireframeColor',
  'dotColor',
  'constructionColor',
  'solidColor',
];

for (const key of EMBED_NUMBER_KEYS) applyUrlNumber(key);

function applyUrlColor(key) {
  const raw = urlParams.get(key);
  if (!raw) return;
  params[key] = raw.startsWith('#') ? raw : `#${raw}`;
}

for (const key of EMBED_COLOR_KEYS) applyUrlColor(key);

{
  const mode = urlParams.get('hoverMode');
  if (mode === 'lift' || mode === 'hole') params.hoverMode = mode;
  const style = urlParams.get('hoverStyle');
  if (style === 'smooth' || style === 'digital' || style === 'hard') {
    params.hoverStyle = style;
  }
  if (urlParams.has('bloom')) params.bloom = urlFlag('bloom');
  if (urlParams.has('fxaa')) params.fxaa = urlFlag('fxaa');
  if (params.constructionColor) params.overrideColor = params.constructionColor;
}

document.documentElement.classList.toggle('is-embed', embedMode);
document.documentElement.classList.toggle('is-transparent', transparentMode);

const LOGO_SCALE_MIN = 0.2;
const LOGO_SCALE_MAX = 1;
const LOGO_VERTICAL_FILL = 0.9;
const CAMERA_FOV = 35;
const BLOOM_THRESHOLD = 0.82;
const DIGITAL_THRESHOLD = 0.5;
const VISIBLE_EPSILON = 0.002;
/** Idle dots are half the base size; peak hover is 25% above base. */
const DOT_SIZE_IDLE = 0.5;
const DOT_SIZE_PEAK = 1.25;

function isHoleMode() {
  return params.hoverMode === 'hole';
}

/**
 * Hover-driven layers: white lifts most, then construction, then wire; dots scale only.
 * In hole mode the front layers peel over the widest radius, so white and wire swap radii,
 * and layers sink deeper the further they are from the camera so the gaps only widen.
 */
const HOVER_LAYERS = [
  {
    key: 'white',
    radiusScale: () => (isHoleMode() ? params.wireRadiusScale : 1),
    depthScale: 1,
    holeDepthScale: 1,
  },
  {
    key: 'colored',
    radiusScale: () => params.coloredRadiusScale,
    depthScale: 0.55,
    holeDepthScale: 2,
  },
  {
    key: 'wire',
    radiusScale: () => (isHoleMode() ? 1 : params.wireRadiusScale),
    depthScale: 0.25,
    holeDepthScale: 3,
  },
  { key: 'dots', radiusScale: () => params.dotRadiusScale, depthScale: 0, holeDepthScale: 3 },
];

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  CAMERA_FOV,
  window.innerWidth / window.innerHeight,
  0.1,
  200,
);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  // Alpha only for transparent embeds — otherwise the CSS black body shows through
  // postprocessing and the Background picker looks "stuck" on black.
  alpha: transparentMode,
  premultipliedAlpha: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.domElement.style.touchAction = 'none';
document.body.appendChild(renderer.domElement);

function resolveBackgroundColor() {
  return new THREE.Color(params.background);
}

function applyBackground() {
  if (transparentMode) {
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    return;
  }
  const color = resolveBackgroundColor();
  scene.background = color;
  renderer.setClearColor(color, 1);
  const hex = `#${color.getHexString()}`;
  document.documentElement.style.background = hex;
  document.body.style.background = hex;
}

applyBackground();

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  params.bloomIntensity,
  0.4,
  BLOOM_THRESHOLD,
);
composer.addPass(bloomPass);
const aberrationPass = new ShaderPass(AberrationShader);
aberrationPass.uniforms.aspectRatio.value =
  window.innerHeight > 0 ? window.innerWidth / window.innerHeight : 1;
composer.addPass(aberrationPass);
const fxaaPass = new ShaderPass(FXAAShader);
fxaaPass.material.uniforms.resolution.value.set(
  1 / Math.max(window.innerWidth, 1),
  1 / Math.max(window.innerHeight, 1),
);
composer.addPass(fxaaPass);
const outputPass = new OutputPass();
composer.addPass(outputPass);
syncPostProcessingOutputs();
applyChromaticAberrationToPass(aberrationPass, params.aberration);

scene.add(new THREE.AmbientLight(0xffffff, 0.35));

const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
keyLight.position.set(6, 8, 12);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xff66ee, 0.55);
rimLight.position.set(-8, -4, 6);
scene.add(rimLight);

const fillLight = new THREE.PointLight(0x8844ff, 0.4, 80);
fillLight.position.set(0, -6, 10);
scene.add(fillLight);

const logoHolder = new THREE.Group();
scene.add(logoHolder);

let triangles = [];
let logoLayers = {
  wireLayer: null,
  dotsLayer: null,
  coloredLayer: null,
  whiteLayer: null,
};
let logoSize = new THREE.Vector2(1, 1);
let pane = null;
let uiVisible = false;
let lineWidthScale = 1;
let renderSizeOverride = false;

const recordStatusEl = document.getElementById('record-status');
const clock = new THREE.Clock();

const pointer = {
  active: false,
  ndc: new THREE.Vector2(),
};
const raycaster = new THREE.Raycaster();
const hoverPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const layerHits = {
  white: new THREE.Vector3(),
  colored: new THREE.Vector3(),
  wire: new THREE.Vector3(),
  dots: new THREE.Vector3(),
};
const layerHitValid = { white: false, colored: false, wire: false, dots: false };

function getLayerGroup(key) {
  if (key === 'white') return logoLayers.whiteLayer;
  if (key === 'colored') return logoLayers.coloredLayer;
  if (key === 'dots') return logoLayers.dotsLayer;
  return logoLayers.wireLayer;
}

function getLayerParts(tri, key) {
  if (key === 'white') {
    return {
      mesh: tri.whiteMesh,
      material: tri.whiteFaceMesh.material,
      home: tri.whiteHomePosition,
    };
  }
  if (key === 'colored') {
    return {
      mesh: tri.mesh,
      material: tri.faceMesh.material,
      home: tri.homePosition,
    };
  }
  if (key === 'dots') {
    return {
      mesh: tri.dotMesh,
      home: tri.dotHomePosition,
      dotMeshes: tri.dotFaceMeshes,
    };
  }
  return {
    mesh: tri.wireMesh,
    material: tri.wireFaceMesh.material,
    home: tri.wireHomePosition,
  };
}

function dotSizeFactor(value) {
  return DOT_SIZE_IDLE + value * (DOT_SIZE_PEAK - DOT_SIZE_IDLE);
}

function applyDotHoverScale(tri, value) {
  const factor = dotSizeFactor(value);
  tri.dotFaceMeshes.forEach((mesh) => {
    const base = mesh.userData.baseDotSize ?? 0;
    mesh.scale.setScalar(base * factor);
  });
}

function clearLogo() {
  while (logoHolder.children.length > 0) {
    const child = logoHolder.children[0];
    child.traverse((obj) => {
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach((material) => material.dispose());
      } else {
        obj.material?.dispose();
      }
    });
    logoHolder.remove(child);
  }
  triangles = [];
  logoLayers = {
    wireLayer: null,
    dotsLayer: null,
    coloredLayer: null,
    whiteLayer: null,
  };
}

function measureLogo() {
  const box = new THREE.Box3();
  for (const tri of triangles) {
    for (const vertex of tri.worldVerts) {
      box.expandByPoint(vertex);
    }
  }
  const size = box.getSize(new THREE.Vector3());
  logoSize = new THREE.Vector2(Math.max(size.x, 0.001), Math.max(size.y, 0.001));
}

function frameCameraToLogo() {
  if (triangles.length === 0) return;

  const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const aspect = Math.max(camera.aspect, 0.001);
  const fill = THREE.MathUtils.clamp(params.logoScale, LOGO_SCALE_MIN, LOGO_SCALE_MAX);
  const widthDistance = logoSize.x / (fill * 2 * tanHalfFov * aspect);
  const heightDistance = logoSize.y / (LOGO_VERTICAL_FILL * 2 * tanHalfFov);
  // Fit the resting solid plane; the hover bulge is allowed to swell past this.
  const frontZ = Math.max(0, params.logoDepth) * 2;

  camera.position.set(0, 0, frontZ + Math.max(widthDistance, heightDistance));
  camera.lookAt(0, 0, 0);
  applyHoleLayerAlignment();
}

/**
 * Hole mode peels one triangle at a time, so every back layer must sit exactly
 * behind the white from the camera's view. Scaling each layer by its distance
 * ratio cancels the perspective parallax between the stacked planes.
 */
function applyHoleLayerAlignment() {
  const { wireLayer, dotsLayer, coloredLayer, whiteLayer } = logoLayers;
  if (!whiteLayer) return;
  const frontDistance = camera.position.z - whiteLayer.position.z;
  for (const group of [wireLayer, dotsLayer, coloredLayer, whiteLayer]) {
    if (!group) continue;
    const k =
      isHoleMode() && frontDistance > 0
        ? (camera.position.z - group.position.z) / frontDistance
        : 1;
    group.scale.set(k, k, 1);
  }
}

const COLOR_BINDING_OPTS = {
  color: { type: 'int' },
};

function getLayerColorOptions() {
  return {
    overrideColor: params.constructionColor,
    wireframeColor: params.wireframeColor,
    solidColor: params.solidColor,
    dotColor: params.dotColor,
  };
}

function applyLogoDepth() {
  if (!logoLayers.wireLayer) return;
  applyLogoLayerDepth(logoLayers, params.logoDepth);
  frameCameraToLogo();
}

function applyLayerVisibility() {
  if (logoLayers.dotsLayer) logoLayers.dotsLayer.visible = params.layerDots;
  if (logoLayers.wireLayer) logoLayers.wireLayer.visible = params.layerWireframe;
  if (logoLayers.coloredLayer) logoLayers.coloredLayer.visible = params.layerColored;
  if (logoLayers.whiteLayer) logoLayers.whiteLayer.visible = params.layerWhite;
}

function applyWireframeLineWidths() {
  updateWireframeLineWidths(triangles, params.wireframeLineWidth * lineWidthScale);
}

function refreshVertexDotSizes() {
  const size = renderer.getSize(new THREE.Vector2());
  updateVertexDotSizes(triangles, camera, size.x, size.y, params.dotPixelSize);
  // Cache the neutral pixel-derived size so hover can scale around it.
  triangles.forEach((tri) => {
    tri.dotFaceMeshes?.forEach((mesh) => {
      mesh.userData.baseDotSize = mesh.scale.x;
    });
    applyDotHoverScale(tri, tri.hover?.dots ?? 0);
  });
}

function applyCurrentLayerAppearance() {
  if (triangles.length === 0) return;
  applyColorMode(triangles, params.colorMode, getLayerColorOptions());
  applyEmissiveStrength(triangles, params.emissiveStrength, getLayerColorOptions());
  applyWireframeLineWidths();
  applyLogoDepth();
  refreshVertexDotSizes();
  applyLayerVisibility();
}

function showDotsLayer() {
  triangles.forEach((tri) => {
    tri.dotMesh.visible = true;
    tri.dotFaceMeshes.forEach((mesh) => setFaceOpacity(mesh.material, 1));
  });
}

function emptyHoverMap(fill) {
  return { white: fill, colored: fill, wire: fill, dots: fill, dent: fill };
}

function resetHoverState() {
  triangles.forEach((tri) => {
    tri.hover = emptyHoverMap(0);
    tri.hoverShown = emptyHoverMap(-1);
    for (const layer of HOVER_LAYERS) {
      applyHoverIntensity(tri, layer, 0);
    }
  });
}

function loadSvg(svgText) {
  try {
    clearLogo();

    const { group, wireLayer, dotsLayer, whiteLayer, triangles: parsed } =
      parseSvgTriangles(svgText);
    logoHolder.add(wireLayer);
    logoHolder.add(dotsLayer);
    logoHolder.add(group);
    logoHolder.add(whiteLayer);
    logoLayers = {
      wireLayer,
      dotsLayer,
      coloredLayer: group,
      whiteLayer,
    };
    triangles = parsed;
    measureLogo();
    applyCurrentLayerAppearance();
    const size = renderer.getSize(new THREE.Vector2());
    updateWireframeLineResolutions(triangles, size.x, size.y);
    showDotsLayer();
    resetHoverState();
  } catch (error) {
    console.error('Failed to load SVG:', error);
  }
}

function hoverFalloff(distance, radius) {
  if (radius <= 0) return 0;
  const inner = radius * (1 - THREE.MathUtils.clamp(params.hoverSoftness, 0, 1));
  if (distance <= inner) return 1;
  if (distance >= radius) return 0;
  const t = (distance - inner) / (radius - inner);
  return 1 - t * t * (3 - 2 * t);
}

function easeToward(current, target, dt) {
  const tau = target > current ? params.hoverFadeIn : params.hoverFadeOut;
  if (tau <= 0) return target;
  const next = current + (target - current) * (1 - Math.exp(-dt / tau));
  return Math.abs(next - target) < 0.0005 ? target : next;
}

/**
 * Lift: layers fade in with their hover value (dots always shown).
 * Hole: layers start opaque and peel away; each back layer only shows once the
 * layer in front has started peeling, so depth parallax can't leak at rest.
 */
function layerOpacity(tri, key, value) {
  if (!isHoleMode()) return key === 'dots' ? 1 : value;
  const { hover } = tri;
  if (key === 'white') return 1 - value;
  if (key === 'colored') return hover.white * (1 - value);
  if (key === 'wire') return hover.colored * (1 - value);
  return hover.colored;
}

function applyHoverIntensity(tri, { key, depthScale, holeDepthScale }, value) {
  const parts = getLayerParts(tri, key);
  const opacity = layerOpacity(tri, key, value);
  // Lift raises layers toward the camera by their own value. Hole sinks all layers
  // of a triangle by one shared dent, scaled so deeper layers always move further.
  const offset = isHoleMode()
    ? -tri.hover.dent * params.hoverDepth * holeDepthScale
    : value * params.hoverDepth * depthScale;
  parts.mesh.position.z = parts.home.z + offset;

  if (key === 'dots') {
    applyDotHoverScale(tri, value);
    if (tri.hoverShown[key] === opacity) return;
    tri.hoverShown[key] = opacity;
    parts.mesh.visible = opacity > VISIBLE_EPSILON;
    parts.dotMeshes.forEach((mesh) => setFaceOpacity(mesh.material, opacity));
    return;
  }

  const { mesh, material } = parts;
  if (tri.hoverShown[key] === opacity) return;
  tri.hoverShown[key] = opacity;

  mesh.visible = opacity > VISIBLE_EPSILON;
  setFaceOpacity(material, opacity);
}

function invalidateHoverShown() {
  triangles.forEach((tri) => {
    tri.hoverShown = emptyHoverMap(-1);
  });
}

function updatePointerHits() {
  for (const { key } of HOVER_LAYERS) {
    layerHitValid[key] = false;
  }
  if (!pointer.active || triangles.length === 0) return;

  raycaster.setFromCamera(pointer.ndc, camera);
  for (const { key } of HOVER_LAYERS) {
    const group = getLayerGroup(key);
    if (!group) continue;
    hoverPlane.constant = -group.getWorldPosition(layerHits[key]).z;
    layerHitValid[key] = raycaster.ray.intersectPlane(hoverPlane, layerHits[key]) !== null;
  }
}

function updateHover(dt) {
  if (triangles.length === 0) return;
  updatePointerHits();

  const baseRadius = params.hoverRadius * logoSize.x;
  const hardPop = params.hoverStyle === 'hard';
  const hole = isHoleMode();
  const layerScale = {};
  for (const { key } of HOVER_LAYERS) {
    layerScale[key] = logoHolder.scale.x * (getLayerGroup(key)?.scale.x ?? 1);
  }

  for (const tri of triangles) {
    if (hole) {
      // Smooth crater over the widest peel radius, independent of the hover style snap.
      let dentTarget = 0;
      if (layerHitValid.white) {
        const scale = layerScale.white;
        const hit = layerHits.white;
        dentTarget = hoverFalloff(
          Math.hypot(hit.x - tri.centroid.x * scale, hit.y - tri.centroid.y * scale),
          baseRadius * HOVER_LAYERS[0].radiusScale() * scale,
        );
      }
      tri.hover.dent = hardPop ? dentTarget : easeToward(tri.hover.dent, dentTarget, dt);
    }

    for (const { key, radiusScale } of HOVER_LAYERS) {
      let target = 0;
      if (layerHitValid[key]) {
        const hit = layerHits[key];
        const scale = layerScale[key];
        const distance = Math.hypot(
          hit.x - tri.centroid.x * scale,
          hit.y - tri.centroid.y * scale,
        );
        const radius = baseRadius * radiusScale() * scale;
        if (hardPop) {
          // One-frame on/off from a hard radius edge — no soft falloff, no fade.
          target = distance <= radius ? 1 : 0;
        } else {
          target = hoverFalloff(distance, radius);
        }
      }
      if (params.hoverStyle === 'digital') {
        // Snap the target; easing still carries brightness + Z back into place.
        target = target >= DIGITAL_THRESHOLD ? 1 : 0;
      }
      tri.hover[key] = hardPop ? target : easeToward(tri.hover[key], target, dt);
    }
    // Applied after all layers update: hole-mode opacity reads neighbouring layers.
    for (const layer of HOVER_LAYERS) {
      applyHoverIntensity(tri, layer, tri.hover[layer.key]);
    }
  }
}

function setPointerFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.ndc.set(
    ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
    -((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1,
  );
  pointer.active = true;
}

function releasePointer() {
  pointer.active = false;
}

function buildWhiteLogoDataUrl(svgText) {
  const whiteSvg = svgText
    .replace(/<\?xml[\s\S]*?\?>/i, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/fill:\s*#[0-9a-fA-F]{3,8}/gi, 'fill:#e7e7e5')
    .replace(/\sfill="[^"]*"/gi, ' fill="#e7e7e5"')
    .replace(/<svg\b([^>]*)>/i, '<svg$1 aria-hidden="true" focusable="false">');

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(whiteSvg)}`;
}

function getPaneHost() {
  const root = pane?.element;
  if (!root) return null;
  const host = root.parentElement ?? root;
  host.classList.add('polyrig-pane-host');
  root.classList.add('polyrig-pane-scroll');
  return host;
}

function mountPaneBrandHeader() {
  const host = getPaneHost();
  if (!host || host.querySelector('.polyrig-pane-brand')) return;

  const brand = document.createElement('div');
  brand.className = 'polyrig-pane-brand';
  brand.innerHTML = `<img class="polyrig-pane-logo-img" src="${buildWhiteLogoDataUrl(DEFAULT_SVG)}" alt="Polyrig" draggable="false" />`;
  host.insertBefore(brand, host.firstChild);
}

function mountPaneFooter() {
  const host = getPaneHost();
  if (!host || host.querySelector('.polyrig-pane-footer')) return;

  const footer = document.createElement('div');
  footer.className = 'polyrig-pane-footer';

  const hideBtn = document.createElement('button');
  hideBtn.type = 'button';
  hideBtn.className = 'polyrig-pane-hide';
  hideBtn.textContent = 'Hide UI (H)';
  hideBtn.addEventListener('click', () => toggleUi());
  footer.appendChild(hideBtn);

  host.appendChild(footer);
}

function lockColorPickersToHex(root = pane?.element ?? document) {
  root.querySelectorAll('select.tp-coltxtv_ms').forEach((select) => {
    if (select.value === 'hex') return;
    select.value = 'hex';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function watchColorPickersForHex() {
  const root = pane?.element;
  if (!root || root.dataset.hexColorLock === '1') return;
  root.dataset.hexColorLock = '1';

  lockColorPickersToHex(root);
  const observer = new MutationObserver(() => lockColorPickersToHex(root));
  observer.observe(root, { childList: true, subtree: true });
}

function setUiVisible(visible) {
  uiVisible = visible;
  const host = getPaneHost() ?? pane?.element;
  if (host) {
    host.style.display = visible ? '' : 'none';
  }
}

function toggleUi() {
  setUiVisible(!uiVisible);
}

function mountUiLegend() {
  const el = document.getElementById('ui-legend');
  if (!el) return;
  if (embedMode) {
    el.hidden = true;
    return;
  }
  window.setTimeout(() => {
    el.classList.add('is-faded');
  }, 3000);
}

function buildEmbedUrl({ transparent = false } = {}) {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('embed', '1');
  if (transparent) url.searchParams.set('transparent', '1');

  // Bake the current tweak session so the iframe matches what you see.
  for (const key of EMBED_NUMBER_KEYS) {
    url.searchParams.set(key, String(params[key]));
  }
  for (const key of EMBED_COLOR_KEYS) {
    url.searchParams.set(key, String(params[key]).replace(/^#/, ''));
  }
  url.searchParams.set('hoverMode', params.hoverMode);
  url.searchParams.set('hoverStyle', params.hoverStyle);
  url.searchParams.set('bloom', params.bloom ? '1' : '0');
  url.searchParams.set('fxaa', params.fxaa ? '1' : '0');

  return url.href;
}

function buildEmbedSnippet({ transparent = false } = {}) {
  const src = buildEmbedUrl({ transparent });
  const bg = transparent ? 'background:transparent;' : '';
  return [
    '<iframe',
    `  src="${src}"`,
    '  title="Polyrig"',
    '  loading="lazy"',
    `  style="width:100%;height:420px;border:0;display:block;${bg}"`,
    '></iframe>',
  ].join('\n');
}

function setRecordStatus(message = '', visible = false) {
  recordStatusEl.textContent = message;
  recordStatusEl.classList.toggle('is-visible', visible && message.length > 0);
}

function usesPostProcessing() {
  return params.bloom || isChromaticAberrationActive(params.aberration) || params.fxaa;
}

function syncPostProcessingOutputs() {
  const bloomOn = params.bloom;
  const aberOn = isChromaticAberrationActive(params.aberration);
  const fxaaOn = !!params.fxaa;

  bloomPass.enabled = bloomOn;
  bloomPass.strength = params.bloomIntensity;
  bloomPass.threshold = BLOOM_THRESHOLD;
  fxaaPass.enabled = fxaaOn;

  // Earlier passes feed the chain; OutputPass owns the screen so linear → sRGB
  // is applied (without it, mid-gray backgrounds look nearly black).
  bloomPass.renderToScreen = false;
  aberrationPass.renderToScreen = false;
  fxaaPass.renderToScreen = false;
  outputPass.renderToScreen = true;
}

function updateAberrationPass() {
  applyChromaticAberrationToPass(aberrationPass, params.aberration);
  syncPostProcessingOutputs();
}

function applyRenderSize(width, height, updateStyle = true) {
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, updateStyle);
  composer.setSize(width, height);
  bloomPass.resolution.set(width, height);
  aberrationPass.uniforms.aspectRatio.value = height > 0 ? width / height : 1;
  fxaaPass.material.uniforms.resolution.value.set(
    1 / Math.max(width, 1),
    1 / Math.max(height, 1),
  );
  updateWireframeLineResolutions(triangles, width, height);
  // Line width is in render pixels; scale it so offscreen exports keep the on-screen proportions.
  lineWidthScale = height / Math.max(window.innerHeight, 1);
  applyWireframeLineWidths();
  frameCameraToLogo();
  refreshVertexDotSizes();
}

function resizeRenderer() {
  if (renderSizeOverride) return;
  applyRenderSize(window.innerWidth, window.innerHeight, true);
}

function renderFrame() {
  if (usesPostProcessing()) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

async function exportPngStill(scale = 1) {
  if (triangles.length === 0) return;

  const exportWidth = Math.max(1, Math.round(window.innerWidth * scale));
  const exportHeight = Math.max(1, Math.round(window.innerHeight * scale));
  const prevPixelRatio = renderer.getPixelRatio();

  setRecordStatus(`Exporting PNG ${scale}×…`, true);

  try {
    renderSizeOverride = true;
    renderer.setPixelRatio(1);
    applyRenderSize(exportWidth, exportHeight, false);
    renderFrame();

    const dataUrl = renderer.domElement.toDataURL('image/png');
    const blob = await (await fetch(dataUrl)).blob();
    if (!blob || blob.size === 0) {
      throw new Error('PNG export produced an empty image.');
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob(blob, `polyrig-hover-${scale}x-${stamp}.png`);
    setRecordStatus('PNG saved', true);
    window.setTimeout(() => setRecordStatus('', false), 2000);
  } catch (error) {
    console.error('PNG export failed:', error);
    setRecordStatus('PNG export failed', true);
    window.setTimeout(() => setRecordStatus('', false), 2500);
  } finally {
    renderSizeOverride = false;
    renderer.setPixelRatio(prevPixelRatio);
    resizeRenderer();
    renderFrame();
  }
}

function resetAllSettings() {
  Object.assign(params, DEFAULT_PARAMS);
  Object.assign(params.aberration, defaultAberration);

  applyBackground();
  updateAberrationPass();
  applyCurrentLayerAppearance();
  resetHoverState();
  pane?.refresh();
}

async function copySettings() {
  const text = JSON.stringify(
    {
      app: 'polyrig-hover',
      capturedAt: new Date().toISOString(),
      params: { ...params, aberration: { ...params.aberration } },
      embed: {
        active: embedMode,
        url: buildEmbedUrl(),
        transparentUrl: buildEmbedUrl({ transparent: true }),
        snippet: buildEmbedSnippet(),
      },
    },
    null,
    2,
  );

  try {
    await navigator.clipboard.writeText(text);
    setRecordStatus('Settings copied to clipboard', true);
    window.setTimeout(() => setRecordStatus('', false), 2000);
  } catch (error) {
    console.error('Copy settings failed:', error);
    setRecordStatus('Copy settings failed', true);
    window.setTimeout(() => setRecordStatus('', false), 2500);
  }
}

async function copyEmbedCode({ transparent = false } = {}) {
  const text = buildEmbedSnippet({ transparent });
  try {
    await navigator.clipboard.writeText(text);
    setRecordStatus(
      transparent ? 'Transparent embed code copied' : 'Embed code copied',
      true,
    );
    window.setTimeout(() => setRecordStatus('', false), 2000);
  } catch (error) {
    console.error('Copy embed code failed:', error);
    setRecordStatus('Copy embed code failed', true);
    window.setTimeout(() => setRecordStatus('', false), 2500);
  }
}

function setupControls() {
  // Live/embed builds stay static — no tweakpane, no H hint.
  if (embedMode) {
    mountUiLegend();
    return;
  }

  pane = new Pane();
  mountPaneBrandHeader();
  mountPaneFooter();
  setUiVisible(false);
  mountUiLegend();

  pane
    .addBinding(params, 'hoverMode', {
      label: 'Hover mode',
      options: { Lift: 'lift', 'Inverted (hole)': 'hole' },
    })
    .on('change', () => {
      applyHoleLayerAlignment();
      invalidateHoverShown();
    });

  const hoverFolder = pane.addFolder({ title: 'Hover', expanded: true });
  hoverFolder.addBinding(params, 'hoverRadius', {
    label: 'Hover radius',
    min: 0.01,
    max: 0.5,
    step: 0.005,
  });
  hoverFolder.addBinding(params, 'coloredRadiusScale', {
    label: 'Construction ×',
    min: 1,
    max: 5,
    step: 0.05,
  });
  hoverFolder.addBinding(params, 'wireRadiusScale', {
    label: 'Wireframe ×',
    min: 1,
    max: 8,
    step: 0.05,
  });
  hoverFolder.addBinding(params, 'dotRadiusScale', {
    label: 'Dots ×',
    min: 1,
    max: 10,
    step: 0.05,
  });
  hoverFolder.addBinding(params, 'hoverDepth', {
    label: 'Hover depth',
    min: 0,
    max: 3,
    step: 0.01,
  });
  hoverFolder.addBinding(params, 'hoverSoftness', {
    label: 'Softness',
    min: 0,
    max: 1,
    step: 0.01,
  });
  hoverFolder.addBinding(params, 'hoverFadeIn', {
    label: 'Fade in',
    min: 0,
    max: 1,
    step: 0.01,
  });
  hoverFolder.addBinding(params, 'hoverFadeOut', {
    label: 'Fade out',
    min: 0,
    max: 3,
    step: 0.01,
  });
  hoverFolder
    .addBinding(params, 'hoverStyle', {
      label: 'Style',
      options: { Smooth: 'smooth', Digital: 'digital', Hard: 'hard' },
    })
    .on('change', () => invalidateHoverShown());

  const layersFolder = pane.addFolder({ title: 'Layers', expanded: true });
  layersFolder
    .addBinding(params, 'logoScale', {
      label: 'Logo scale',
      min: LOGO_SCALE_MIN,
      max: LOGO_SCALE_MAX,
      step: 0.01,
    })
    .on('change', () => {
      frameCameraToLogo();
      refreshVertexDotSizes();
    });
  layersFolder
    .addBinding(params, 'logoDepth', {
      label: 'Logo depth',
      min: 0,
      max: 0.5,
      step: 0.001,
    })
    .on('change', () => {
      applyLogoDepth();
      refreshVertexDotSizes();
    });
  layersFolder
    .addBinding(params, 'layerDots', { label: 'Show dots' })
    .on('change', () => applyLayerVisibility());
  layersFolder
    .addBinding(params, 'layerWireframe', { label: 'Show wireframe' })
    .on('change', () => applyLayerVisibility());
  layersFolder
    .addBinding(params, 'layerColored', { label: 'Show construction' })
    .on('change', () => applyLayerVisibility());
  layersFolder
    .addBinding(params, 'layerWhite', { label: 'Show solid' })
    .on('change', () => applyLayerVisibility());
  layersFolder
    .addBinding(params, 'wireframeColor', { label: 'Wireframe', ...COLOR_BINDING_OPTS })
    .on('change', () => applyCurrentLayerAppearance());
  layersFolder
    .addBinding(params, 'dotColor', { label: 'Dots', ...COLOR_BINDING_OPTS })
    .on('change', () => applyCurrentLayerAppearance());
  layersFolder
    .addBinding(params, 'constructionColor', {
      label: 'Construction',
      ...COLOR_BINDING_OPTS,
    })
    .on('change', () => {
      params.overrideColor = params.constructionColor;
      if (params.colorMode === 'original') {
        params.colorMode = 'override';
        pane.refresh();
      }
      applyCurrentLayerAppearance();
    });
  layersFolder
    .addBinding(params, 'solidColor', { label: 'Solid', ...COLOR_BINDING_OPTS })
    .on('change', () => applyCurrentLayerAppearance());
  layersFolder
    .addBinding(params, 'wireframeLineWidth', {
      label: 'Line thickness',
      min: 0.5,
      max: 8,
      step: 0.1,
    })
    .on('change', () => applyWireframeLineWidths());
  layersFolder
    .addBinding(params, 'dotPixelSize', {
      label: 'Dot size',
      min: 2,
      max: 24,
      step: 1,
    })
    .on('change', () => refreshVertexDotSizes());

  const lookFolder = pane.addFolder({ title: 'Look', expanded: true });
  lookFolder
    .addBinding(params, 'colorMode', {
      label: 'Color mode',
      options: {
        Original: 'original',
        Override: 'override',
        Gradient: 'gradient',
        'Random palette': 'random',
      },
    })
    .on('change', () => applyCurrentLayerAppearance());

  lookFolder
    .addBinding(params, 'background', { label: 'Background', ...COLOR_BINDING_OPTS })
    .on('change', () => applyBackground());

  lookFolder
    .addBinding(params, 'emissiveStrength', { label: 'Emissive', min: 0, max: 3, step: 0.05 })
    .on('change', () => {
      applyEmissiveStrength(triangles, params.emissiveStrength, getLayerColorOptions());
    });

  lookFolder
    .addBinding(params, 'bloom', { label: 'Unreal bloom' })
    .on('change', () => syncPostProcessingOutputs());
  lookFolder
    .addBinding(params, 'bloomIntensity', {
      label: 'Bloom intensity',
      min: 0,
      max: 3,
      step: 0.05,
    })
    .on('change', () => syncPostProcessingOutputs());
  lookFolder
    .addBinding(params, 'fxaa', { label: 'FXAA' })
    .on('change', () => syncPostProcessingOutputs());

  const aberrationFolder = lookFolder.addFolder({ title: 'Chromatic aberration', expanded: false });
  aberrationFolder
    .addBinding(params.aberration, 'enabled', { label: 'Enabled' })
    .on('change', () => updateAberrationPass());
  aberrationFolder
    .addBinding(params.aberration, 'amount', {
      label: 'Amount',
      min: 0,
      max: 0.02,
      step: 0.0001,
    })
    .on('change', () => updateAberrationPass());
  aberrationFolder
    .addBinding(params.aberration, 'blur', {
      label: 'Blur',
      min: 0,
      max: 1,
      step: 0.01,
    })
    .on('change', () => updateAberrationPass());
  aberrationFolder
    .addBinding(params.aberration, 'falloff', {
      label: 'Edge',
      min: ABERRATION_FALLOFF_MIN,
      max: ABERRATION_FALLOFF_MAX,
      step: 0.05,
    })
    .on('change', () => updateAberrationPass());
  aberrationFolder
    .addBinding(params.aberration, 'quality', {
      label: 'Quality',
      options: {
        Low: 'low',
        Medium: 'medium',
        High: 'high',
        Ultra: 'ultra',
      },
    })
    .on('change', () => updateAberrationPass());

  watchColorPickersForHex();

  pane.addButton({ title: 'Reset all' }).on('click', () => resetAllSettings());
  pane.addButton({ title: 'Copy settings' }).on('click', () => copySettings());
  pane.addButton({ title: 'Copy embed code' }).on('click', () => copyEmbedCode());
  pane
    .addButton({ title: 'Copy transparent embed' })
    .on('click', () => copyEmbedCode({ transparent: true }));
  pane.addButton({ title: 'Load SVG file' }).on('click', () => {
    document.getElementById('file-input').click();
  });
  pane.addButton({ title: 'Reload default (pr02.svg)' }).on('click', () => loadSvg(DEFAULT_SVG));

  const exportFolder = pane.addFolder({ title: 'Export', expanded: true });
  exportFolder.addButton({ title: 'PNG still (1×)' }).on('click', () => exportPngStill(1));
  exportFolder.addButton({ title: 'PNG still (2×)' }).on('click', () => exportPngStill(2));
}

document.getElementById('file-input').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => loadSvg(e.target.result);
  reader.readAsText(file);
  event.target.value = '';
});

window.addEventListener('resize', resizeRenderer);

renderer.domElement.addEventListener('pointermove', setPointerFromEvent);
renderer.domElement.addEventListener('pointerdown', setPointerFromEvent);
renderer.domElement.addEventListener('pointerleave', releasePointer);
renderer.domElement.addEventListener('pointercancel', releasePointer);
renderer.domElement.addEventListener('pointerup', (event) => {
  if (event.pointerType !== 'mouse') releasePointer();
});
window.addEventListener('blur', releasePointer);

window.addEventListener('keydown', (event) => {
  if (embedMode) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    return;
  }
  if (event.key.toLowerCase() === 'h') {
    event.preventDefault();
    toggleUi();
  }
});

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  updateHover(delta);
  renderFrame();
}

setupControls();
loadSvg(DEFAULT_SVG);
animate();
