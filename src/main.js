import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import gsap from 'gsap';
import { Pane } from 'tweakpane';
import defaultSvg from '../poly3.svg?raw';
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
  updateWireframeLineResolutions,
  updateVertexDotSizes,
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
  DISSOLVE_DURATION_SCALE,
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
} from './recorder.js';
import {
  AberrationShader,
  applyChromaticAberrationToPass,
  isChromaticAberrationActive,
  defaultAberration,
  ABERRATION_FALLOFF_MIN,
  ABERRATION_FALLOFF_MAX,
} from './chromaticAberration.js';

// Swap SVG source here, or use the file picker in the control panel.
const DEFAULT_SVG = defaultSvg;

const EASINGS = {
  easeOutBack: 'back.out(1.4)',
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

const params = {
  pattern: 'digital-blink',
  staggerOrder: 'left-to-right',
  duration: 2,
  staggerSpread: 0.9,
  easing: 'linear',
  loop: true,
  holdTime: 2,
  idle: false,
  idleIntensity: 0.35,
  colorMode: 'original',
  overrideColor: '#ff8ee3',
  orbitControls: true,
  background: '#000000',
  emissiveStrength: 1,
  bloom: true,
  aberration: { ...defaultAberration },
  cameraSequence: true,
  camera1Duration: 2,
  finalizeHold: 0.5,
  finalizeDuration: 0.9,
};

const DEFAULT_FRONT_CAMERA_DISTANCE = 9.115;
const INTRO_ZOOM_OUT_RATIO = 0.1;

const INTRO_CAMERA = {
  position: [0, 0, 1.678],
  target: [0, 0, 0],
  fov: 35,
};

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
const BLOOM_STRENGTH = 0.65;
const BLOOM_THRESHOLD = 0.82;
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  BLOOM_STRENGTH,
  0.4,
  BLOOM_THRESHOLD,
);
composer.addPass(bloomPass);
const aberrationPass = new ShaderPass(AberrationShader);
aberrationPass.uniforms.aspectRatio.value =
  window.innerHeight > 0 ? window.innerWidth / window.innerHeight : 1;
composer.addPass(aberrationPass);
bloomPass.renderToScreen = false;
syncPostProcessingOutputs();
applyChromaticAberrationToPass(aberrationPass, params.aberration);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enabled = params.orbitControls;

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
let revealTimeline = null;
let whiteRevealTimeline = null;
let whiteRevealStarted = false;
let emissiveFadeScheduled = false;
let idleTimeline = null;
let pane = null;
let uiVisible = true;
let finalizeTimeline = null;
let holdTimeline = null;
let logoScaleTimeline = null;
let revealPhase = 'dots';
let wireRevealStarted = false;
let coloredRevealStarted = false;
let activeRecorder = null;
let recordState = null;
let recordTickListener = null;
const LAYER_START_RATIO = 1 / 3;
const FIRST_LETTER_INDEX = 0;
const LOGO_SCALE_END = 0.8;
const recordStatusEl = document.getElementById('record-status');

const defaultCameraPosition = camera.position.clone();

let cameraCutCall = null;
let introCameraTimeline = null;
let activeCameraState = 'main';
const _introCameraStart = new THREE.Vector3();
const _introCameraEnd = new THREE.Vector3();

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
  introCameraTimeline?.kill();
  introCameraTimeline = null;
  cameraCutCall?.kill();
  cameraCutCall = null;
}

function startMainCameraTransition() {
  introCameraTimeline?.kill();
  introCameraTimeline = null;
  cameraCutCall?.kill();
  cameraCutCall = null;

  const startPos = camera.position.clone();
  const startFov = camera.fov;
  const endPos = _introCameraEnd.set(
    MAIN_CAMERA.position[0],
    MAIN_CAMERA.position[1],
    MAIN_CAMERA.position[2],
  );
  const target = controls.target.clone();
  const duration = Math.max(
    0.001,
    computeFullAnimationDuration() - params.camera1Duration,
  );
  const motion = { t: 0 };

  activeCameraState = 'main';

  introCameraTimeline = gsap.to(motion, {
    t: 1,
    duration,
    ease: 'none',
    onUpdate: () => {
      camera.position.lerpVectors(startPos, endPos, motion.t);
      camera.fov = THREE.MathUtils.lerp(startFov, MAIN_CAMERA.fov, motion.t);
      camera.updateProjectionMatrix();
      camera.lookAt(target);
      controls.update();
    },
    onComplete: () => {
      applyCameraState(MAIN_CAMERA, 'main');
      introCameraTimeline = null;
    },
  });
}

function startCameraSequence() {
  clearCameraSequence();

  if (!params.cameraSequence) {
    applyCameraState(MAIN_CAMERA, 'main');
    return;
  }

  applyCameraState(INTRO_CAMERA, 'intro');

  const target = controls.target.clone();
  const startOffset = camera.position.clone().sub(target);
  const endOffset = startOffset.clone().multiplyScalar(1 + INTRO_ZOOM_OUT_RATIO);
  const motion = { t: 0 };

  introCameraTimeline = gsap.to(motion, {
    t: 1,
    duration: params.camera1Duration,
    ease: 'power2.inOut',
    onUpdate: () => {
      _introCameraStart.copy(target).add(startOffset);
      _introCameraEnd.copy(target).add(endOffset);
      camera.position.lerpVectors(_introCameraStart, _introCameraEnd, motion.t);
      camera.lookAt(target);
      controls.update();
    },
  });

  cameraCutCall = gsap.delayedCall(params.camera1Duration, startMainCameraTransition);
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
}

function frameCameraToLogo() {
  if (triangles.length === 0) return;

  const box = new THREE.Box3();
  for (const tri of triangles) {
    box.expandByPoint(tri.centroid);
  }

  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, 1);
  const fov = (camera.fov * Math.PI) / 180;
  const distance = (maxDim / 2 / Math.tan(fov / 2)) * 1.4;

  camera.position.set(0, 0, distance);
  camera.lookAt(0, 0, 0);
  defaultCameraPosition.copy(camera.position);
  controls.target.set(0, 0, 0);
  controls.update();
}

function resetFinalState() {
  finalizeTimeline?.kill();
  finalizeTimeline = null;
  revealPhase = 'dots';
  wireRevealStarted = false;
  coloredRevealStarted = false;
  whiteRevealStarted = false;
  emissiveFadeScheduled = false;
  resetChipVisibility(triangles);
  resetWireLayer(triangles);
  resetDotsLayer(triangles);
  resetWhiteLayer(triangles);
  applyColorMode(triangles, params.colorMode, { overrideColor: params.overrideColor });
  applyEmissiveStrength(triangles, params.emissiveStrength);
  if (params.bloom) {
    bloomPass.strength = BLOOM_STRENGTH;
    bloomPass.threshold = BLOOM_THRESHOLD;
  }
  resetLogoScale();
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
    triangles = parsed;
    shapeCentroid = getShapeCentroid(triangles);
    applyColorMode(triangles, params.colorMode, { overrideColor: params.overrideColor });
    applyEmissiveStrength(triangles, params.emissiveStrength);
    updateWireframeLineResolutions(triangles, window.innerWidth, window.innerHeight);
    updateVertexDotSizes(triangles, camera, window.innerWidth, window.innerHeight);

    playReveal();
  } catch (error) {
    console.error('Failed to load SVG:', error);
  }
}

function stopAnimations() {
  revealTimeline?.kill();
  revealTimeline = null;
  whiteRevealTimeline?.kill();
  whiteRevealTimeline = null;
  finalizeTimeline?.kill();
  finalizeTimeline = null;
  idleTimeline?.kill();
  idleTimeline = null;
  holdTimeline?.kill();
  holdTimeline = null;
  emissiveFadeScheduled = false;
  logoScaleTimeline?.kill();
  logoScaleTimeline = null;
  clearCameraSequence();
}

function getAnimationStaggerOrder(reverse) {
  if (isDigitalBlinkPattern(params.pattern) || reverse) {
    return 'left-to-right';
  }
  return params.staggerOrder;
}

function computeRevealEndTime(startStates, triDuration, reverse = false) {
  let maxEnd = 0;
  const blinkDuration = getDigitalBlinkDuration(params.duration, {
    triangleCount: startStates.size,
    staggerSpread: params.staggerSpread,
  });
  const useBlink = shouldUseBlinkTweens(params.pattern, reverse);

  for (const [, start] of startStates) {
    const end = useBlink ? start.delay + blinkDuration : start.delay + triDuration;
    maxEnd = Math.max(maxEnd, end);
  }

  return maxEnd;
}

function computeLetterRevealEndTime(letterIndex, startStates, triDuration, reverse = false) {
  const blinkDuration = getDigitalBlinkDuration(params.duration, {
    triangleCount: startStates.size,
    staggerSpread: params.staggerSpread,
  });
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

function computeLayerTiming() {
  const triDuration = Math.max(0.15, params.duration * (1 - params.staggerSpread * 0.5));
  const dotsRevealEndTime = computeRevealEndTime(
    getRevealStartStates(false, 'dots'),
    triDuration,
    false,
  );
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
  const whiteRevealEndTime = computeRevealEndTime(
    getRevealStartStates(false, 'white'),
    triDuration,
    false,
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
  const holdFadeDuration = params.holdTime * DISSOLVE_DURATION_SCALE;

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
  const layerRevealEnd =
    computeRevealEndTime(startStates, triDuration, true) * DISSOLVE_DURATION_SCALE;
  const coloredStart = layerRevealEnd * LAYER_START_RATIO;
  const wireStart = coloredStart + layerRevealEnd * LAYER_START_RATIO;
  const dotsStart = wireStart + layerRevealEnd * LAYER_START_RATIO;
  const dissolveBlinkDuration = getDigitalBlinkDuration(params.duration * DISSOLVE_DURATION_SCALE, {
    triangleCount: triangles.length,
    staggerSpread: params.staggerSpread,
  });

  let maxEnd = dotsStart;
  for (const [, start] of startStates) {
    maxEnd = Math.max(
      maxEnd,
      dotsStart + start.delay * DISSOLVE_DURATION_SCALE + dissolveBlinkDuration,
    );
  }

  return maxEnd;
}

function computeFullAnimationDuration() {
  if (triangles.length === 0) return 0;

  const { whiteStartOffset, whiteLetterPEndTime, holdFadeDuration } = computeLayerTiming();
  const emissiveFadeEnd = whiteStartOffset + whiteLetterPEndTime + holdFadeDuration;

  if (params.loop) {
    return emissiveFadeEnd + computeDissolveDuration();
  }

  return emissiveFadeEnd;
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

function resetLogoScale() {
  logoScaleTimeline?.kill();
  logoScaleTimeline = null;
  logoHolder.scale.set(1, 1, 1);
}

function startLogoScaleOut() {
  resetLogoScale();

  const fullDuration = computeFullAnimationDuration();
  if (fullDuration <= 0) return;

  const camera2Delay = params.cameraSequence ? params.camera1Duration : 0;
  const scaleDuration = Math.max(0.001, fullDuration - camera2Delay);

  logoScaleTimeline = gsap.timeline();
  if (camera2Delay > 0) {
    logoScaleTimeline.to({}, { duration: camera2Delay });
  }
  logoScaleTimeline.to(logoHolder.scale, {
    x: LOGO_SCALE_END,
    y: LOGO_SCALE_END,
    z: LOGO_SCALE_END,
    duration: scaleDuration,
    ease: 'none',
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
  const materials = [];
  triangles.forEach((tri) => {
    materials.push(tri.wireFaceMesh.material);
    materials.push(tri.faceMesh.material);
  });
  return materials;
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

    if (params.bloom) {
      bloomPass.strength = BLOOM_STRENGTH * emissiveFactor;
      bloomPass.threshold = BLOOM_THRESHOLD * emissiveFactor;
    }
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
      if (params.bloom) {
        bloomPass.strength = 0;
        bloomPass.threshold = 0;
      }
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

function scheduleEmissiveFadeAfterFirstLetter() {
  if (emissiveFadeScheduled || holdTimeline) return;
  emissiveFadeScheduled = true;
  scheduleIntroTail(params.holdTime * DISSOLVE_DURATION_SCALE);
}

function scheduleIntroTail(fadeDuration) {
  const onTailComplete = () => {
    if (recordState || params.loop) {
      playDissolve();
    }
  };

  if (fadeDuration > 0 && (recordState || params.loop)) {
    startEmissiveFadeOut(fadeDuration, onTailComplete);
  } else if (fadeDuration > 0) {
    startEmissiveFadeOut(fadeDuration);
  } else {
    onTailComplete();
  }
}

function finishWhiteReveal() {
  if (params.idle) {
    startIdleAnimation();
  }

  if (!emissiveFadeScheduled && !holdTimeline) {
    scheduleIntroTail(params.holdTime * DISSOLVE_DURATION_SCALE);
  }
}

function prepareDissolveAllLayers() {
  triangles.forEach((tri) => {
    for (const layer of ['white', 'colored', 'wireframe', 'dots']) {
      prepareDissolveLayer(layer, tri);
    }
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
        mesh.material.opacity = 1;
      });
    } else {
      animTri.faceMesh.material.opacity = 1;
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
    const layerRevealEnd =
      computeRevealEndTime(startStates, triDuration, true) * DISSOLVE_DURATION_SCALE;
    const coloredStart = layerRevealEnd * LAYER_START_RATIO;
    const wireStart = coloredStart + layerRevealEnd * LAYER_START_RATIO;
    const dotsStart = wireStart + layerRevealEnd * LAYER_START_RATIO;

    const whiteTargets = triangles.map((tri) => ({
      delay: startStates.get(tri).delay,
      materials: [tri.whiteFaceMesh.material],
      meshes: [tri.whiteMesh],
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

    buildDissolveBlinkTweens(tl, whiteTargets, dissolveOpts);
    buildDissolveBlinkTweens(tl, coloredTargets, { ...dissolveOpts, startOffset: coloredStart });
    buildDissolveBlinkTweens(tl, wireTargets, { ...dissolveOpts, startOffset: wireStart });
    buildDissolveBlinkTweens(tl, dotsTargets, { ...dissolveOpts, startOffset: dotsStart });
  } else if (useBlinkTweens) {
    for (const buildLayer of buildLayers) {
      const emissiveStrength =
        buildLayer === 'white' || buildLayer === 'dots'
          ? 0
          : buildLayer === 'colored'
            ? getColoredEmissiveStrength(params.emissiveStrength)
            : getWireEmissiveStrength(params.emissiveStrength);
      const blinkTargets = triangles.map((tri) => ({
        tri: getAnimTriangle(tri, buildLayer),
        delay: startStates.get(tri).delay,
      }));
      buildDigitalBlinkTweens(tl, blinkTargets, {
        reverse,
        emissiveStrength,
        duration: params.duration,
        staggerSpread: params.staggerSpread,
      });
    }
  } else if (layer !== 'all') {
    for (const tri of triangles) {
      const animTri = getAnimTriangle(tri, layer);
      const start = startStates.get(tri);
      const toPos = reverse ? start.position : animTri.homePosition;
      const toScale = reverse ? start.scale : animTri.homeScale;
      const delay = start.delay;

      tl.to(
        animTri.mesh.position,
        { x: toPos.x, y: toPos.y, z: toPos.z, duration: triDuration, ease, delay },
        0,
      );
      tl.to(
        animTri.mesh.scale,
        { x: toScale.x, y: toScale.y, z: toScale.z, duration: triDuration, ease, delay },
        0,
      );
    }
  }

  const revealEndTime = computeRevealEndTime(startStates, triDuration, reverse);
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
    revealTimeline = tl;
  }
  return tl;
}

function playReveal() {
  stopAnimations();
  resetFinalState();
  hideColoredLayer(triangles);
  startCameraSequence();
  revealPhase = 'dots';
  buildRevealTimeline({ reverse: false, layer: 'dots' });
  startLogoScaleOut();
}

function playDissolve() {
  stopAnimations();
  if (params.bloom) {
    bloomPass.strength = BLOOM_STRENGTH * 0.15;
    bloomPass.threshold = BLOOM_THRESHOLD * 0.15;
  }
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
    controls.update();
    renderFrame();
    activeRecorder.captureFrame();
  };
  gsap.ticker.add(recordTickListener);
}

function endRecordingClock() {
  if (recordTickListener) {
    gsap.ticker.remove(recordTickListener);
    recordTickListener = null;
  }
  gsap.ticker.lagSmoothing(500, 33);
  gsap.ticker.fps(0);
}

function finishRecordingSession() {
  const loops = recordState?.loops ?? 1;
  const format = recordState?.format ?? 'mp4';
  recordState = null;
  setRecordStatus(format === 'png' ? 'Packaging PNG sequence…' : 'Encoding video…', true);

  Promise.resolve(activeRecorder?.stop())
    .then((blob) => {
      if (!blob) {
        throw new Error('Recording produced no data.');
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      let filename;
      if (format === 'png') {
        filename = getRecordingDownloadName(loops, 'png', stamp);
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

async function startRecording(loops, format = 'mp4') {
  if (activeRecorder || recordState || triangles.length === 0) return;

  stopAnimations();
  resetFinalState();

  let recorder;
  let formatLabel = 'MP4';

  try {
    if (format === 'png') {
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
  recordState = { loops, completed: 0, format };
  beginRecordingClock();
  setUiVisible(false);
  setRecordStatus(`Recording ${loops} loop${loops > 1 ? 's' : ''} (${formatLabel})…`, true);
  playReveal();
  captureRecordingBootstrapFrame();
}

function handleRecordedLoopComplete() {
  if (!recordState) return;

  recordState.completed += 1;

  if (recordState.completed >= recordState.loops) {
    finishRecordingSession();
    return;
  }

  resetFinalState();
  playReveal();
}

function resetCamera() {
  frameCameraToLogo();
}

function resetCameraToFront() {
  clearCameraSequence();
  applyCameraState(MAIN_CAMERA, 'main');
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
      enabled: params.cameraSequence,
      active: activeCameraState,
      introDuration: params.camera1Duration,
      intro: INTRO_CAMERA,
      main: MAIN_CAMERA,
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
  if (pane?.element) {
    pane.element.style.display = visible ? '' : 'none';
  }
}

function toggleUi() {
  setUiVisible(!uiVisible);
}

function usesPostProcessing() {
  return params.bloom || isChromaticAberrationActive(params.aberration);
}

function syncPostProcessingOutputs() {
  const bloomOn = params.bloom;
  const aberOn = isChromaticAberrationActive(params.aberration);
  bloomPass.enabled = bloomOn;
  bloomPass.renderToScreen = bloomOn && !aberOn;
  aberrationPass.renderToScreen = aberOn;
}

function updateAberrationPass() {
  applyChromaticAberrationToPass(aberrationPass, params.aberration);
  syncPostProcessingOutputs();
}

function resizeRenderer() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  composer.setSize(width, height);
  bloomPass.resolution.set(width, height);
  aberrationPass.uniforms.aspectRatio.value = height > 0 ? width / height : 1;
  updateWireframeLineResolutions(triangles, width, height);
  updateVertexDotSizes(triangles, camera, width, height);
}

function renderFrame() {
  if (triangles.length > 0) {
    updateVertexDotSizes(triangles, camera, window.innerWidth, window.innerHeight);
  }

  if (usesPostProcessing()) {
    updateAberrationPass();
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

function setupControls() {
  pane = new Pane({ title: 'Polyrig' });

  pane
    .addBinding(params, 'pattern', { options: patternOptions() })
    .on('change', () => playReveal());

  pane
    .addBinding(params, 'staggerOrder', {
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

  pane.addBinding(params, 'duration', { min: 0.3, max: 6, step: 0.1 });
  pane.addBinding(params, 'staggerSpread', { min: 0, max: 1, step: 0.05 });
  pane
    .addBinding(params, 'easing', { label: 'Reveal easing', options: easingOptions() })
    .on('change', () => playReveal());

  pane.addBinding(params, 'loop');
  pane.addBinding(params, 'holdTime', { min: 0, max: 5, step: 0.1 });
  pane
    .addBinding(params, 'idle')
    .on('change', (ev) => {
      if (ev.value) {
        startIdleAnimation();
      } else {
        idleTimeline?.kill();
        idleTimeline = null;
        triangles.forEach(resetToHome);
      }
    });
  pane
    .addBinding(params, 'idleIntensity', { min: 0, max: 1, step: 0.05 })
    .on('change', () => {
      if (params.idle) startIdleAnimation();
    });

  pane
    .addBinding(params, 'colorMode', {
      options: {
        Original: 'original',
        Override: 'override',
        Gradient: 'gradient',
        'Random palette': 'random',
      },
    })
    .on('change', () => {
      applyColorMode(triangles, params.colorMode, { overrideColor: params.overrideColor });
      applyEmissiveStrength(triangles, params.emissiveStrength);
    });

  pane
    .addBinding(params, 'overrideColor')
    .on('change', () => {
      if (params.colorMode === 'override') {
        applyColorMode(triangles, 'override', { overrideColor: params.overrideColor });
        applyEmissiveStrength(triangles, params.emissiveStrength);
      }
    });

  pane
    .addBinding(params, 'emissiveStrength', { min: 0, max: 3, step: 0.05 })
    .on('change', () => {
      applyEmissiveStrength(triangles, params.emissiveStrength);
    });

  pane.addBinding(params, 'bloom', { label: 'Unreal bloom' }).on('change', () => {
    syncPostProcessingOutputs();
  });

  const aberrationFolder = pane.addFolder({ title: 'Chromatic aberration', expanded: false });
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

  pane
    .addBinding(params, 'orbitControls')
    .on('change', (ev) => {
      controls.enabled = ev.value;
    });

  pane
    .addBinding(params, 'background')
    .on('change', (ev) => {
      scene.background = new THREE.Color(ev.value);
    });

  pane.addBinding(params, 'finalizeHold', { min: 0, max: 3, step: 0.1 });

  pane
    .addBinding(params, 'cameraSequence', { label: 'Two-camera intro' })
    .on('change', () => playReveal());

  pane
    .addBinding(params, 'camera1Duration', {
      label: 'Camera 1 duration',
      min: 0,
      max: 6,
      step: 0.1,
    })
    .on('change', () => playReveal());

  pane.addButton({ title: 'Replay' }).on('click', () => playReveal());
  pane.addButton({ title: 'Reset camera to front' }).on('click', () => resetCameraToFront());
  pane.addButton({ title: 'Reset camera' }).on('click', () => resetCamera());
  pane.addButton({ title: 'Copy settings' }).on('click', () => copySettings());
  pane.addButton({ title: 'Load SVG file' }).on('click', () => {
    document.getElementById('file-input').click();
  });
  pane.addButton({ title: 'Reload default (poly3.svg)' }).on('click', () => loadSvg(DEFAULT_SVG));
  pane.addButton({ title: 'Record 1 loop (MP4)' }).on('click', () => startRecording(1, 'mp4'));
  pane.addButton({ title: 'Record 2 loops (MP4)' }).on('click', () => startRecording(2, 'mp4'));
  pane.addButton({ title: 'Record 1 loop (PNG ZIP)' }).on('click', () => startRecording(1, 'png'));
  pane.addButton({ title: 'Record 2 loops (PNG ZIP)' }).on('click', () => startRecording(2, 'png'));
  pane.addButton({ title: 'Hide UI (H)' }).on('click', () => toggleUi());
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

window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() !== 'h') return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    return;
  }
  event.preventDefault();
  toggleUi();
});

function animate() {
  requestAnimationFrame(animate);

  if (activeRecorder?.active) {
    return;
  }

  controls.update();
  renderFrame();
}

setupControls();
loadSvg(DEFAULT_SVG);
animate();
