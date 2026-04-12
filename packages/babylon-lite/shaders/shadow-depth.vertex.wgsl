// Shadow Depth Vertex Shader — renders shadow casters from light's perspective
// Outputs vDepthMetricSM for ESM depth encoding

struct MeshUniforms {
  world: mat4x4<f32>,
};
@group(1) @binding(0) var<uniform> mesh: MeshUniforms;

struct ShadowParams {
  biasAndScale: vec4<f32>,  // x=bias, y=unused, z=depthScale, w=unused
  depthValues: vec4<f32>,   // x=near, y=far
};
@group(1) @binding(1) var<uniform> shadowParams: ShadowParams;

struct VertexOutput {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) vDepthMetricSM: f32,
};

@vertex
fn main(
  @location(0) position: vec3<f32>,
) -> VertexOutput {
  var out: VertexOutput;
  let worldPos = mesh.world * vec4<f32>(position, 1.0);
  out.clipPos = scene.viewProjection * worldPos;
  out.vDepthMetricSM = (out.clipPos.z + shadowParams.depthValues.x) / shadowParams.depthValues.y + shadowParams.biasAndScale.x;
  return out;
}
