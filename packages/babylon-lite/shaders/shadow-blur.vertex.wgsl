// Shadow Blur Vertex Shader — fullscreen quad with pre-computed sample coordinates
// Uses Babylon's kernel blur approach with bilinear tap offsets

struct BlurParams {
  delta: vec2<f32>,   // (1/texWidth, 0) for H pass, (0, 1/texHeight) for V pass
  _pad: vec2<f32>,
};
@group(0) @binding(0) var<uniform> params: BlurParams;

struct VertexOutput {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) sampleCenter: vec2<f32>,
};

@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  // Fullscreen triangle (3 vertices cover the screen)
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );

  var out: VertexOutput;
  let p = pos[vertexIndex];
  out.clipPos = vec4<f32>(p, 0.0, 1.0);
  out.sampleCenter = p * vec2<f32>(0.5, -0.5) + 0.5;
  return out;
}
