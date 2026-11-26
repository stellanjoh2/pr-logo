/**
 * Chromatic aberration — ported from meshgl / Orby post stack.
 */

export const ABERRATION_FALLOFF_MIN = 0.5;
export const ABERRATION_FALLOFF_MAX = 3;

export const ABERRATION_QUALITY_DEFAULT = 'medium';
export const ABERRATION_QUALITY = Object.freeze({
  low: { minBlurSamples: 3, maxBlurSamples: 6 },
  medium: { minBlurSamples: 4, maxBlurSamples: 12 },
  high: { minBlurSamples: 6, maxBlurSamples: 16 },
  ultra: { minBlurSamples: 8, maxBlurSamples: 24 },
});

export const ABERRATION_MAX_SHADER_SAMPLES = 24;

export function normalizeAberrationQualityId(id) {
  if (id === 'low' || id === 'high' || id === 'ultra') return id;
  return 'medium';
}

export function resolveAberrationQualityTier(id) {
  const key = normalizeAberrationQualityId(id);
  return ABERRATION_QUALITY[key] ?? ABERRATION_QUALITY.medium;
}

export const defaultAberration = Object.freeze({
  enabled: true,
  amount: 0.0046,
  blur: 0.13,
  falloff: 1,
  quality: ABERRATION_QUALITY_DEFAULT,
});

export function mergeAberrationSettings(settings) {
  const base = {
    enabled: defaultAberration.enabled,
    amount: defaultAberration.amount,
    blur: defaultAberration.blur,
    falloff: defaultAberration.falloff,
    quality: defaultAberration.quality,
  };
  if (!settings || typeof settings !== 'object') return base;

  const merged = { ...base, ...settings };
  if (
    typeof settings.amount !== 'number' &&
    (typeof settings.offset === 'number' || typeof settings.strength === 'number')
  ) {
    const offset = typeof settings.offset === 'number' ? settings.offset : 0.0025;
    const strength = typeof settings.strength === 'number' ? settings.strength : 0.24;
    merged.amount = offset * strength;
  }

  if (typeof merged.amount !== 'number' || Number.isNaN(merged.amount)) {
    merged.amount = defaultAberration.amount;
  }
  if (typeof merged.blur !== 'number' || Number.isNaN(merged.blur)) {
    merged.blur = defaultAberration.blur;
  } else {
    merged.blur = Math.min(1, Math.max(0, merged.blur));
  }
  if (typeof merged.falloff !== 'number' || Number.isNaN(merged.falloff)) {
    merged.falloff = defaultAberration.falloff;
  } else {
    merged.falloff = Math.min(
      ABERRATION_FALLOFF_MAX,
      Math.max(ABERRATION_FALLOFF_MIN, merged.falloff),
    );
  }
  merged.quality = normalizeAberrationQualityId(
    typeof merged.quality === 'string' ? merged.quality : defaultAberration.quality,
  );
  return merged;
}

export function aberrationFalloffToShaderExponent(falloff) {
  const clamped = Math.min(
    ABERRATION_FALLOFF_MAX,
    Math.max(ABERRATION_FALLOFF_MIN, falloff),
  );
  return ABERRATION_FALLOFF_MIN + ABERRATION_FALLOFF_MAX - clamped;
}

const aberrationVertex = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const aberrationFragment = `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float amount;
uniform float blur;
uniform float falloff;
uniform float minBlurSamples;
uniform float maxBlurSamples;
uniform float aspectRatio;

const int MAX_SAMPLES = ${ABERRATION_MAX_SHADER_SAMPLES};

void main() {
  vec2 invAspect = vec2(aspectRatio, 1.0);
  vec2 p = (vUv - 0.5) * invAspect;
  float dist = length(p);

  float maxR = length(vec2(0.5 * aspectRatio, 0.5));
  float t = clamp(dist / maxR, 0.0, 1.0);
  t = pow(t, max(falloff, 0.25));
  float baseMag = amount * t;

  vec2 dirP = dist > 1e-5 ? p / dist : vec2(1.0, 0.0);
  vec2 shift = (dirP * baseMag) / invAspect;
  vec2 shiftDir = dirP / invAspect;

  vec3 sharp;
  sharp.r = texture2D(tDiffuse, vUv + shift * 1.06).r;
  sharp.g = texture2D(tDiffuse, vUv).g;
  sharp.b = texture2D(tDiffuse, vUv - shift * 0.94).b;

  if (blur < 0.002) {
    gl_FragColor = vec4(sharp, 1.0);
    return;
  }

  float streak = blur * baseMag * 10.0;
  int samples = int(mix(minBlurSamples, maxBlurSamples, clamp(blur, 0.0, 1.0)));

  float rAcc = 0.0;
  float gAcc = 0.0;
  float bAcc = 0.0;
  float wSum = 0.0;

  for (int i = 0; i < MAX_SAMPLES; i++) {
    if (i >= samples) break;
    float u = samples > 1 ? (float(i) / float(samples - 1) - 0.5) * 2.0 : 0.0;
    vec2 smear = shiftDir * streak * u;
    rAcc += texture2D(tDiffuse, vUv + shift * 1.06 + smear).r;
    gAcc += texture2D(tDiffuse, vUv).g;
    bAcc += texture2D(tDiffuse, vUv - shift * 0.94 - smear).b;
    wSum += 1.0;
  }

  vec3 smeared = vec3(rAcc, gAcc, bAcc) / wSum;

  float ySharp = dot(sharp, vec3(0.299, 0.587, 0.114));
  float ySm = dot(smeared, vec3(0.299, 0.587, 0.114));
  smeared = vec3(ySharp) + (smeared - vec3(ySm));

  gl_FragColor = vec4(smeared, 1.0);
}
`;

const defaultAberrationQualityTier = resolveAberrationQualityTier(defaultAberration.quality);

export const AberrationShader = {
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: defaultAberration.amount },
    blur: { value: defaultAberration.blur },
    falloff: { value: defaultAberration.falloff },
    minBlurSamples: { value: defaultAberrationQualityTier.minBlurSamples },
    maxBlurSamples: { value: defaultAberrationQualityTier.maxBlurSamples },
    aspectRatio: { value: 1 },
  },
  vertexShader: aberrationVertex,
  fragmentShader: aberrationFragment,
};

export function isChromaticAberrationActive(settings) {
  const merged = mergeAberrationSettings(settings);
  const wants = merged.enabled === undefined ? true : Boolean(merged.enabled);
  return wants && Math.abs(merged.amount ?? 0) > 0.0001;
}

export function applyChromaticAberrationToPass(pass, settings) {
  if (!pass?.uniforms) return;
  const merged = mergeAberrationSettings(settings);
  if (!isChromaticAberrationActive(merged)) {
    pass.enabled = false;
    return;
  }
  const tier = resolveAberrationQualityTier(merged.quality);
  pass.enabled = true;
  pass.uniforms.amount.value = merged.amount;
  pass.uniforms.blur.value = merged.blur;
  pass.uniforms.falloff.value = aberrationFalloffToShaderExponent(merged.falloff);
  pass.uniforms.minBlurSamples.value = tier.minBlurSamples;
  pass.uniforms.maxBlurSamples.value = tier.maxBlurSamples;
}
