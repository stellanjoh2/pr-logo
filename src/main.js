import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import gsap from 'gsap';
import { Pane } from 'tweakpane';
import defaultSvg from '../pr02.svg?raw';
import {
  parseSvgTriangles,
  applyColorMode,
  applyEmissiveStrength,
  applyWireEmissive,
  getColoredEmissiveStrength,
  getWireEmissiveStrength,
  resetChipVisibility,
  resetWireLayer,
  resetDotsLayer,
  resetWhiteLayer,
  hideColoredLayer,
  setFaceOpacity,
  updateWireframeLineResolutions,
  updateWireframeLineWidths,
  updateVertexDotSizes,
  hideBehindLayersForTri,
  DEFAULT_WIREFRAME_COLOR,
  DEFAULT_CONSTRUCTION_COLOR,
  DEFAULT_SOLID_COLOR,
  DEFAULT_WIREFRAME_LINE_WIDTH,
  DEFAULT_DOT_PIXEL_SIZE,
  DEFAULT_LOGO_DEPTH,
  applyLogoLayerDepth,
} from './svgParser.js';
import { computeStaggerDelays, getShapeCentroid } from './stagger.js';
import {
  PATTERN_NAMES,
  computeStartState,
  applyStateToMesh,
  resetToHome,
  isDigitalBlinkPattern,
  buildDigitalBlinkTweens,
  buildDissolveBlinkTweens,
  buildDotRevealTweens,
  buildDotDissolveTweens,
  getDigitalBlinkDuration,
  shouldUseBlinkTweens,
} from './patterns.js';
import {
  CanvasMp4Recorder,
  CanvasMediaRecorder,
  CanvasPngSequenceRecorder,
  isWebCodecsMp4Supported,
  pickMediaRecorderMimeType,
  downloadBlob,
  getRecordingDownloadName,
  RECORD_FPS,
  RECORD_HEIGHT,
  CanvasProResRecorder,
} from './recorder.js';
import {
  AberrationShader,
  applyChromaticAberrationToPass,
  isChromaticAberrationActive,
  defaultAberration,
  ABERRATION_FALLOFF_MIN,
  ABERRATION_FALLOFF_MAX,
} from './chromaticAberration.js';
import { mountPageNav, consumeUiOpenFlag } from './pageNav.js';
import { createActionRow, markPrimary, confirmReset } from './paneChrome.js';

// Swap SVG source here, or use the file picker in the control panel.
const DEFAULT_SVG = defaultSvg;

const EASINGS = {
  easeOutBack: 'back.out(1.4)',
  easeOutSine: 'sine.out',
  easeOutCubic: 'power2.out',
  easeOutQuart: 'power3.out',
  easeOutQuint: 'power4.out',
  easeOutExpo: 'expo.out',
  easeInOutSine: 'sine.inOut',
  easeInOutQuad: 'power1.inOut',
  easeInOutCubic: 'power2.inOut',
  easeInOutQuart: 'power3.inOut',
  easeInOutQuint: 'power4.inOut',
  easeInOutExpo: 'expo.inOut',
  easeInOutCirc: 'circ.inOut',
  easeInOutBack: 'back.inOut(1.4)',
  linear: 'none',
};

const DEFAULT_PARAMS = {
  pattern: 'digital-blink',
  staggerOrder: 'left-to-right',
  duration: 1.2,
  staggerSpread: 0.4,
  easing: 'linear',
  loop: true,
  holdTime: 5.6,
  idle: false,
  idleIntensity: 0.35,
  colorMode: 'override',
  overrideColor: DEFAULT_CONSTRUCTION_COLOR,
  wireframeColor: DEFAULT_WIREFRAME_COLOR,
  dotColor: '#fff865',
  constructionColor: DEFAULT_CONSTRUCTION_COLOR,
  solidColor: DEFAULT_SOLID_COLOR,
  wireframeLineWidth: DEFAULT_WIREFRAME_LINE_WIDTH,
  dotPixelSize: DEFAULT_DOT_PIXEL_SIZE,
  logoDepth: DEFAULT_LOGO_DEPTH,
  layerDots: true,
  layerWireframe: true,
  layerColored: true,
  layerWhite: true,
  layerTravel: 6,
  layerLandingTime: 0.9,
  orbitControls: true,
  background: '#000000',
  emissiveStrength: 0.4,
  bloom: true,
  bloomIntensity: 0.65,
  fxaa: true,
  cameraMode: 'cinematic',
  cinematicRotateAngle: 45,
  cinematicDistance: 1,
  cinematicZoomOut: 0.2,
  cinematicRevealDelay: 1,
  cameraEasing: 'easeOutExpo',
  orbitSpeed: 1,
  finalizeHold: 0.5,
  finalizeDuration: 0.9,
};

const LOGO_HORIZONTAL_FILL = 0.9;

const params = {
  ...DEFAULT_PARAMS,
  aberration: { ...defaultAberration },
};

const DEFAULT_FRONT_CAMERA_DISTANCE = 9.115;
const MAIN_CAMERA = {
  position: [0, 0, DEFAULT_FRONT_CAMERA_DISTANCE],
  target: [0, 0, 0],
  fov: 35,
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(params.background);

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 0, DEFAULT_FRONT_CAMERA_DISTANCE);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const BLOOM_THRESHOLD = 0.82;
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
bloomPass.renderToScreen = false;
aberrationPass.renderToScreen = false;
fxaaPass.renderToScreen = false;
syncPostProcessingOutputs();
applyChromaticAberrationToPass(aberrationPass, params.aberration);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
syncOrbitControlsForCameraMode();

const ambient = new THREE.AmbientLight(0xffffff, 0.35);
scene.add(ambient);

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
let shapeCentroid = new THREE.Vector3();
let logoLayers = {
  wireLayer: null,
  dotsLayer: null,
  coloredLayer: null,
  whiteLayer: null,
};
let revealTimeline = null;
let revealDelayCall = null;
let earlierLayerTimelines = [];
let whiteRevealTimeline = null;
let whiteRevealStarted = false;
let emissiveFadeScheduled = false;
let dissolvePending = false;
let idleTimeline = null;
let pane = null;
let cameraModeBinding = null;
let orbitSpeedBinding = null;
let rotateAngleBinding = null;
let cinematicDistanceBinding = null;
let cinematicZoomOutBinding = null;
let cinematicRevealDelayBinding = null;
let cameraEasingBinding = null;
let playPauseButton = null;
let animationPaused = false;
let uiVisible = false;
let finalizeTimeline = null;
let holdTimeline = null;
let logoScaleTimeline = null;
let bloomFadeTimeline = null;
let revealPhase = 'dots';
let wireRevealStarted = false;
let coloredRevealStarted = false;
let activeRecorder = null;
let recordState = null;
let recordTickListener = null;
let steppedRecording = false;
let recordRenderRestore = null;
let lineWidthScale = 1;
const RECORD_END_PADDING_SEC = 0.5;
const LAYER_START_RATIO = 1 / 3;
const HOLD_FADE_RATIO = 0.5;
const FIRST_LETTER_INDEX = 0;
const LOGO_SCALE_END = 0.7;
const BLOOM_FADE_EASE = 'expo.out';

function getCameraEase() {
  return EASINGS[params.cameraEasing] ?? EASINGS.easeOutExpo;
}
const LAYER_LANDING_EASE = 'power3.out';
const LAYER_LIFT_EASE = 'power3.in';
const recordStatusEl = document.getElementById('record-status');

const defaultCameraPosition = camera.position.clone();

let cameraMotionTimeline = null;
let activeCameraState = 'main';
const _cameraMotionEnd = new THREE.Vector3();
const _cameraRotateAxisY = new THREE.Vector3(0, 1, 0);

const ORBIT_REVOLUTION_SEC = 60;
const ORBIT_ZOOM_MIN = 0.5;
const ORBIT_ZOOM_MAX = 80;
const cameraClock = new THREE.Clock();
let orbitAngle = 0;
let orbitRadius = DEFAULT_FRONT_CAMERA_DISTANCE;

function isCinematicCamera() {
  return params.cameraMode === 'cinematic' || params.cameraMode === 'cinematic-rotate';
}

function isOrbitCamera() {
  return params.cameraMode === 'orbit';
}

function syncOrbitControlsForCameraMode() {
  controls.enabled =
    params.cameraMode === 'free' ||
    (isCinematicCamera() && params.orbitControls);
  // Cinematic modes handle the wheel via cinematicDistance so it survives the camera motion.
  controls.enableZoom = !isCinematicCamera();
}

const CINEMATIC_DISTANCE_MIN = 0.3;
const CINEMATIC_DISTANCE_MAX = 3;

let appliedCinematicDistance = 1;

function setCinematicDistance(value) {
  const next = THREE.MathUtils.clamp(value, CINEMATIC_DISTANCE_MIN, CINEMATIC_DISTANCE_MAX);
  params.cinematicDistance = next;
  // While the motion runs it re-applies the distance every frame; afterwards, scale in place.
  if (!cameraMotionTimeline && isCinematicCamera() && appliedCinematicDistance > 0) {
    const offset = camera.position.clone().sub(controls.target);
    camera.position
      .copy(controls.target)
      .add(offset.multiplyScalar(next / appliedCinematicDistance));
    controls.update();
  }
  appliedCinematicDistance = next;
}

function zoomCinematicCamera(deltaY) {
  if (!isCinematicCamera()) return;
  setCinematicDistance(params.cinematicDistance * Math.exp(deltaY * 0.0015));
  cinematicDistanceBinding?.refresh();
}

function updateCameraPaneState() {
  if (orbitSpeedBinding) {
    orbitSpeedBinding.hidden = params.cameraMode !== 'orbit';
  }
  if (cinematicDistanceBinding) cinematicDistanceBinding.hidden = !isCinematicCamera();
  if (cinematicZoomOutBinding) cinematicZoomOutBinding.hidden = !isCinematicCamera();
  if (cinematicRevealDelayBinding) cinematicRevealDelayBinding.hidden = !isCinematicCamera();
  if (cameraEasingBinding) cameraEasingBinding.hidden = !isCinematicCamera();
  const isRotate = params.cameraMode === 'cinematic-rotate';
  if (rotateAngleBinding) rotateAngleBinding.hidden = !isRotate;
}

function resetOrbitCameraState() {
  const target = controls.target;
  const offsetX = camera.position.x - target.x;
  const offsetZ = camera.position.z - target.z;
  orbitAngle = Math.atan2(offsetX, offsetZ);
  orbitRadius = Math.max(Math.hypot(offsetX, offsetZ), 0.001);
}

function zoomOrbitCamera(deltaY) {
  if (!isOrbitCamera()) return;
  const factor = Math.exp(-deltaY * 0.0015);
  orbitRadius = THREE.MathUtils.clamp(orbitRadius * factor, ORBIT_ZOOM_MIN, ORBIT_ZOOM_MAX);
}

function updateOrbitCamera(delta) {
  if (!isOrbitCamera()) return;

  if (delta) {
    const speed = Math.max(0, params.orbitSpeed);
    orbitAngle -= ((delta * Math.PI * 2) / ORBIT_REVOLUTION_SEC) * speed;
  }
  const target = controls.target;
  camera.position.x = target.x + Math.sin(orbitAngle) * orbitRadius;
  camera.position.z = target.z + Math.cos(orbitAngle) * orbitRadius;
  camera.lookAt(target);
}

function captureCameraPose() {
  return {
    position: camera.position.clone(),
    target: controls.target.clone(),
    fov: camera.fov,
  };
}

function restoreCameraPose(pose) {
  if (!pose) return;
  // Clear damping inertia so OrbitControls can't ease back toward an old front shot.
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  camera.position.copy(pose.position);
  camera.fov = pose.fov;
  camera.updateProjectionMatrix();
  controls.target.copy(pose.target);
  camera.lookAt(controls.target);
  controls.update();
  controls.enableDamping = damping;
}

function applyCameraModeChange() {
  if (params.cameraMode === 'free' || params.cameraMode === 'orbit') {
    clearCameraSequence();
    resetLogoScale();
  }
  if (params.cameraMode === 'orbit') {
    frameCameraToLogo();
    resetOrbitCameraState();
  }
  syncOrbitControlsForCameraMode();
  updateCameraPaneState();
  playReveal();
}

function applyCameraState({ position, target, fov }, stateName = 'custom') {
  camera.position.set(position[0], position[1], position[2]);
  camera.fov = fov;
  camera.updateProjectionMatrix();
  controls.target.set(target[0], target[1], target[2]);
  camera.lookAt(controls.target);
  controls.update();
  activeCameraState = stateName;
}

function clearCameraSequence() {
  cameraMotionTimeline?.kill();
  cameraMotionTimeline = null;
}

function startCinematicCameraMotion() {
  clearCameraSequence();

  if (!isCinematicCamera()) {
    return;
  }

  applyCameraState(MAIN_CAMERA, 'main');

  const target = controls.target.clone();
  const startPos = camera.position.clone();
  const endPos = _cameraMotionEnd.set(
    MAIN_CAMERA.position[0],
    MAIN_CAMERA.position[1],
    MAIN_CAMERA.position[2] * (1 + params.cinematicZoomOut),
  );
  // Finish before the dissolve so only the parts move on the way out.
  const duration = Math.max(0.001, computeFullAnimationDuration({ includeDissolve: false }));
  const rotates = params.cameraMode === 'cinematic-rotate';
  const startYaw = rotates ? THREE.MathUtils.degToRad(params.cinematicRotateAngle) : 0;
  const offset = new THREE.Vector3();

  const applyMotion = (progress) => {
    offset.lerpVectors(startPos, endPos, progress).sub(target);
    offset.multiplyScalar(params.cinematicDistance);
    appliedCinematicDistance = params.cinematicDistance;
    if (rotates) {
      const yaw = startYaw * (1 - progress);
      offset.applyAxisAngle(_cameraRotateAxisY, yaw);
      // Counter the side-on foreshortening so on-screen size shrinks like Cinematic Zoom.
      const scale = THREE.MathUtils.lerp(1, LOGO_SCALE_END, progress);
      logoHolder.scale.setScalar(scale / Math.max(Math.cos(yaw), 0.25));
    }
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
    controls.update();
  };

  activeCameraState = 'main';
  applyMotion(0);

  const motion = { progress: 0 };
  cameraMotionTimeline = gsap.timeline({
    onComplete: () => {
      applyMotion(1);
      cameraMotionTimeline = null;
    },
  });

  cameraMotionTimeline.to(
    motion,
    {
      progress: 1,
      duration,
      ease: getCameraEase(),
      onUpdate: () => applyMotion(motion.progress),
    },
    0,
  );

  if (camera.fov !== MAIN_CAMERA.fov) {
    cameraMotionTimeline.to(
      camera,
      {
        fov: MAIN_CAMERA.fov,
        duration,
        ease: getCameraEase(),
        onUpdate: () => camera.updateProjectionMatrix(),
      },
      0,
    );
  }
}

function startCameraSequence() {
  startCinematicCameraMotion();
}

function getAnimTriangle(tri, layer) {
  const base = { homeScale: tri.homeScale };

  if (layer === 'white') {
    return {
      ...base,
      mesh: tri.whiteMesh,
      faceMesh: tri.whiteFaceMesh,
      homePosition: tri.whiteHomePosition,
    };
  }
  if (layer === 'dots') {
    return {
      ...base,
      mesh: tri.dotMesh,
      faceMesh: tri.dotFaceMeshes[0],
      dotFaceMeshes: tri.dotFaceMeshes,
      homePosition: tri.dotHomePosition,
    };
  }
  if (layer === 'wireframe') {
    return {
      ...base,
      mesh: tri.wireMesh,
      faceMesh: tri.wireFaceMesh,
      homePosition: tri.wireHomePosition,
    };
  }

  return {
    ...base,
    mesh: tri.mesh,
    faceMesh: tri.faceMesh,
    homePosition: tri.homePosition,
  };
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

function frameCameraToLogo() {
  if (triangles.length === 0) return;

  const box = new THREE.Box3();
  for (const tri of triangles) {
    for (const vertex of tri.worldVerts) {
      box.expandByPoint(vertex);
    }
  }

  const size = box.getSize(new THREE.Vector3());
  const logoWidth = Math.max(size.x, 0.001);
  const fovRad = (camera.fov * Math.PI) / 180;
  const aspect = Math.max(camera.aspect, 0.001);
  const distance =
    logoWidth / (LOGO_HORIZONTAL_FILL * 2 * Math.tan(fovRad / 2) * aspect);

  camera.position.set(0, 0, distance);
  camera.lookAt(0, 0, 0);
  defaultCameraPosition.copy(camera.position);
  controls.target.set(0, 0, 0);
  controls.update();
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
  mountPageNav(brand);

  const { row, buttons } = createActionRow([
    { label: 'Replay', variant: 'primary', onClick: () => playReveal() },
    { label: 'Pause', title: 'Space', onClick: () => toggleAnimationPause() },
  ]);
  row.classList.add('polyrig-pane-toolbar');
  playPauseButton = buttons[1];
  syncPlayPauseButton();
  brand.appendChild(row);

  host.insertBefore(brand, host.firstChild);
}

function mountPaneFooter() {
  const host = getPaneHost();
  if (!host || host.querySelector('.polyrig-pane-footer')) return;

  const footer = document.createElement('div');
  footer.className = 'polyrig-pane-footer';
  footer.appendChild(
    createActionRow([
      { label: 'Copy settings', onClick: () => copySettings() },
      { label: 'Reset all', onClick: () => confirmReset() && resetAllSettings() },
    ]).row,
  );
  footer.appendChild(
    createActionRow([{ label: 'Hide UI (H)', variant: 'ghost', onClick: () => toggleUi() }]).row,
  );

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
}

function applyLayerVisibility() {
  if (logoLayers.dotsLayer) logoLayers.dotsLayer.visible = params.layerDots;
  if (logoLayers.wireLayer) logoLayers.wireLayer.visible = params.layerWireframe;
  if (logoLayers.coloredLayer) logoLayers.coloredLayer.visible = params.layerColored;
  if (logoLayers.whiteLayer) logoLayers.whiteLayer.visible = params.layerWhite;
}

function applyCurrentLayerAppearance() {
  if (triangles.length === 0) return;
  applyColorMode(triangles, params.colorMode, getLayerColorOptions());
  applyEmissiveStrength(triangles, params.emissiveStrength, getLayerColorOptions());
  applyWireframeLineWidths();
  refreshVertexDotSizes();
  applyLogoDepth();
  applyLayerVisibility();
}

function refreshVertexDotSizes() {
  updateVertexDotSizes(
    triangles,
    camera,
    window.innerWidth,
    window.innerHeight,
    params.dotPixelSize,
  );
}

function resetFinalState() {
  finalizeTimeline?.kill();
  finalizeTimeline = null;
  revealPhase = 'dots';
  wireRevealStarted = false;
  coloredRevealStarted = false;
  whiteRevealStarted = false;
  emissiveFadeScheduled = false;
  dissolvePending = false;
  resetChipVisibility(triangles);
  resetWireLayer(triangles);
  resetDotsLayer(triangles);
  resetWhiteLayer(triangles);
  applyCurrentLayerAppearance();
  if (params.bloom) {
    bloomPass.strength = params.bloomIntensity;
    bloomPass.threshold = BLOOM_THRESHOLD;
  }
  resetLogoScale();
  resetBloomFade();
}

function loadSvg(svgText) {
  try {
    clearLogo();
    stopAnimations();

    const { group, wireLayer, dotsLayer, whiteLayer, triangles: parsed } = parseSvgTriangles(svgText);
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
    shapeCentroid = getShapeCentroid(triangles);
    applyCurrentLayerAppearance();
    updateWireframeLineResolutions(triangles, window.innerWidth, window.innerHeight);
    frameCameraToLogo();

    playReveal();
  } catch (error) {
    console.error('Failed to load SVG:', error);
  }
}

function stopRevealAnimations() {
  revealDelayCall?.kill();
  revealDelayCall = null;
  revealTimeline?.kill();
  revealTimeline = null;
  earlierLayerTimelines.forEach((tl) => tl.kill());
  earlierLayerTimelines = [];
  whiteRevealTimeline?.kill();
  whiteRevealTimeline = null;
  finalizeTimeline?.kill();
  finalizeTimeline = null;
  idleTimeline?.kill();
  idleTimeline = null;
  holdTimeline?.kill();
  holdTimeline = null;
  emissiveFadeScheduled = false;
  dissolvePending = false;
}

function stopAnimations() {
  stopRevealAnimations();
  logoScaleTimeline?.kill();
  logoScaleTimeline = null;
  resetBloomFade();
  clearCameraSequence();
}

function getAnimationStaggerOrder(reverse) {
  if (isDigitalBlinkPattern(params.pattern) || reverse) {
    return 'left-to-right';
  }
  return params.staggerOrder;
}

function computeRevealEndTime(startStates, triDuration, reverse = false, blinkDuration = null) {
  let maxEnd = 0;
  const blinkDurationResolved = blinkDuration ?? getDigitalBlinkDuration();
  const useBlink = shouldUseBlinkTweens(params.pattern, reverse);

  for (const [, start] of startStates) {
    const end = useBlink ? start.delay + blinkDurationResolved : start.delay + triDuration;
    maxEnd = Math.max(maxEnd, end);
  }

  return maxEnd;
}

function computeLetterRevealEndTime(letterIndex, startStates, triDuration, reverse = false) {
  const blinkDuration = getDigitalBlinkDuration();
  const useBlink = shouldUseBlinkTweens(params.pattern, reverse);
  let maxEnd = 0;
  let found = false;

  for (const [tri, start] of startStates) {
    if ((tri.letterIndex ?? 0) !== letterIndex) continue;
    found = true;
    const end = useBlink ? start.delay + blinkDuration : start.delay + triDuration;
    maxEnd = Math.max(maxEnd, end);
  }

  return found ? maxEnd : 0;
}

function hasLetterTriangles(letterIndex) {
  return triangles.some((tri) => (tri.letterIndex ?? 0) === letterIndex);
}

function extendTimelineTo(timeline, minDuration) {
  const remaining = minDuration - timeline.duration();
  if (remaining > 0.001) {
    timeline.to({}, { duration: remaining });
  }
}

function getRevealStartStates(reverse = false, layer = 'colored') {
  const staggerOrder = getAnimationStaggerOrder(reverse);
  const delays = computeStaggerDelays(
    triangles,
    staggerOrder,
    params.staggerSpread,
    params.duration,
    shapeCentroid,
    { staggerEasing: getStaggerEasing(staggerOrder) },
  );
  const startStates = new Map();

  for (const tri of triangles) {
    const animTri = getAnimTriangle(tri, layer);
    const delay = delays.get(tri) ?? 0;
    startStates.set(
      tri,
      computeStartState(animTri, params.pattern, params, shapeCentroid, delay),
    );
  }

  return startStates;
}

function hasLayerLanding() {
  return params.layerTravel > 0 && params.layerLandingTime > 0;
}

function computeLayerLandingEndTime(startStates) {
  if (!hasLayerLanding()) return 0;
  let maxDelay = 0;
  for (const [, start] of startStates) {
    maxDelay = Math.max(maxDelay, start.delay);
  }
  return maxDelay + params.layerLandingTime;
}

function computeLayerTiming() {
  const triDuration = Math.max(0.15, params.duration * (1 - params.staggerSpread * 0.5));
  const dotsRevealEndTime = isDigitalBlinkPattern(params.pattern)
    ? computeRevealEndTime(getRevealStartStates(false, 'dots'), triDuration, false, 0)
    : computeRevealEndTime(getRevealStartStates(false, 'dots'), triDuration, false);
  const wireRevealEndTime = computeRevealEndTime(
    getRevealStartStates(false, 'wireframe'),
    triDuration,
    false,
  );
  const coloredRevealEndTime = computeRevealEndTime(
    getRevealStartStates(false, 'colored'),
    triDuration,
    false,
  );
  const whiteStartStates = getRevealStartStates(false, 'white');
  const whiteRevealEndTime = Math.max(
    computeRevealEndTime(whiteStartStates, triDuration, false),
    computeLayerLandingEndTime(whiteStartStates),
  );
  const wireStartOffset = dotsRevealEndTime * LAYER_START_RATIO;
  const coloredStartOffset = wireStartOffset + wireRevealEndTime * LAYER_START_RATIO;
  const whiteStartOffset = coloredStartOffset + coloredRevealEndTime * LAYER_START_RATIO;
  const whiteLetterPEndTime = hasLetterTriangles(FIRST_LETTER_INDEX)
    ? computeLetterRevealEndTime(
        FIRST_LETTER_INDEX,
        getRevealStartStates(false, 'white'),
        triDuration,
        false,
      )
    : whiteRevealEndTime;
  const holdFadeDuration = params.holdTime * HOLD_FADE_RATIO;

  return {
    triDuration,
    dotsRevealEndTime,
    wireRevealEndTime,
    coloredRevealEndTime,
    whiteRevealEndTime,
    wireStartOffset,
    coloredStartOffset,
    whiteStartOffset,
    whiteLetterPEndTime,
    holdFadeDuration,
  };
}

function computeDissolveDuration() {
  const { triDuration } = computeLayerTiming();
  const startStates = getRevealStartStates(true, 'white');
  const layerRevealEnd = computeRevealEndTime(startStates, triDuration, true);
  const coloredStart = layerRevealEnd * LAYER_START_RATIO;
  const wireStart = coloredStart + layerRevealEnd * LAYER_START_RATIO;
  const dotsStart = wireStart + layerRevealEnd * LAYER_START_RATIO;
  let maxEnd = dotsStart;
  for (const [, start] of startStates) {
    maxEnd = Math.max(maxEnd, dotsStart + start.delay);
  }

  return maxEnd + (hasLayerLanding() ? params.layerLandingTime : 0);
}

function computeFullAnimationDuration({ includeDissolve = true } = {}) {
  if (triangles.length === 0) return 0;

  const { whiteStartOffset, whiteLetterPEndTime, whiteRevealEndTime, holdFadeDuration } =
    computeLayerTiming();
  const emissiveFadeEnd = whiteStartOffset + whiteLetterPEndTime + holdFadeDuration;
  const whiteRevealEnd = whiteStartOffset + whiteRevealEndTime;

  const revealDelay = getRevealStartDelay();

  if (params.loop && includeDissolve) {
    return revealDelay + Math.max(emissiveFadeEnd, whiteRevealEnd) + computeDissolveDuration();
  }

  return revealDelay + Math.max(emissiveFadeEnd, whiteRevealEnd);
}

function getRevealStartDelay() {
  return isCinematicCamera() ? Math.max(0, params.cinematicRevealDelay) : 0;
}

function computeFullIntroDuration() {
  if (triangles.length === 0) return 0;

  const {
    whiteStartOffset,
    whiteRevealEndTime,
    whiteLetterPEndTime,
    holdFadeDuration,
  } = computeLayerTiming();
  const whiteCompleteTime =
    whiteStartOffset +
    Math.max(whiteRevealEndTime, whiteLetterPEndTime + holdFadeDuration);

  return whiteCompleteTime + params.holdTime;
}

function resetBloomFade() {
  bloomFadeTimeline?.kill();
  bloomFadeTimeline = null;
  if (params.bloom) {
    bloomPass.strength = params.bloomIntensity;
    bloomPass.threshold = BLOOM_THRESHOLD;
  }
}

function getBloomFadeStartTime() {
  const { whiteStartOffset, whiteLetterPEndTime, whiteRevealEndTime } = computeLayerTiming();
  const revealDelay = getRevealStartDelay();
  if (hasLetterTriangles(FIRST_LETTER_INDEX)) {
    return revealDelay + whiteStartOffset + whiteLetterPEndTime;
  }
  return revealDelay + whiteStartOffset + whiteRevealEndTime;
}

function startBloomFade() {
  resetBloomFade();
  if (!params.bloom || triangles.length === 0) return;

  const startDelay = getBloomFadeStartTime();
  const fullDuration = computeFullAnimationDuration();
  const fadeDuration = Math.max(0.001, fullDuration - startDelay);
  const bloom = { factor: 1 };

  bloomFadeTimeline = gsap.timeline();
  if (startDelay > 0) {
    bloomFadeTimeline.to({}, { duration: startDelay });
  }
  bloomFadeTimeline.to(bloom, {
    factor: 0,
    duration: fadeDuration,
    ease: BLOOM_FADE_EASE,
    onUpdate: () => {
      bloomPass.strength = params.bloomIntensity * bloom.factor;
      bloomPass.threshold = BLOOM_THRESHOLD * bloom.factor;
    },
  });
}

function resetLogoScale() {
  logoScaleTimeline?.kill();
  logoScaleTimeline = null;
  logoHolder.scale.set(1, 1, 1);
}

function startLogoScaleOut() {
  if (!isCinematicCamera()) {
    resetLogoScale();
    return;
  }
  // Cinematic Rotate drives the logo scale from its camera motion.
  if (params.cameraMode === 'cinematic-rotate') return;

  resetLogoScale();

  const fullDuration = computeFullAnimationDuration({ includeDissolve: false });
  if (fullDuration <= 0) return;

  logoScaleTimeline = gsap.to(logoHolder.scale, {
    x: LOGO_SCALE_END,
    y: LOGO_SCALE_END,
    z: LOGO_SCALE_END,
    duration: fullDuration,
    ease: getCameraEase(),
  });
}

function beginWireframeReveal() {
  if (wireRevealStarted) return;
  wireRevealStarted = true;
  revealPhase = 'wireframe';
  buildRevealTimeline({ reverse: false, layer: 'wireframe' });
}

function beginColoredReveal() {
  if (coloredRevealStarted) return;
  coloredRevealStarted = true;
  revealPhase = 'colored';
  buildRevealTimeline({ reverse: false, layer: 'colored' });
}

function beginWhiteReveal() {
  if (whiteRevealStarted) return;
  whiteRevealStarted = true;
  revealPhase = 'white';
  resetWhiteLayer(triangles);
  buildRevealTimeline({ reverse: false, layer: 'white' });
}

function getHoldFadeMaterials() {
  // Only the solid (colored) faces — fading wire emissive dims LineMaterial
  // color to ~30% and the wire looks washed out for the whole dissolve-out.
  return triangles.map((tri) => tri.faceMesh.material);
}

function startEmissiveFadeOut(duration, onComplete) {
  holdTimeline?.kill();

  if (duration <= 0) {
    onComplete?.();
    return;
  }

  const materials = getHoldFadeMaterials();
  if (materials.length === 0) {
    onComplete?.();
    return;
  }

  const fade = { progress: 0 };
  const startValues = materials.map((material) => ({
    material,
    emissiveIntensity: material.isLineMaterial
      ? material.userData.glow?.emissiveIntensity ?? 0
      : material.emissiveIntensity,
  }));

  const applyFade = (t) => {
    const emissiveFactor = 1 - t;

    startValues.forEach(({ material, emissiveIntensity }) => {
      const faded = emissiveIntensity * emissiveFactor;
      if (material.isLineMaterial) {
        applyWireEmissive(material, faded);
      } else {
        material.emissiveIntensity = faded;
        material.emissive.copy(material.color);
      }
    });
  };

  const tl = gsap.timeline({
    onComplete: () => {
      startValues.forEach(({ material }) => {
        if (material.isLineMaterial) {
          applyWireEmissive(material, 0);
        } else {
          material.emissiveIntensity = 0;
          material.emissive.copy(material.color);
        }
      });
      holdTimeline = null;
      onComplete?.();
    },
  });

  tl.to(fade, {
    progress: 1,
    duration,
    ease: 'sine.inOut',
    onUpdate: () => applyFade(fade.progress),
  });

  holdTimeline = tl;
}

function scheduleDissolveWhenReady() {
  if (!recordState && !params.loop) return;

  const startDissolve = () => {
    dissolvePending = false;
    playDissolve();
  };

  if (holdTimeline?.isActive()) {
    dissolvePending = true;
    const existingOnComplete = holdTimeline.eventCallback('onComplete');
    holdTimeline.eventCallback('onComplete', () => {
      existingOnComplete?.();
      if (dissolvePending) {
        startDissolve();
      }
    });
    return;
  }

  startDissolve();
}

function scheduleEmissiveFadeAfterFirstLetter() {
  if (emissiveFadeScheduled || holdTimeline) return;
  emissiveFadeScheduled = true;
  startEmissiveFadeOut(params.holdTime * HOLD_FADE_RATIO);
}

function scheduleIntroTail(fadeDuration) {
  const onTailComplete = () => scheduleDissolveWhenReady();

  if (fadeDuration > 0 && (recordState || params.loop)) {
    startEmissiveFadeOut(fadeDuration, onTailComplete);
  } else if (fadeDuration > 0) {
    startEmissiveFadeOut(fadeDuration);
  } else {
    onTailComplete();
  }
}

function hideAllBehindLayers() {
  triangles.forEach((tri) => hideBehindLayersForTri(tri));
}

function finishWhiteReveal() {
  hideAllBehindLayers();

  if (params.idle) {
    startIdleAnimation();
  }

  if (emissiveFadeScheduled) {
    scheduleDissolveWhenReady();
    return;
  }

  if (!holdTimeline) {
    scheduleIntroTail(params.holdTime * HOLD_FADE_RATIO);
  }
}

function prepareDissolveAllLayers() {
  const coloredEmissive = getColoredEmissiveStrength(params.emissiveStrength);
  triangles.forEach((tri) => {
    // White exits first; orange, wire + dots reappear under it, then exit staggered.
    prepareDissolveLayer('white', tri);
    tri.mesh.visible = false;
    tri.mesh.position.copy(tri.homePosition);
    tri.mesh.scale.copy(tri.homeScale);
    setFaceOpacity(tri.faceMesh.material, 0);
    // Restore the intro glow that the hold fade removed.
    tri.faceMesh.material.emissive.copy(tri.faceMesh.material.color);
    tri.faceMesh.material.emissiveIntensity = coloredEmissive;

    tri.wireMesh.position.copy(tri.wireHomePosition);
    tri.wireMesh.scale.copy(tri.homeScale);
    tri.wireMesh.visible = false;
    setFaceOpacity(tri.wireFaceMesh.material, 0);

    tri.dotMesh.position.copy(tri.dotHomePosition);
    tri.dotMesh.scale.copy(tri.homeScale);
    tri.dotMesh.visible = false;
    tri.dotFaceMeshes.forEach((mesh) => {
      setFaceOpacity(mesh.material, 0);
    });
  });
}

function prepareDissolveLayer(layer, tri = null) {
  const targets = tri ? [tri] : triangles;

  targets.forEach((target) => {
    const animTri = getAnimTriangle(target, layer);
    animTri.mesh.position.copy(animTri.homePosition);
    animTri.mesh.scale.copy(animTri.homeScale);
    if (animTri.dotFaceMeshes?.length) {
      animTri.dotFaceMeshes.forEach((mesh) => {
        setFaceOpacity(mesh.material, 1);
      });
    } else {
      setFaceOpacity(animTri.faceMesh.material, 1);
    }
    animTri.mesh.visible = true;
  });
}

function getStaggerEasing(staggerOrder) {
  if (isDigitalBlinkPattern(params.pattern)) {
    return null;
  }

  const directional =
    staggerOrder === 'left-to-right' || staggerOrder === 'top-to-bottom';

  if (!directional) return null;
  return EASINGS[params.easing] ?? EASINGS.easeOutExpo;
}

function getBuildLayers(layer) {
  if (layer === 'all') return ['white', 'colored', 'wireframe', 'dots'];
  return [layer];
}

function buildRevealTimeline({ reverse = false, layer = 'colored' } = {}) {
  if (triangles.length === 0) return null;

  const useBlinkTweens = shouldUseBlinkTweens(params.pattern, reverse);
  const staggerOrder = getAnimationStaggerOrder(reverse);
  const buildLayers = getBuildLayers(layer);
  const primaryLayer = buildLayers[0];

  const delays = computeStaggerDelays(
    triangles,
    staggerOrder,
    params.staggerSpread,
    params.duration,
    shapeCentroid,
    { staggerEasing: getStaggerEasing(staggerOrder) },
  );

  const startStates = new Map();
  for (const tri of triangles) {
    const animTri = getAnimTriangle(tri, primaryLayer);
    const delay = delays.get(tri) ?? 0;
    startStates.set(
      tri,
      computeStartState(animTri, params.pattern, params, shapeCentroid, delay),
    );
  }

  const ease = EASINGS[params.easing] ?? EASINGS.linear;
  const triDuration = Math.max(0.15, params.duration * (1 - params.staggerSpread * 0.5));

  if (layer !== 'all') {
    for (const tri of triangles) {
      const animTri = getAnimTriangle(tri, layer);
      const start = startStates.get(tri);
      if (reverse) {
        if (!useBlinkTweens) {
          resetToHome(animTri);
        }
      } else if (useBlinkTweens) {
        // Keep hidden until each triangle's blink starts — avoids a 1-frame
        // full-layer flash (especially the raised orange plane).
        applyStateToMesh(animTri, start);
        animTri.mesh.visible = false;
      } else {
        applyStateToMesh(animTri, start);
        animTri.mesh.visible = true;
      }
    }

    if (reverse && useBlinkTweens) {
      prepareDissolveLayer(layer);
    }
  } else if (reverse && useBlinkTweens && layer === 'all') {
    prepareDissolveAllLayers();
  } else if (reverse && useBlinkTweens) {
    buildLayers.forEach((buildLayer) => prepareDissolveLayer(buildLayer));
  }

  const tl = gsap.timeline({
    onComplete: () => {
      if (reverse) {
        if (layer === 'all' || layer === 'white') {
          resetWhiteLayer(triangles);
        }
        if (layer === 'all') {
          hideColoredLayer(triangles);
          resetDotsLayer(triangles);
          resetWireLayer(triangles);
        }

        revealPhase = 'dots';
        wireRevealStarted = false;
        coloredRevealStarted = false;
        whiteRevealStarted = false;
        emissiveFadeScheduled = false;

        if (recordState) {
          handleRecordedLoopComplete();
          return;
        }

        if (!recordState) {
          playReveal();
        }
        return;
      }

      if (layer === 'wireframe') {
        return;
      }

      if (layer === 'dots') {
        return;
      }

      if (layer === 'white') {
        finishWhiteReveal();
      }
    },
  });

  if (useBlinkTweens && reverse && layer === 'all') {
    const dissolveOpts = {
      duration: params.duration,
      staggerSpread: params.staggerSpread,
    };
    const layerRevealEnd = computeRevealEndTime(startStates, triDuration, true);
    const coloredStart = layerRevealEnd * LAYER_START_RATIO;
    const wireStart = coloredStart + layerRevealEnd * LAYER_START_RATIO;
    const dotsStart = wireStart + layerRevealEnd * LAYER_START_RATIO;

    const whiteTargets = triangles.map((tri) => ({
      delay: startStates.get(tri).delay,
      materials: [tri.whiteFaceMesh.material],
      meshes: [tri.whiteMesh],
      sourceTri: tri,
      revealColored: true,
    }));
    const coloredTargets = triangles.map((tri) => ({
      delay: startStates.get(tri).delay,
      materials: [tri.faceMesh.material],
      meshes: [tri.mesh],
    }));
    const dotsTargets = triangles.map((tri) => ({
      delay: startStates.get(tri).delay,
      materials: tri.dotFaceMeshes.map((mesh) => mesh.material),
      meshes: [tri.dotMesh],
    }));
    const wireTargets = triangles.map((tri) => ({
      delay: startStates.get(tri).delay,
      materials: [tri.wireFaceMesh.material],
      meshes: [tri.wireMesh],
    }));

    // Mirror of the intro landing: each part lifts toward the camera from its exit cue
    // and blinks out as the lift ends.
    const lifts = hasLayerLanding();
    const liftTime = lifts ? params.layerLandingTime : 0;
    const blinkShift = Math.max(0, liftTime - getDigitalBlinkDuration());
    const addLifts = (targets, layerName, startOffset) => {
      if (!lifts) return;
      targets.forEach(({ delay }, i) => {
        const animTri = getAnimTriangle(triangles[i], layerName);
        const homeZ = animTri.homePosition.z;
        tl.fromTo(
          animTri.mesh.position,
          { z: homeZ },
          {
            z: homeZ + params.layerTravel,
            duration: liftTime,
            ease: LAYER_LIFT_EASE,
            immediateRender: false,
          },
          startOffset + delay,
        );
      });
    };

    buildDissolveBlinkTweens(tl, whiteTargets, { ...dissolveOpts, startOffset: blinkShift });
    buildDissolveBlinkTweens(tl, coloredTargets, {
      ...dissolveOpts,
      startOffset: coloredStart + blinkShift,
    });
    buildDissolveBlinkTweens(tl, wireTargets, {
      ...dissolveOpts,
      startOffset: wireStart + blinkShift,
    });
    buildDotDissolveTweens(tl, dotsTargets, { ...dissolveOpts, startOffset: dotsStart + liftTime });
    addLifts(whiteTargets, 'white', 0);
    addLifts(coloredTargets, 'colored', coloredStart);
    addLifts(wireTargets, 'wireframe', wireStart);
    addLifts(dotsTargets, 'dots', dotsStart);
  } else if (useBlinkTweens) {
    for (const buildLayer of buildLayers) {
      const blinkTargets = triangles.map((tri) => ({
        tri: getAnimTriangle(tri, buildLayer),
        delay: startStates.get(tri).delay,
        sourceTri: buildLayer === 'white' ? tri : null,
      }));

      if (buildLayer === 'dots') {
        buildDotRevealTweens(tl, blinkTargets);
        continue;
      }

      const emissiveStrength =
        buildLayer === 'white'
          ? 0
          : buildLayer === 'colored'
            ? getColoredEmissiveStrength(params.emissiveStrength)
            : getWireEmissiveStrength(params.emissiveStrength);
      buildDigitalBlinkTweens(tl, blinkTargets, {
        reverse,
        emissiveStrength,
      });
    }
  } else if (layer !== 'all') {
    const landingOwnsZ = !reverse && hasLayerLanding();
    for (const tri of triangles) {
      const animTri = getAnimTriangle(tri, layer);
      const start = startStates.get(tri);
      const toPos = reverse ? start.position : animTri.homePosition;
      const toScale = reverse ? start.scale : animTri.homeScale;
      const delay = start.delay;

      tl.to(
        animTri.mesh.position,
        landingOwnsZ
          ? { x: toPos.x, y: toPos.y, duration: triDuration, ease, delay }
          : { x: toPos.x, y: toPos.y, z: toPos.z, duration: triDuration, ease, delay },
        0,
      );
      tl.to(
        animTri.mesh.scale,
        { x: toScale.x, y: toScale.y, z: toScale.z, duration: triDuration, ease, delay },
        0,
      );
    }
  }

  if (!reverse && layer !== 'all' && hasLayerLanding()) {
    for (const tri of triangles) {
      const animTri = getAnimTriangle(tri, layer);
      const start = startStates.get(tri);
      const homeZ = animTri.homePosition.z;
      const fromZ = (useBlinkTweens ? homeZ : start.position.z) + params.layerTravel;
      tl.fromTo(
        animTri.mesh.position,
        { z: fromZ },
        { z: homeZ, duration: params.layerLandingTime, ease: LAYER_LANDING_EASE },
        start.delay,
      );
    }
  }

  const revealEndTime =
    layer === 'dots' && isDigitalBlinkPattern(params.pattern)
      ? computeRevealEndTime(startStates, triDuration, reverse, 0)
      : computeRevealEndTime(startStates, triDuration, reverse);
  if (!reverse) {
    extendTimelineTo(tl, revealEndTime);
  }

  if (!reverse && layer === 'dots') {
    tl.call(beginWireframeReveal, null, revealEndTime * LAYER_START_RATIO);
  }

  if (!reverse && layer === 'wireframe') {
    tl.call(beginColoredReveal, null, revealEndTime * LAYER_START_RATIO);
  }

  if (!reverse && layer === 'colored') {
    tl.call(beginWhiteReveal, null, revealEndTime * LAYER_START_RATIO);
  }

  if (!reverse && layer === 'white') {
    if (hasLetterTriangles(FIRST_LETTER_INDEX)) {
      const letterPEndTime = computeLetterRevealEndTime(
        FIRST_LETTER_INDEX,
        startStates,
        triDuration,
        reverse,
      );
      tl.call(scheduleEmissiveFadeAfterFirstLetter, null, letterPEndTime);
    }
    whiteRevealTimeline = tl;
  } else {
    if (!reverse) earlierLayerTimelines.push(tl);
    revealTimeline = tl;
  }
  return tl;
}

function syncPlayPauseButton() {
  if (playPauseButton) {
    playPauseButton.textContent = animationPaused ? 'Play' : 'Pause';
  }
}

function setAnimationPaused(paused) {
  animationPaused = !!paused;
  // The stepped recorder owns the global timeline; un-pausing it would mix in real time.
  if (steppedRecording) {
    syncPlayPauseButton();
    return;
  }
  if (animationPaused) {
    gsap.globalTimeline.pause();
  } else {
    gsap.globalTimeline.resume();
  }
  syncPlayPauseButton();
}

function toggleAnimationPause() {
  setAnimationPaused(!animationPaused);
}

function playReveal() {
  setAnimationPaused(false);

  const keepCamera = params.cameraMode === 'free' || params.cameraMode === 'orbit';
  const savedPose = keepCamera ? captureCameraPose() : null;

  stopAnimations();
  resetFinalState();
  hideColoredLayer(triangles);

  if (isCinematicCamera()) {
    startCameraSequence();
  }

  // Re-apply after setup so OrbitControls spherical state can't snap back to a prior front shot.
  if (savedPose) {
    restoreCameraPose(savedPose);
    if (isOrbitCamera()) {
      resetOrbitCameraState();
    }
  }

  revealPhase = 'dots';
  const revealDelay = getRevealStartDelay();
  if (revealDelay > 0) {
    revealDelayCall = gsap.delayedCall(revealDelay, () => {
      revealDelayCall = null;
      buildRevealTimeline({ reverse: false, layer: 'dots' });
    });
  } else {
    buildRevealTimeline({ reverse: false, layer: 'dots' });
  }
  startLogoScaleOut();
  startBloomFade();
}

function playDissolve() {
  stopRevealAnimations();
  if (revealPhase === 'white') {
    buildRevealTimeline({ reverse: true, layer: 'all' });
  }
}

function startIdleAnimation() {
  idleTimeline?.kill();

  const tl = gsap.timeline({ repeat: -1, yoyo: true });
  triangles.forEach((tri, i) => {
    const animTri = getAnimTriangle(
      tri,
      revealPhase === 'white'
        ? 'white'
        : revealPhase === 'colored'
          ? 'colored'
          : revealPhase === 'dots'
            ? 'dots'
            : 'wireframe',
    );
    const offset = i * 0.12;
    tl.to(
      animTri.mesh.position,
      {
        z: animTri.homePosition.z + 0.15 * params.idleIntensity,
        duration: 1.2 + (i % 3) * 0.15,
        ease: 'sine.inOut',
      },
      offset,
    );
    tl.to(
      animTri.mesh.scale,
      {
        x: animTri.homeScale.x * (1 + 0.03 * params.idleIntensity),
        y: animTri.homeScale.y * (1 + 0.03 * params.idleIntensity),
        z: animTri.homeScale.z,
        duration: 1.4 + (i % 2) * 0.1,
        ease: 'sine.inOut',
      },
      offset,
    );
  });

  idleTimeline = tl;
}

function setRecordStatus(message = '', visible = false) {
  recordStatusEl.textContent = message;
  recordStatusEl.classList.toggle('is-visible', visible && message.length > 0);
}

function captureRecordingBootstrapFrame() {
  if (!activeRecorder?.active) return;
  controls.update();
  renderFrame();
  activeRecorder.captureFrame();
}

function beginRecordingClock() {
  gsap.ticker.lagSmoothing(0, 0);
  gsap.ticker.fps(RECORD_FPS);
  recordTickListener = () => {
    if (!activeRecorder?.active) return;
    updateOrbitCamera(1 / RECORD_FPS);
    controls.update();
    renderFrame();
    activeRecorder.captureFrame();
  };
  gsap.ticker.add(recordTickListener);
}

function endRecordingClock() {
  if (steppedRecording) {
    steppedRecording = false;
    gsap.globalTimeline.resume();
  }
  if (recordRenderRestore) {
    const { pixelRatio } = recordRenderRestore;
    recordRenderRestore = null;
    renderer.setPixelRatio(pixelRatio);
    resizeRenderer();
  }
  if (recordTickListener) {
    gsap.ticker.remove(recordTickListener);
    recordTickListener = null;
  }
  gsap.ticker.lagSmoothing(500, 33);
  gsap.ticker.fps(0);
}

async function runSteppedRecording() {
  const dt = 1 / RECORD_FPS;
  let time = gsap.globalTimeline.time();
  let frame = 0;

  try {
    while (steppedRecording && recordState && activeRecorder?.active) {
      updateOrbitCamera(frame === 0 ? 0 : dt);
      controls.update();
      renderFrame();
      await activeRecorder.captureFrame();
      frame += 1;
      if (frame % 10 === 0 && recordState) {
        const loopLabel = `loop ${recordState.completed + 1}/${recordState.loops}`;
        setRecordStatus(`Rendering ProRes 4444… ${loopLabel}, frame ${frame}`, true);
      }

      time += dt;
      gsap.globalTimeline.time(time);
    }
  } catch (error) {
    console.error('ProRes recording failed:', error);
    if (recordState) {
      recordState = null;
      activeRecorder.active = false;
      endRecordingClock();
      activeRecorder = null;
      setUiVisible(uiVisible);
      setRecordStatus('Recording failed', true);
      window.setTimeout(() => setRecordStatus('', false), 2500);
      if (params.loop) playReveal();
    }
  }
}

function finishRecordingSession() {
  const loops = recordState?.loops ?? 1;
  const format = recordState?.format ?? 'mp4';
  const height = recordState?.height;
  recordState = null;
  setRecordStatus(
    format === 'png'
      ? 'Packaging PNG sequence…'
      : format === 'mov'
        ? 'Finalizing ProRes 4444…'
        : 'Encoding video…',
    true,
  );

  Promise.resolve(activeRecorder?.stop())
    .then((blob) => {
      if (!blob) {
        throw new Error('Recording produced no data.');
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      let filename;
      if (format === 'png' || format === 'mov') {
        filename = getRecordingDownloadName(loops, format, stamp, height);
      } else if (blob.type.includes('mp4')) {
        filename = getRecordingDownloadName(loops, 'mp4', stamp);
      } else {
        filename = `polyrig-${loops}loop-${stamp}.webm`;
      }

      downloadBlob(blob, filename);
      setRecordStatus('Recording saved', true);
      window.setTimeout(() => setRecordStatus('', false), 2000);
    })
    .catch((error) => {
      console.error('Recording failed:', error);
      setRecordStatus('Recording failed', true);
      window.setTimeout(() => setRecordStatus('', false), 2500);
    })
    .finally(() => {
      endRecordingClock();
      activeRecorder = null;
      setUiVisible(uiVisible);
      if (params.loop) {
        playReveal();
      }
    });
}

async function startRecording(loops, format = 'mp4', { height = RECORD_HEIGHT } = {}) {
  if (activeRecorder || recordState || triangles.length === 0) return;
  const width = Math.round((height * 16) / 9);

  stopAnimations();
  resetFinalState();

  let recorder;
  let formatLabel = 'MP4';

  try {
    if (format === 'mov') {
      setRecordStatus('Loading ProRes encoder…', true);
      recorder = new CanvasProResRecorder(renderer.domElement, { fps: RECORD_FPS, width, height });
      await recorder.start();
      formatLabel = `${recorder.profileLabel} ${height}p`;
    } else if (format === 'png') {
      recorder = new CanvasPngSequenceRecorder(renderer.domElement);
      recorder.start();
      formatLabel = 'PNG ZIP';
    } else if (isWebCodecsMp4Supported()) {
      recorder = new CanvasMp4Recorder(renderer.domElement, { fps: RECORD_FPS });
      recorder.start();
    } else {
      const mimeType = pickMediaRecorderMimeType();
      if (!mimeType) {
        throw new Error('Video recording is not supported in this browser.');
      }
      recorder = new CanvasMediaRecorder(renderer.domElement, { fps: RECORD_FPS, mimeType });
      recorder.start();
      formatLabel = mimeType.includes('mp4') ? 'MP4' : 'WebM';
    }
  } catch (error) {
    console.error(error);
    setRecordStatus('Recording not supported', true);
    window.setTimeout(() => setRecordStatus('', false), 2500);
    return;
  }

  activeRecorder = recorder;
  recordState = { loops, completed: 0, format, height };
  setAnimationPaused(false);
  setUiVisible(false);
  setRecordStatus(`Recording ${loops} loop${loops > 1 ? 's' : ''} (${formatLabel})…`, true);

  if (format === 'mov') {
    recordRenderRestore = { pixelRatio: renderer.getPixelRatio() };
    renderer.setPixelRatio(1);
    applyRenderSize(width, height, false);
    steppedRecording = true;
    gsap.globalTimeline.pause();
    playReveal();
    runSteppedRecording();
    return;
  }

  beginRecordingClock();
  playReveal();
  captureRecordingBootstrapFrame();
}

function handleRecordedLoopComplete() {
  if (!recordState) return;

  recordState.completed += 1;

  if (recordState.completed >= recordState.loops) {
    // Keep capturing the cleared scene briefly so the last frames are empty and the file loops cleanly.
    gsap.delayedCall(RECORD_END_PADDING_SEC, () => {
      if (recordState) finishRecordingSession();
    });
    return;
  }

  resetFinalState();
  playReveal();
}

function resetCamera() {
  frameCameraToLogo();
  if (isOrbitCamera()) {
    resetOrbitCameraState();
  }
}

function resetCameraToFront() {
  clearCameraSequence();
  applyCameraState(MAIN_CAMERA, 'main');
}

function resetAllSettings() {
  Object.assign(params, DEFAULT_PARAMS);
  Object.assign(params.aberration, defaultAberration);

  idleTimeline?.kill();
  idleTimeline = null;

  scene.background = new THREE.Color(params.background);
  syncPostProcessingOutputs();
  updateAberrationPass();
  syncOrbitControlsForCameraMode();
  updateCameraPaneState();
  setUiVisible(true);

  applyCurrentLayerAppearance();

  pane?.refresh();
  playReveal();
}

function roundValue(value, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function vec3ToArray(vector, decimals = 3) {
  return [
    roundValue(vector.x, decimals),
    roundValue(vector.y, decimals),
    roundValue(vector.z, decimals),
  ];
}

function collectSettingsSnapshot() {
  controls.update();

  return {
    app: 'polyrig',
    capturedAt: new Date().toISOString(),
    params: { ...params },
    camera: {
      position: vec3ToArray(camera.position),
      fov: roundValue(camera.fov, 2),
      near: camera.near,
      far: camera.far,
      aspect: roundValue(camera.aspect, 4),
    },
    orbitControls: {
      target: vec3ToArray(controls.target),
      enabled: controls.enabled,
    },
    cameraSequence: {
      mode: params.cameraMode,
      active: activeCameraState,
      main: MAIN_CAMERA,
      zoomOutRatio: params.cinematicZoomOut,
    },
    logo: {
      scale: roundValue(logoHolder.scale.x, 4),
      centroid: vec3ToArray(shapeCentroid),
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
  };
}

async function copySettings() {
  const text = JSON.stringify(collectSettingsSnapshot(), null, 2);

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

function mountUiLegend(uiOpen = false) {
  const el = document.getElementById('ui-legend');
  if (!el) return;
  if (uiOpen) {
    el.hidden = true;
    return;
  }
  window.setTimeout(() => {
    el.classList.add('is-faded');
  }, 3000);
}

function usesPostProcessing() {
  return params.bloom || isChromaticAberrationActive(params.aberration) || params.fxaa;
}

function syncPostProcessingOutputs() {
  const bloomOn = params.bloom;
  const aberOn = isChromaticAberrationActive(params.aberration);
  const fxaaOn = !!params.fxaa;

  bloomPass.enabled = bloomOn;
  fxaaPass.enabled = fxaaOn;

  // Last enabled effect owns the screen; earlier passes feed the chain.
  bloomPass.renderToScreen = bloomOn && !aberOn && !fxaaOn;
  aberrationPass.renderToScreen = aberOn && !fxaaOn;
  fxaaPass.renderToScreen = fxaaOn;
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
  refreshVertexDotSizes();
}

function applyWireframeLineWidths() {
  updateWireframeLineWidths(triangles, params.wireframeLineWidth * lineWidthScale);
}

function resizeRenderer() {
  if (recordRenderRestore) return;
  applyRenderSize(window.innerWidth, window.innerHeight, true);
}

async function exportPngStill(scale = 1) {
  if (triangles.length === 0 || activeRecorder) return;

  const exportWidth = Math.max(1, Math.round(window.innerWidth * scale));
  const exportHeight = Math.max(1, Math.round(window.innerHeight * scale));
  const prevPixelRatio = renderer.getPixelRatio();

  setRecordStatus(`Exporting PNG ${scale}×…`, true);

  try {
    renderer.setPixelRatio(1);
    applyRenderSize(exportWidth, exportHeight, false);
    renderFrame();

    const dataUrl = renderer.domElement.toDataURL('image/png');
    const blob = await (await fetch(dataUrl)).blob();
    if (!blob || blob.size === 0) {
      throw new Error('PNG export produced an empty image.');
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob(blob, `polyrig-still-${scale}x-${stamp}.png`);
    setRecordStatus('PNG saved', true);
    window.setTimeout(() => setRecordStatus('', false), 2000);
  } catch (error) {
    console.error('PNG export failed:', error);
    setRecordStatus('PNG export failed', true);
    window.setTimeout(() => setRecordStatus('', false), 2500);
  } finally {
    renderer.setPixelRatio(prevPixelRatio);
    resizeRenderer();
    renderFrame();
  }
}

function renderFrame() {
  if (triangles.length > 0) {
    refreshVertexDotSizes();
  }

  if (usesPostProcessing()) {
    updateAberrationPass();
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

function setupControls() {
  if (params.cameraMode === 'main') {
    params.cameraMode = 'free';
  }

  pane = new Pane();
  mountPaneBrandHeader();
  mountPaneFooter();
  const uiOpen = consumeUiOpenFlag();
  setUiVisible(uiOpen);
  mountUiLegend(uiOpen);

  const logoFolder = pane.addFolder({ title: 'Animation', expanded: true });
  logoFolder
    .addBinding(params, 'pattern', { label: 'Pattern', options: patternOptions() })
    .on('change', () => playReveal());

  logoFolder
    .addBinding(params, 'staggerOrder', {
      label: 'Stagger order',
      options: {
        'Distance from center': 'distance-from-center',
        'Left to right': 'left-to-right',
        'Top to bottom': 'top-to-bottom',
        Random: 'random',
        'Color group': 'color-group',
        'Letter sequence (P→O→L→Y)': 'letter-sequence',
      },
    })
    .on('change', () => playReveal());

  logoFolder.addBinding(params, 'duration', { label: 'Duration', min: 0.3, max: 6, step: 0.1 });
  logoFolder.addBinding(params, 'staggerSpread', {
    label: 'Stagger spread',
    min: 0,
    max: 1,
    step: 0.05,
  });
  logoFolder
    .addBinding(params, 'easing', { label: 'Logo easing', options: easingOptions() })
    .on('change', () => playReveal());

  logoFolder.addBinding(params, 'loop', { label: 'Loop' });
  logoFolder.addBinding(params, 'holdTime', { label: 'Hold time', min: 0, max: 10, step: 0.1 });
  logoFolder.addBinding(params, 'finalizeHold', {
    label: 'Finalize hold',
    min: 0,
    max: 3,
    step: 0.1,
  });
  logoFolder
    .addBinding(params, 'idle', { label: 'Idle' })
    .on('change', (ev) => {
      if (ev.value) {
        startIdleAnimation();
      } else {
        idleTimeline?.kill();
        idleTimeline = null;
        triangles.forEach(resetToHome);
      }
    });
  logoFolder
    .addBinding(params, 'idleIntensity', { label: 'Idle intensity', min: 0, max: 1, step: 0.05 })
    .on('change', () => {
      if (params.idle) startIdleAnimation();
    });

  const cameraFolder = pane.addFolder({ title: 'Camera', expanded: true });
  cameraModeBinding = cameraFolder
    .addBinding(params, 'cameraMode', {
      label: 'Mode',
      options: {
        'Free (review)': 'free',
        Orbit: 'orbit',
        'Cinematic Zoom': 'cinematic',
        'Cinematic Rotate': 'cinematic-rotate',
      },
    })
    .on('change', () => applyCameraModeChange());

  orbitSpeedBinding = cameraFolder.addBinding(params, 'orbitSpeed', {
    label: 'Orbit speed',
    min: 0,
    max: 5,
    step: 0.05,
  });
  cinematicDistanceBinding = cameraFolder
    .addBinding(params, 'cinematicDistance', {
      label: 'Distance',
      min: CINEMATIC_DISTANCE_MIN,
      max: CINEMATIC_DISTANCE_MAX,
      step: 0.01,
    })
    .on('change', (ev) => setCinematicDistance(ev.value));
  cinematicZoomOutBinding = cameraFolder
    .addBinding(params, 'cinematicZoomOut', {
      label: 'Zoom amount',
      min: 0,
      max: 2,
      step: 0.01,
    })
    .on('change', () => playReveal());
  cinematicRevealDelayBinding = cameraFolder
    .addBinding(params, 'cinematicRevealDelay', {
      label: 'Reveal delay',
      min: 0,
      max: 5,
      step: 0.05,
    })
    .on('change', () => playReveal());
  rotateAngleBinding = cameraFolder
    .addBinding(params, 'cinematicRotateAngle', {
      label: 'Rotate angle',
      min: -90,
      max: 90,
      step: 1,
    })
    .on('change', () => playReveal());
  cameraEasingBinding = cameraFolder
    .addBinding(params, 'cameraEasing', { label: 'Camera easing', options: easingOptions() })
    .on('change', () => playReveal());
  cameraFolder
    .addBinding(params, 'orbitControls', { label: 'Orbit controls' })
    .on('change', () => {
      syncOrbitControlsForCameraMode();
    });
  cameraFolder.addBlade({ view: 'separator' });
  cameraFolder.addButton({ title: 'Reset camera' }).on('click', () => resetCamera());
  cameraFolder.addButton({ title: 'Front view' }).on('click', () => resetCameraToFront());
  updateCameraPaneState();

  const layersFolder = pane.addFolder({ title: 'Layers', expanded: true });
  layersFolder
    .addBinding(params, 'logoDepth', {
      label: 'Logo depth',
      min: 0,
      max: 0.5,
      step: 0.001,
    })
    .on('change', () => applyLogoDepth());
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
  layersFolder.addBinding(params, 'layerTravel', {
    label: 'Layer travel',
    min: 0,
    max: 6,
    step: 0.05,
  });
  layersFolder.addBinding(params, 'layerLandingTime', {
    label: 'Layer landing',
    min: 0,
    max: 5,
    step: 0.05,
  });
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
    .on('change', (ev) => {
      scene.background = new THREE.Color(ev.value);
    });

  lookFolder
    .addBinding(params, 'emissiveStrength', { label: 'Emissive', min: 0, max: 3, step: 0.05 })
    .on('change', () => {
      applyEmissiveStrength(triangles, params.emissiveStrength, getLayerColorOptions());
    });

  lookFolder.addBinding(params, 'bloom', { label: 'Unreal bloom' }).on('change', () => {
    syncPostProcessingOutputs();
    if (params.bloom) resetBloomFade();
  });
  lookFolder
    .addBinding(params, 'bloomIntensity', {
      label: 'Bloom intensity',
      min: 0,
      max: 3,
      step: 0.05,
    })
    .on('change', () => {
      if (!params.bloom) return;
      if (!bloomFadeTimeline?.isActive()) {
        bloomPass.strength = params.bloomIntensity;
      }
    });
  lookFolder.addBinding(params, 'fxaa', { label: 'FXAA' }).on('change', () => {
    syncPostProcessingOutputs();
  });

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

  const sourceFolder = pane.addFolder({ title: 'Source', expanded: false });
  sourceFolder.addButton({ title: 'Load SVG file' }).on('click', () => {
    document.getElementById('file-input').click();
  });
  sourceFolder.addButton({ title: 'Restore default logo' }).on('click', () => loadSvg(DEFAULT_SVG));

  const exportFolder = pane.addFolder({ title: 'Export', expanded: true });
  exportFolder.addBinding(exportOptions, 'stillScale', {
    label: 'Still scale',
    options: { '1×': 1, '2×': 2 },
  });
  exportFolder
    .addButton({ title: 'Export PNG still' })
    .on('click', () => exportPngStill(exportOptions.stillScale));
  exportFolder.addBlade({ view: 'separator' });
  exportFolder.addBinding(exportOptions, 'format', {
    label: 'Video format',
    options: {
      MP4: 'mp4',
      'PNG sequence (ZIP)': 'png',
      'ProRes 4444 · 1080p': 'mov-1080',
      'ProRes 4444 · 2160p': 'mov-2160',
    },
  });
  exportFolder.addBinding(exportOptions, 'loops', {
    label: 'Length',
    options: { '1 loop': 1, '2 loops': 2 },
  });
  markPrimary(exportFolder.addButton({ title: 'Record' }).on('click', () => recordExport()));
}

const exportOptions = { stillScale: 1, format: 'mp4', loops: 1 };

function recordExport() {
  const { format, loops } = exportOptions;
  if (format.startsWith('mov-')) {
    return startRecording(loops, 'mov', { height: Number(format.slice(4)) });
  }
  return startRecording(loops, format);
}

function patternOptions() {
  const labels = {
    'explode-in': 'Explode in',
    cascade: 'Cascade / wipe',
    'depth-pull': 'Depth pull',
    'shatter-reverse': 'Shatter reverse',
    'random-pop': 'Random pop',
    spiral: 'Spiral',
    'digital-blink': 'Digital blink',
  };
  return Object.fromEntries(PATTERN_NAMES.map((name) => [labels[name] ?? name, name]));
}

function easingOptions() {
  return {
    'Ease out back': 'easeOutBack',
    'Ease out sine': 'easeOutSine',
    'Ease out cubic': 'easeOutCubic',
    'Ease out quart': 'easeOutQuart',
    'Ease out quint': 'easeOutQuint',
    'Ease out expo': 'easeOutExpo',
    'Ease in-out sine': 'easeInOutSine',
    'Ease in-out quad': 'easeInOutQuad',
    'Ease in-out cubic': 'easeInOutCubic',
    'Ease in-out quart': 'easeInOutQuart',
    'Ease in-out quint': 'easeInOutQuint',
    'Ease in-out expo': 'easeInOutExpo',
    'Ease in-out circ': 'easeInOutCirc',
    'Ease in-out back': 'easeInOutBack',
    Linear: 'linear',
  };
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

renderer.domElement.addEventListener(
  'wheel',
  (event) => {
    if (isCinematicCamera()) {
      event.preventDefault();
      zoomCinematicCamera(event.deltaY);
      return;
    }
    if (!isOrbitCamera()) return;
    event.preventDefault();
    zoomOrbitCamera(event.deltaY);
    updateOrbitCamera(0);
  },
  { passive: false },
);

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    return;
  }

  const key = event.key.toLowerCase();
  if (key === 'h') {
    event.preventDefault();
    toggleUi();
    return;
  }

  if (key === ' ' || key === 'spacebar') {
    event.preventDefault();
    toggleAnimationPause();
  }
});

function animate() {
  requestAnimationFrame(animate);

  if (activeRecorder?.active) {
    return;
  }

  const delta = Math.min(cameraClock.getDelta(), 0.05);
  if (!animationPaused) {
    updateOrbitCamera(delta);
  } else if (isOrbitCamera()) {
    // Keep zoomed radius applied while paused.
    updateOrbitCamera(0);
  }
  controls.update();
  renderFrame();
}

setupControls();
loadSvg(DEFAULT_SVG);
animate();
