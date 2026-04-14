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
