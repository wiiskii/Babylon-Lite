/**
 * Shared no-color (depth-only) material-view dispatch.
 *
 * A "no-color view" wraps a source material so its pipeline drops the fragment
 * colour output (writing depth only). It is the machinery behind shadow-caster
 * passes (PCF / CSM) and the opaque depth pre-pass — any task that needs to
 * render scene geometry into a depth-only target reuses the EXACT same vertex
 * shader as the lit material (so the depth values are bit-identical) while
 * skipping colour work.
 *
 * The four public factories live in their own per-family modules so a scene
 * that never casts shadows / never runs a depth pre-pass retains none of them;
 * they are imported lazily here, gated on which material families a given
 * caster/opaque mesh list actually contains.
 *
 * This module is the single owner of that lazy-load + family-dispatch logic
 * (one name, no translation): `pcf-shadow-task-hooks.ts` re-exports it for its
 * historical importers, and `scene-core.ts` imports it for the depth pre-pass.
 */

import type { Material, MaterialView } from "./material.js";
import type { Mesh } from "../mesh/mesh.js";

type StandardNoColorFactory = typeof import("./standard/no-color-view.js").createStandardNoColorMaterialView;
type PbrNoColorFactory = typeof import("./pbr/no-color-view.js").createPbrNoColorMaterialView;
type NodeNoColorFactory = typeof import("./node/no-color-view.js").createNodeNoColorMaterialView;
type ShaderNoColorFactory = typeof import("./shader/no-color-view.js").createShaderNoColorMaterialView;

let createStandardNoColorMaterialView: StandardNoColorFactory;
let createPbrNoColorMaterialView: PbrNoColorFactory;
let createNodeNoColorMaterialView: NodeNoColorFactory;
let createShaderNoColorMaterialView: ShaderNoColorFactory;

/** Lazily import the no-color view factories for whichever material families
 *  appear in `meshes`. Idempotent — each family module is fetched at most once. */
export async function preloadNoColorViewDispatch(meshes: readonly Mesh[]): Promise<void> {
    const loads: Promise<void>[] = [];
    let needsStandard = false;
    let needsPbr = false;
    let needsNode = false;
    let needsShader = false;
    for (const mesh of meshes) {
        const family = mesh.material?._buildGroup._materialFamily;
        needsStandard ||= family === "standard";
        needsPbr ||= family === "pbr";
        needsNode ||= family === "node";
        needsShader ||= family === "shader";
    }
    if (needsStandard && !createStandardNoColorMaterialView) {
        loads.push(
            import("./standard/no-color-view.js").then((module) => {
                createStandardNoColorMaterialView = module.createStandardNoColorMaterialView;
            })
        );
    }
    if (needsPbr && !createPbrNoColorMaterialView) {
        loads.push(
            import("./pbr/no-color-view.js").then((module) => {
                createPbrNoColorMaterialView = module.createPbrNoColorMaterialView;
            })
        );
    }
    if (needsNode && !createNodeNoColorMaterialView) {
        loads.push(
            import("./node/no-color-view.js").then((module) => {
                createNodeNoColorMaterialView = module.createNodeNoColorMaterialView;
            })
        );
    }
    if (needsShader && !createShaderNoColorMaterialView) {
        loads.push(
            import("./shader/no-color-view.js").then((module) => {
                createShaderNoColorMaterialView = module.createShaderNoColorMaterialView;
            })
        );
    }
    await Promise.all(loads);
}

/** Resolve (and cache) the no-color view for `material`, dispatching by family.
 *  The matching factory must already have been loaded via
 *  {@link preloadNoColorViewDispatch}. */
export function getNoColorView(material: Material, cache: Map<Material, MaterialView>): MaterialView {
    const cached = cache.get(material);
    if (cached) {
        return cached;
    }
    const family = material._buildGroup._materialFamily;
    let view: MaterialView;
    if (family === "standard") {
        view = createStandardNoColorMaterialView(material as Parameters<StandardNoColorFactory>[0]);
    } else if (family === "pbr") {
        view = createPbrNoColorMaterialView(material as Parameters<PbrNoColorFactory>[0]);
    } else if (family === "node") {
        view = createNodeNoColorMaterialView(material as Parameters<NodeNoColorFactory>[0]);
    } else if (family === "shader") {
        // Custom ShaderMaterial caster: the shader pipeline drops its fragment stage for the depth-only
        // target on its own, so the view just hands it a private system UBO (the pass-camera VP).
        view = createShaderNoColorMaterialView(material as Parameters<typeof createShaderNoColorMaterialView>[0]);
    }
    cache.set(material, view!);
    return view!;
}
