// Test the minifyWgsl function
const { readFileSync, readdirSync } = require('fs');

function minifyWgsl(src) {
  return src
    .replace(/\/\/[^\n]*/g, '')        // strip line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')  // strip block comments
    .replace(/\r/g, '')                // strip \r
    .replace(/^[ \t]+/gm, '')          // strip leading whitespace per line
    .replace(/[ \t]+$/gm, '')          // strip trailing whitespace per line
    .replace(/\n{2,}/g, '\n')          // collapse blank lines
    .replace(/ *([=:,+\-*/(){}\[\];]) */g, '$1') // strip spaces around safe operators
    .replace(/ *< */g, '<')            // strip spaces around <
    .replace(/ *> */g, '>')            // strip spaces around >
    .replace(/([^-])>([a-zA-Z_])/g, '$1> $2')  // restore space: var<uniform> name (not ->f32)
    .trim();
}

// Test cases
const tests = [
  ['@group(0) @binding(0) var<uniform> scene: SceneUniforms;', '@group(0)@binding(0)var<uniform> scene:SceneUniforms;'],
  ['viewProj: mat4x4<f32>,', 'viewProj:mat4x4<f32>,'],
  ['let a = roughness * roughness;', 'let a=roughness*roughness;'],
  ['fn main(x: f32) -> f32 {', 'fn main(x:f32)->f32{'],
  ['return a2 / (PI * d * d);', 'return a2/(PI*d*d);'],
  ['cameraPosition: vec3<f32>, _pad0: f32,', 'cameraPosition:vec3<f32>,_pad0:f32,'],
  ['let gl = NdotL * sqrt(NdotV * NdotV * (1.0 - a2) + a2);', 'let gl=NdotL*sqrt(NdotV*NdotV*(1.0-a2)+a2);'],
];

let passed = 0;
for (const [input, expected] of tests) {
  const result = minifyWgsl(input);
  const pass = result === expected;
  if (!pass) {
    console.log(`FAIL: "${input}"`);
    console.log(`  got:      "${result}"`);
    console.log(`  expected: "${expected}"`);
  } else {
    passed++;
  }
}
console.log(`${passed}/${tests.length} tests passed`);

// Test on actual .wgsl files
const files = [
  'packages/babylon-lite/shaders/background.vertex.wgsl',
  'packages/babylon-lite/shaders/background.ground.fragment.wgsl',
  'packages/babylon-lite/shaders/skybox.vertex.wgsl',
  'packages/babylon-lite/shaders/skybox.fragment.wgsl',
];

let totalSaved = 0;
for (const f of files) {
  const raw = readFileSync(f, 'utf-8');
  const min = minifyWgsl(raw);
  const saved = raw.length - min.length;
  totalSaved += saved;
  console.log(`${f}: ${raw.length} -> ${min.length} (saved ${saved})`);
}
console.log(`Total saved from .wgsl files: ${totalSaved}`);

