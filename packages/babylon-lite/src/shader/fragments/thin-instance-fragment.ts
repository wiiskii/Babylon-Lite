/**
 * Thin Instance Fragment
 *
 * Shared between PBR and Standard materials.
 * Replaces the regex-based string surgery in pbr-thin-instance-ext.ts
 * with clean declarative vertex attributes and slot injection.
 *
 * Zero bytes in bundles for scenes that don't use thin instances.
 */

import type { ShaderFragment } from "../fragment-types.js";

/**
 * Create a thin-instance fragment.
 * @param hasInstanceColor Whether meshes have per-instance color data.
 */
export function createThinInstanceFragment(hasInstanceColor: boolean): ShaderFragment {
    const attrs = [
        {
            name: "world0",
            type: "vec4<f32>",
            gpuFormat: "float32x4" as GPUVertexFormat,
            arrayStride: 64,
            stepMode: "instance" as GPUVertexStepMode,
            bufferGroup: "ti-matrix",
            offset: 0,
        },
        {
            name: "world1",
            type: "vec4<f32>",
            gpuFormat: "float32x4" as GPUVertexFormat,
            arrayStride: 64,
            stepMode: "instance" as GPUVertexStepMode,
            bufferGroup: "ti-matrix",
            offset: 16,
        },
        {
            name: "world2",
            type: "vec4<f32>",
            gpuFormat: "float32x4" as GPUVertexFormat,
            arrayStride: 64,
            stepMode: "instance" as GPUVertexStepMode,
            bufferGroup: "ti-matrix",
            offset: 32,
        },
        {
            name: "world3",
            type: "vec4<f32>",
            gpuFormat: "float32x4" as GPUVertexFormat,
            arrayStride: 64,
            stepMode: "instance" as GPUVertexStepMode,
            bufferGroup: "ti-matrix",
            offset: 48,
        },
    ];

    if (hasInstanceColor) {
        attrs.push({
            name: "instanceColor",
            type: "vec4<f32>",
            gpuFormat: "float32x4" as GPUVertexFormat,
            arrayStride: 16,
            stepMode: "instance" as GPUVertexStepMode,
            bufferGroup: "ti-color",
            offset: 0,
        });
    }

    return {
        id: "thin-instance",

        vertexAttributes: attrs,

        varyings: hasInstanceColor ? [{ name: "vInstanceColor", type: "vec4<f32>" }] : [],

        vertexSlots: {
            VW: `let instanceWorld = mat4x4<f32>(world0, world1, world2, world3);\nfinalWorld = mesh.world * instanceWorld;`,
            VB: hasInstanceColor ? `out.vInstanceColor = instanceColor;` : "",
        },

        fragmentSlots: hasInstanceColor
            ? {
                  AT: `baseColor *= input.vInstanceColor.rgb;\nalpha *= input.vInstanceColor.a;`,
              }
            : {},
    };
}
