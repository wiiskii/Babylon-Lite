// Shadow Blur Fragment Shader — Gaussian kernel blur
// Matches Babylon's kernelBlur post-process with blurKernel=64
//
// Uses 33 taps total (26 bilinear + 7 dependent) matching Babylon's exact weights.
// The kernel weights and offsets are baked as constants — they are fixed for blurKernel=64.

struct BlurParams {
  delta: vec2<f32>,
  _pad: vec2<f32>,
};
@group(0) @binding(0) var<uniform> params: BlurParams;
@group(0) @binding(1) var srcTex: texture_2d<f32>;
@group(0) @binding(2) var srcSampler: sampler;

// 26 bilinear taps (pre-computed from vertex shader)
const OFFSETS = array<f32, 26>(
  -31.43122487, 31.43122487,
  -29.43554136, 29.43554136,
  -27.43986765, 27.43986765,
  -25.44420309, 25.44420309,
  -23.44854704, 23.44854704,
  -21.45289886, 21.45289886,
  -19.45725789, 19.45725789,
  -17.46162348, 17.46162348,
  -15.46599496, 15.46599496,
  -13.47037167, 13.47037167,
  -11.47475294, 11.47475294,
  -9.4791381, 9.4791381,
  -7.48352647, 7.48352647,
);

const WEIGHTS = array<f32, 26>(
  0.00096573, 0.00096573,
  0.00164886, 0.00164886,
  0.0027182, 0.0027182,
  0.00432655, 0.00432655,
  0.00664916, 0.00664916,
  0.00986638, 0.00986638,
  0.01413558, 0.01413558,
  0.01955395, 0.01955395,
  0.02611683, 0.02611683,
  0.03367998, 0.03367998,
  0.04193613, 0.04193613,
  0.05041622, 0.05041622,
  0.05852177, 0.05852177,
);

// 7 dependent taps (computed in fragment shader)
const DEP_OFFSETS = array<f32, 7>(
  -5.48791739, 5.48791739,
  -3.49231018, 3.49231018,
  -1.49670415, 1.49670415,
  0.0,
);

const DEP_WEIGHTS = array<f32, 7>(
  0.06558884, 0.06558884,
  0.0709754, 0.0709754,
  0.07415683, 0.07415683,
  0.0374872,
);

@fragment
fn main(@location(0) sampleCenter: vec2<f32>) -> @location(0) vec4<f32> {
  var blend = vec4<f32>(0.0);

  // 26 bilinear taps
  for (var i = 0u; i < 26u; i = i + 1u) {
    let coord = sampleCenter + params.delta * OFFSETS[i];
    blend += textureSample(srcTex, srcSampler, coord) * WEIGHTS[i];
  }

  // 7 dependent taps
  for (var i = 0u; i < 7u; i = i + 1u) {
    let coord = sampleCenter + params.delta * DEP_OFFSETS[i];
    blend += textureSample(srcTex, srcSampler, coord) * DEP_WEIGHTS[i];
  }

  return blend;
}
