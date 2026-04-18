/** Per-mesh PBR feature-flag computation.
 *
 *  Pure function shared by pbr-renderable (initial build) and
 *  pbr-single-rebuild (material swap) so the feature detection logic
 *  lives in exactly one place.
 */

import type { Mesh } from "../../mesh/mesh.js";
import type { SceneContext } from "../../scene/scene.js";
import type { PbrMaterialProps, SheenProps, ClearCoatProps } from "./pbr-material.js";
import {
    computePbrFeatures,
    PBR_HAS_SKELETON_8,
    PBR_HAS_SPECULAR_AA,
    PBR_HAS_SHEEN_TEXTURE,
    PBR_HAS_SHEEN_ALBEDO_SCALING,
    PBR_HAS_RECEIVE_SHADOWS,
    PBR_HAS_GAMMA_ALBEDO,
    PBR_HAS_THIN_INSTANCES,
    PBR_HAS_INSTANCE_COLOR,
    PBR2_CC_INT_MAP,
    PBR2_CC_ROUGH_MAP,
    PBR2_CC_NORMAL_MAP,
    PBR2_CC_F0_REMAP_OFF,
} from "./pbr-pipeline.js";
import {
    getLightTypeFeatureBits,
    _getSubsurfaceExt,
    PBR_HAS_OCCLUSION,
    PBR_HAS_CLEARCOAT,
    PBR_HAS_SHEEN,
    PBR_HAS_USE_ALPHA_ONLY_MR,
    PBR_HAS_ANISOTROPY,
    PBR_HAS_SKYBOX,
} from "./pbr-flags.js";

/** Scene-level context cached once by the caller (all constant across meshes). */
export interface PbrFeatureCtx {
    hasEnv: boolean;
    hasTonemap: boolean;
    hasSomeShadows: boolean;
}

/** Compute the `(features, features2)` bit pair for a single PBR mesh. */
export function computeMeshPbrFeatures(mesh: Mesh, scene: SceneContext, ctx: PbrFeatureCtx): { features: number; features2: number } {
    const mat = mesh.material as PbrMaterialProps;
    const mi = mesh as import("../../mesh/mesh.js").MeshInternal;
    const hasTangents = !!mi._gpu.tangentBuffer;
    const hasSkeleton = !!mesh.skeleton;
    const hasMorphTargets = !!mesh.morphTargets;
    const hasAlphaBlend = mat.alphaBlend === true || (mat.alpha !== undefined && mat.alpha < 1);

    let features = computePbrFeatures(
        hasTangents,
        !!mat.emissiveTexture,
        ctx.hasEnv,
        hasSkeleton,
        ctx.hasTonemap,
        hasMorphTargets,
        hasAlphaBlend,
        !!mat.specGlossTexture,
        !!mat.doubleSided,
        !!mat.normalTexture,
        !!mat.metallicReflectanceTexture,
        !!mat.reflectanceTexture,
        !!mat.emissiveColor
    );
    if (mat.useOnlyMetallicFromMetallicReflectanceTexture) {
        features |= PBR_HAS_USE_ALPHA_ONLY_MR;
    }
    features |= getLightTypeFeatureBits();
    if ((mat.occlusionStrength ?? 1.0) > 0) {
        features |= PBR_HAS_OCCLUSION;
    }
    if (hasSkeleton && mesh.skeleton?.joints1Buffer) {
        features |= PBR_HAS_SKELETON_8;
    }
    if (mat.enableSpecularAA) {
        features |= PBR_HAS_SPECULAR_AA;
    }

    let features2 = 0;
    const cc = mat.clearCoat as ClearCoatProps | undefined;
    if (cc?.isEnabled) {
        features |= PBR_HAS_CLEARCOAT;
        if (cc.texture) {
            features2 |= PBR2_CC_INT_MAP;
        }
        if (cc.roughnessTexture) {
            features2 |= PBR2_CC_ROUGH_MAP;
        }
        if (cc.bumpTexture) {
            features2 |= PBR2_CC_NORMAL_MAP;
        }
        if (cc.useF0Remap === false) {
            features2 |= PBR2_CC_F0_REMAP_OFF;
        }
    }

    const sh = mat.sheen as SheenProps | undefined;
    if (sh?.isEnabled) {
        features |= PBR_HAS_SHEEN;
        if (sh.texture) {
            features |= PBR_HAS_SHEEN_TEXTURE;
        }
        if (sh.albedoScaling) {
            features |= PBR_HAS_SHEEN_ALBEDO_SCALING;
        }
    }

    if (mesh.receiveShadows && ctx.hasSomeShadows) {
        features |= PBR_HAS_RECEIVE_SHADOWS;
    }
    if (mat.gammaAlbedo) {
        features |= PBR_HAS_GAMMA_ALBEDO;
    }
    if (mat.anisotropy?.isEnabled) {
        features |= PBR_HAS_ANISOTROPY;
    }
    if (mat.skyboxMode) {
        features |= PBR_HAS_SKYBOX;
    }
    const ssE = _getSubsurfaceExt();
    if (ssE) {
        features |= ssE.detect(mat);
    }
    if (mesh.thinInstances) {
        features |= PBR_HAS_THIN_INSTANCES;
        if (mesh.thinInstances.colors) {
            features |= PBR_HAS_INSTANCE_COLOR;
        }
    }
    // `scene` arg kept for future light-extension hooks.
    void scene;
    return { features, features2 };
}
