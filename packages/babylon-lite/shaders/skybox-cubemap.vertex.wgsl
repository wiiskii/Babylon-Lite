// Skybox CubeMap Vertex Shader
// Passes object-space position (for cube texture lookup) and world-space position.

struct MeshUniforms {
  world: mat4x4<f32>,
};
@group(1) @binding(0) var<uniform> mesh: MeshUniforms;

struct VertexOutput {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) vPositionW: vec3<f32>,
  @location(1) vPositionLocal: vec3<f32>,
  @location(2) vFogDistance: vec3<f32>,
};

@vertex
fn main(
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
) -> VertexOutput {
  var out: VertexOutput;
  let worldPos = mesh.world * vec4<f32>(position, 1.0);
  out.vPositionW = worldPos.xyz;
  out.vPositionLocal = position;
  out.clipPos = scene.viewProjection * worldPos;
  out.vFogDistance = (scene.view * worldPos).xyz;
  return out;
}
