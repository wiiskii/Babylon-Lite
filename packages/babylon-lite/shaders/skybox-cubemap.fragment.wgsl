// Skybox CubeMap Fragment Shader
// Samples cube texture using object-space position as lookup direction.
// Matches Babylon StandardMaterial with REFLECTION + REFLECTIONMAP_SKYBOX.

@group(1) @binding(1) var cubeTexture: texture_cube<f32>;
@group(1) @binding(2) var cubeSampler: sampler;

struct FragmentInput {
  @location(0) vPositionW: vec3<f32>,
  @location(1) vPositionLocal: vec3<f32>,
  @location(2) vFogDistance: vec3<f32>,
};

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
  // SKYBOX_MODE: use object-space position as cube lookup direction
  let lookupDir = normalize(input.vPositionLocal);
  var color = textureSample(cubeTexture, cubeSampler, lookupDir);

  // Apply fog
  if (scene.vFogInfos.x > 0.0) {
    let fog = calcFogFactor(input.vFogDistance);
    color = vec4<f32>(mix(scene.vFogColor.rgb, color.rgb, fog), color.a);
  }

  return color;
}
