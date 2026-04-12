// Skybox Fragment Shader — matches Babylon BackgroundMaterial
// BJS loads a separate CDN skybox texture (backgroundSkybox.dds) that produces
// exactly scene.clearColor when rendered through the BackgroundMaterial pipeline.
// We replicate this by outputting the pre-computed clearColor directly from a UBO.

struct MeshUniforms {
  world: mat4x4<f32>,
  primaryColor: vec3<f32>,
  _pad: f32,
  // Pre-computed sRGB output color for the sky background (= scene.clearColor).
  skyOutputColor: vec3<f32>,
  _pad2: f32,
};
@group(1) @binding(0) var<uniform> mesh: MeshUniforms;

struct FragmentInput {
  @location(0) positionUVW: vec3<f32>,
  @location(1) positionW: vec3<f32>,
};

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
  var result = vec4<f32>(mesh.skyOutputColor, 1.0);

  // Dithering (enableNoise=true, variance=0.5)
  result = vec4<f32>(result.rgb + vec3<f32>(dither(input.positionW.xy, 0.5)), result.a);
  result = max(result, vec4<f32>(0.0));

  return result;
}
