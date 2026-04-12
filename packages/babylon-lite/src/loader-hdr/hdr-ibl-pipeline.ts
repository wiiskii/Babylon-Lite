/**
 * HDR IBL Pipeline (GPU compute)
 *
 * GPU compute shaders for equirect→cubemap conversion,
 * importance-sampled GGX cubemap prefiltering, and BRDF LUT generation.
 */

import type { HdrImage } from "./hdr-parser.js";
import { getOrCreateSampler } from "../resource/gpu-pool.js";

// ─── Equirect → Cubemap (GPU Compute) ──────────────────────────────────────

const EQUIRECT_TO_CUBE_WGSL = /* wgsl */ `
struct Params {
  faceSize: u32,
  equirectWidth: u32,
  equirectHeight: u32,
  _pad: u32,
}

@group(0) @binding(0) var equirect: texture_2d<f32>;
@group(0) @binding(1) var cubeFaces: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: Params;

const PI = 3.14159265359;

// BJS panoramaToCubemap.ts face corners, in GPU layer order:
//   Layer 0: FACE_RIGHT, Layer 1: FACE_LEFT, Layer 2: FACE_UP,
//   Layer 3: FACE_DOWN,  Layer 4: FACE_FRONT, Layer 5: FACE_BACK
// (This matches the _FacesMapping + double-reorder chain which nets to identity.)
const CORNERS = array<vec3<f32>, 24>(
  vec3( 1.0,-1.0, 1.0), vec3(-1.0,-1.0, 1.0), vec3( 1.0, 1.0, 1.0), vec3(-1.0, 1.0, 1.0),  // FACE_RIGHT
  vec3(-1.0,-1.0,-1.0), vec3( 1.0,-1.0,-1.0), vec3(-1.0, 1.0,-1.0), vec3( 1.0, 1.0,-1.0),  // FACE_LEFT
  vec3(-1.0,-1.0,-1.0), vec3(-1.0,-1.0, 1.0), vec3( 1.0,-1.0,-1.0), vec3( 1.0,-1.0, 1.0),  // FACE_UP
  vec3( 1.0, 1.0,-1.0), vec3( 1.0, 1.0, 1.0), vec3(-1.0, 1.0,-1.0), vec3(-1.0, 1.0, 1.0),  // FACE_DOWN
  vec3( 1.0,-1.0,-1.0), vec3( 1.0,-1.0, 1.0), vec3( 1.0, 1.0,-1.0), vec3( 1.0, 1.0, 1.0),  // FACE_FRONT
  vec3(-1.0,-1.0, 1.0), vec3(-1.0,-1.0,-1.0), vec3(-1.0, 1.0, 1.0), vec3(-1.0, 1.0,-1.0),  // FACE_BACK
);

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let face = gid.z;
  let size = params.faceSize;
  if (gid.x >= size || gid.y >= size || face >= 6u) { return; }

  // BJS parameterization: u, v ∈ [0, (size-1)/size]
  let u = f32(gid.x) / f32(size);
  let v = f32(gid.y) / f32(size);

  // Bilinear interpolation of BJS face corners (matches BJS CreateCubemapTexture)
  let base = face * 4u;
  let dir = normalize(
    CORNERS[base]     * (1.0 - u) * (1.0 - v) +
    CORNERS[base + 1u] * u * (1.0 - v) +
    CORNERS[base + 2u] * (1.0 - u) * v +
    CORNERS[base + 3u] * u * v
  );

  // BJS CalcProjectionSpherical: atan2(z, x), invertY=true
  let theta = atan2(dir.z, dir.x);
  let phi = acos(clamp(dir.y, -1.0, 1.0));
  let eu = theta / PI * 0.5 + 0.5;
  let ev = phi / PI;

  let px = clamp(i32(round(eu * f32(params.equirectWidth))), 0, i32(params.equirectWidth) - 1);
  let py_raw = clamp(i32(round(ev * f32(params.equirectHeight))), 0, i32(params.equirectHeight) - 1);
  let py = i32(params.equirectHeight) - py_raw - 1;  // invertY
  let color = textureLoad(equirect, vec2<i32>(px, py), 0);

  textureStore(cubeFaces, vec2<i32>(gid.xy), i32(face), vec4<f32>(color.rgb, 1.0));
}
`;

export function equirectToCubemapGPU(device: GPUDevice, hdr: HdrImage, faceSize: number): GPUTexture {
    // Upload equirect as a 2D texture
    const equirectTex = device.createTexture({
        size: [hdr.width, hdr.height],
        format: "rgba32float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    {
        const rgba = new Float32Array(hdr.width * hdr.height * 4);
        for (let i = 0; i < hdr.width * hdr.height; i++) {
            rgba[i * 4] = hdr.data[i * 3]!;
            rgba[i * 4 + 1] = hdr.data[i * 3 + 1]!;
            rgba[i * 4 + 2] = hdr.data[i * 3 + 2]!;
            rgba[i * 4 + 3] = 1;
        }
        device.queue.writeTexture({ texture: equirectTex }, rgba.buffer, { bytesPerRow: hdr.width * 16 }, { width: hdr.width, height: hdr.height });
    }

    // Create the output cubemap
    const cubeTex = device.createTexture({
        size: [faceSize, faceSize, 6],
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
        dimension: "2d",
    });

    // Run compute shader (uses BJS face corners + CalcProjectionSpherical)
    const module = device.createShaderModule({ code: EQUIRECT_TO_CUBE_WGSL });
    const pipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: "main" },
    });
    const paramBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(paramBuf, 0, new Uint32Array([faceSize, hdr.width, hdr.height, 0]));

    const bg = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: equirectTex.createView() },
            { binding: 1, resource: cubeTex.createView({ dimension: "2d-array", arrayLayerCount: 6 }) },
            { binding: 2, resource: { buffer: paramBuf } },
        ],
    });

    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(faceSize / 8), Math.ceil(faceSize / 8), 6);
    pass.end();
    device.queue.submit([enc.finish()]);

    equirectTex.destroy();
    paramBuf.destroy();
    return cubeTex;
}

// ─── Cubemap Prefiltering (GPU Compute, Importance-Sampled GGX) ─────────────

const PREFILTER_CUBE_WGSL = /* wgsl */ `
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
`;

export function prefilterCubemapGPU(device: GPUDevice, srcCube: GPUTexture, faceSize: number, mipCount: number): GPUTexture {
    const dstCube = device.createTexture({
        size: { width: faceSize, height: faceSize, depthOrArrayLayers: 6 },
        mipLevelCount: mipCount,
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST,
    });

    const srcCubeView = srcCube.createView({ dimension: "cube" });
    const srcSampler = getOrCreateSampler(device, { magFilter: "linear", minFilter: "linear" });

    const pipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: device.createShaderModule({ code: PREFILTER_CUBE_WGSL }), entryPoint: "main" },
    });

    const paramsBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // LOD 0: exact texel copy (no bilinear resampling) to match BJS
    {
        const copyEnc = device.createCommandEncoder();
        copyEnc.copyTextureToTexture({ texture: srcCube }, { texture: dstCube, mipLevel: 0 }, { width: faceSize, height: faceSize, depthOrArrayLayers: 6 });
        device.queue.submit([copyEnc.finish()]);
    }

    // LODs 1+: importance-sampled GGX prefilter
    for (let mip = 1; mip < mipCount; mip++) {
        const mipSize = faceSize >> mip;
        if (mipSize < 1) {
            break;
        }

        device.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([faceSize, mip, mipCount, faceSize]));

        const dstView = dstCube.createView({
            dimension: "2d-array",
            baseMipLevel: mip,
            mipLevelCount: 1,
            baseArrayLayer: 0,
            arrayLayerCount: 6,
        });

        const bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: srcCubeView },
                { binding: 1, resource: srcSampler },
                { binding: 2, resource: dstView },
                { binding: 3, resource: { buffer: paramsBuffer } },
            ],
        });

        // One submit per mip ensures params buffer is consumed before next writeBuffer
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(mipSize / 8), Math.ceil(mipSize / 8), 6);
        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    srcCube.destroy();
    paramsBuffer.destroy();
    return dstCube;
}

// ─── BRDF LUT ───────────────────────────────────────────────────────────────

const BRDF_LUT_WGSL = /* wgsl */ `
@group(0) @binding(0) var outputTex: texture_storage_2d<rgba16float, write>;

fn radicalInverseVdC(inputBits: u32) -> f32 {
    var bits = inputBits;
    bits = (bits << 16u) | (bits >> 16u);
    bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
    bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
    bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
    bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
    return f32(bits) * 2.3283064365386963e-10;
}

fn importanceSampleGGX(xi0: f32, xi1: f32, a2: f32) -> vec3f {
    let phi = 2.0 * 3.14159265359 * xi0;
    let cosTheta = sqrt((1.0 - xi1) / (1.0 + (a2 - 1.0) * xi1));
    let sinTheta = sqrt(1.0 - cosTheta * cosTheta);
    return vec3f(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);
}

fn integrateBRDF(NdotV: f32, roughness: f32) -> vec2f {
    let V = vec3f(sqrt(1.0 - NdotV * NdotV), 0.0, NdotV);
    let a = roughness * roughness;
    let a2 = a * a;
    var A = 0.0; var B = 0.0;
    let sampleCount = 1024u;
    for (var i = 0u; i < sampleCount; i++) {
        let xi0 = f32(i) / f32(sampleCount);
        let xi1 = radicalInverseVdC(i);
        let H = importanceSampleGGX(xi0, xi1, a2);
        let VdotH = max(dot(V, H), 0.0);
        let L = 2.0 * VdotH * H - V;
        let NdotL = max(L.z, 0.0); let NdotH = max(H.z, 0.0);
        if (NdotL > 0.0 && NdotH > 0.0) {
            let GGXV = NdotL * sqrt(NdotV * NdotV * (1.0 - a2) + a2);
            let GGXL = NdotV * sqrt(NdotL * NdotL * (1.0 - a2) + a2);
            let V_Vis = (0.5 / max(GGXV + GGXL, 1e-6)) * NdotL * (4.0 * VdotH / NdotH);
            let Fc = pow(1.0 - VdotH, 5.0);
            A += (1.0 - Fc) * V_Vis; B += Fc * V_Vis;
        }
    }
    return vec2f(A / f32(sampleCount), B / f32(sampleCount));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    if (gid.x >= 256u || gid.y >= 256u) { return; }
    let NdotV = max((f32(gid.x) + 0.5) / 256.0, 0.001);
    let roughness = max((f32(gid.y) + 0.5) / 256.0, 0.04);
    let result = integrateBRDF(NdotV, roughness);
    textureStore(outputTex, vec2u(gid.x, gid.y), vec4f(result.y, result.x + result.y, 0.0, 1.0));
}
`;

let _brdfPipeline: GPUComputePipeline | null = null;

export function generateBrdfLut(device: GPUDevice): GPUTexture {
    if (!_brdfPipeline) {
        _brdfPipeline = device.createComputePipeline({
            layout: "auto",
            compute: { module: device.createShaderModule({ code: BRDF_LUT_WGSL }), entryPoint: "main" },
        });
    }
    const size = 256;
    const texture = device.createTexture({
        size: { width: size, height: size },
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    const bindGroup = device.createBindGroup({
        layout: _brdfPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: texture.createView() }],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(_brdfPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(size / 8), Math.ceil(size / 8));
    pass.end();
    device.queue.submit([encoder.finish()]);
    return texture;
}
