// Shadow Depth Fragment Shader — ESM: write exp(-depthScale * depth)
// Matches Babylon ShadowGenerator fragment (SM_ESM + SM_FLOAT)

struct ShadowParams {
  biasAndScale: vec4<f32>,  // x=bias, y=unused, z=depthScale
  depthValues: vec4<f32>,
};
@group(1) @binding(1) var<uniform> shadowParams: ShadowParams;

@fragment
fn main(@location(0) vDepthMetricSM: f32) -> @location(0) vec4<f32> {
  var depthSM = vDepthMetricSM;
  depthSM = clamp(exp(-min(87.0, shadowParams.biasAndScale.z * depthSM)), 0.0, 1.0);
  return vec4<f32>(depthSM, 1.0, 1.0, 1.0);
}
