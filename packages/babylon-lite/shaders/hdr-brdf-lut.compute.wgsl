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
