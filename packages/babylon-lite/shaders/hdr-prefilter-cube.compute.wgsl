struct Params {
  faceSize: u32,
  mipLevel: u32,
  totalMips: u32,
  srcSize: u32,
}

@group(0) @binding(0) var srcCube: texture_cube<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var dstFaces: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: Params;

const PI = 3.14159265359;
const SAMPLE_COUNT = 1024u;

// BJS face corners (same layout as equirect→cubemap shader)
const CORNERS = array<vec3<f32>, 24>(
  vec3( 1.0,-1.0, 1.0), vec3(-1.0,-1.0, 1.0), vec3( 1.0, 1.0, 1.0), vec3(-1.0, 1.0, 1.0),  // FACE_RIGHT  → layer 0
  vec3(-1.0,-1.0,-1.0), vec3( 1.0,-1.0,-1.0), vec3(-1.0, 1.0,-1.0), vec3( 1.0, 1.0,-1.0),  // FACE_LEFT   → layer 1
  vec3(-1.0,-1.0,-1.0), vec3(-1.0,-1.0, 1.0), vec3( 1.0,-1.0,-1.0), vec3( 1.0,-1.0, 1.0),  // FACE_UP     → layer 2
  vec3( 1.0, 1.0,-1.0), vec3( 1.0, 1.0, 1.0), vec3(-1.0, 1.0,-1.0), vec3(-1.0, 1.0, 1.0),  // FACE_DOWN   → layer 3
  vec3( 1.0,-1.0,-1.0), vec3( 1.0,-1.0, 1.0), vec3( 1.0, 1.0,-1.0), vec3( 1.0, 1.0, 1.0),  // FACE_FRONT  → layer 4
  vec3(-1.0,-1.0, 1.0), vec3(-1.0,-1.0,-1.0), vec3(-1.0, 1.0, 1.0), vec3(-1.0, 1.0,-1.0),  // FACE_BACK   → layer 5
);

fn bjsFaceDir(face: u32, u: f32, v: f32) -> vec3<f32> {
  let base = face * 4u;
  return normalize(
    CORNERS[base]     * (1.0 - u) * (1.0 - v) +
    CORNERS[base + 1u] * u * (1.0 - v) +
    CORNERS[base + 2u] * (1.0 - u) * v +
    CORNERS[base + 3u] * u * v
  );
}

fn radicalInverseVdC(inputBits: u32) -> f32 {
  var bits = inputBits;
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return f32(bits) * 2.3283064365386963e-10;
}

fn importanceSampleGGX(xi0: f32, xi1: f32, alphaG: f32) -> vec3<f32> {
  let a2 = alphaG * alphaG;
  let phi = 2.0 * PI * xi0;
  let cosTheta = sqrt((1.0 - xi1) / (1.0 + (a2 - 1.0) * xi1));
  let sinTheta = sqrt(1.0 - cosTheta * cosTheta);
  return vec3<f32>(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);
}

fn D_GGX(NdotH: f32, a2: f32) -> f32 {
  let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}

fn faceDirection(face: u32, u: f32, v: f32) -> vec3<f32> {
  return bjsFaceDir(face, u, v);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let face = gid.z;
  let mipSize = params.faceSize >> params.mipLevel;
  if (gid.x >= mipSize || gid.y >= mipSize || face >= 6u) { return; }

  let u = f32(gid.x) / f32(mipSize);
  let v = f32(gid.y) / f32(mipSize);
  let N = normalize(faceDirection(face, u, v));

  let alphaG = pow(2.0, f32(params.mipLevel) / 0.8) / f32(params.srcSize);

  if (params.mipLevel == 0u) {
    let color = textureSampleLevel(srcCube, srcSampler, N, 0.0);
    textureStore(dstFaces, vec2<i32>(gid.xy), i32(face), vec4<f32>(color.rgb, 1.0));
    return;
  }

  var upVec = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 0.0, 1.0), abs(N.z) < 0.999);
  let tangentX = normalize(cross(upVec, N));
  let tangentY = cross(N, tangentX);

  var result = vec3<f32>(0.0);
  var totalWeight = 0.0;
  let srcDim = f32(params.srcSize);
  let omegaP = 4.0 * PI / (6.0 * srcDim * srcDim);
  let maxLod = f32(params.totalMips) - 1.0;

  for (var i = 0u; i < SAMPLE_COUNT; i++) {
    let xi0 = f32(i) / f32(SAMPLE_COUNT);
    let xi1 = radicalInverseVdC(i);
    let H = importanceSampleGGX(xi0, xi1, alphaG);
    let H_world = tangentX * H.x + tangentY * H.y + N * H.z;
    let NdotH = max(dot(N, H_world), 0.0);
    let L = 2.0 * NdotH * H_world - N;
    let NdotL = dot(N, L);

    if (NdotL > 0.0) {
      let a2 = alphaG * alphaG;
      let pdf = D_GGX(NdotH, a2) / 4.0;
      let omegaS = 1.0 / (f32(SAMPLE_COUNT) * max(pdf, 0.0001));
      let sampleLod = clamp(0.5 * log2(omegaS / omegaP) + 1.0, 0.0, maxLod);
      let sampleColor = textureSampleLevel(srcCube, srcSampler, L, sampleLod);
      result += sampleColor.rgb * NdotL;
      totalWeight += NdotL;
    }
  }

  if (totalWeight > 0.0) { result /= totalWeight; }
  textureStore(dstFaces, vec2<i32>(gid.xy), i32(face), vec4<f32>(result, 1.0));
}
