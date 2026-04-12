/**
 * glTF PBR material assembly:
 * - Extracts material properties from glTF material definitions
 * - Resolves textures (baseColor, normal, ORM, emissive, specGloss)
 * - Handles alpha modes and double-sided flag
 * - Supports KHR_materials_pbrSpecularGlossiness extension
 */
import { resolveImage } from "./gltf-parser.js";

/** Parsed PBR material data. */
export interface GltfMaterialData {
    baseColorFactor: [number, number, number, number];
    metallicFactor: number;
    roughnessFactor: number;
    emissiveFactor: [number, number, number];
    baseColorImage: ImageBitmap | null;
    metallicRoughnessImage: ImageBitmap | null;
    normalImage: ImageBitmap | null;
    occlusionImage: ImageBitmap | null;
    emissiveImage: ImageBitmap | null;
    /** KHR_materials_pbrSpecularGlossiness: specular+glossiness texture. */
    specGlossImage: ImageBitmap | null;
    /** Whether material is double-sided. */
    doubleSided: boolean;
    /** glTF alphaMode: "OPAQUE" (default), "BLEND", or "MASK". */
    alphaMode: string;
    /** glTF alphaCutoff for MASK mode (default 0.5). */
    alphaCutoff: number;
}

/** Assemble a PBR material from a glTF material definition. */
export async function assembleMaterial(json: any, binChunk: DataView, materialIdx: number, baseUrl: string): Promise<GltfMaterialData> {
    const mat = json.materials?.[materialIdx];
    if (!mat) {
        return {
            baseColorFactor: [1, 1, 1, 1],
            metallicFactor: 1,
            roughnessFactor: 1,
            emissiveFactor: [0, 0, 0],
            baseColorImage: null,
            metallicRoughnessImage: null,
            normalImage: null,
            occlusionImage: null,
            emissiveImage: null,
            specGlossImage: null,
            doubleSided: false,
            alphaMode: "OPAQUE",
            alphaCutoff: 0.5,
        };
    }

    const pbr = mat.pbrMetallicRoughness ?? {};
    const specGlossExt = mat.extensions?.KHR_materials_pbrSpecularGlossiness;

    const getTexImage = (texInfo: any) => {
        if (!texInfo) {
            return Promise.resolve(null);
        }
        const tex = json.textures[texInfo.index];
        return resolveImage(json, binChunk, tex.source, baseUrl);
    };

    // If spec-gloss extension present, use its diffuseTexture as baseColor
    const baseColorTexInfo = specGlossExt?.diffuseTexture ?? pbr.baseColorTexture;
    const specGlossTexInfo = specGlossExt?.specularGlossinessTexture ?? null;

    const [baseColorImg, mrImg, normalImg, occlusionImg, emissiveImg, specGlossImg] = await Promise.all([
        getTexImage(baseColorTexInfo),
        getTexImage(pbr.metallicRoughnessTexture),
        getTexImage(mat.normalTexture),
        getTexImage(mat.occlusionTexture),
        getTexImage(mat.emissiveTexture),
        getTexImage(specGlossTexInfo),
    ]);

    return {
        baseColorFactor: specGlossExt?.diffuseFactor ?? pbr.baseColorFactor ?? [1, 1, 1, 1],
        metallicFactor: pbr.metallicFactor ?? 1,
        roughnessFactor: pbr.roughnessFactor ?? 1,
        emissiveFactor: mat.emissiveFactor ?? [0, 0, 0],
        baseColorImage: baseColorImg,
        metallicRoughnessImage: mrImg,
        normalImage: normalImg,
        occlusionImage: occlusionImg,
        emissiveImage: emissiveImg,
        specGlossImage: specGlossImg,
        doubleSided: !!mat.doubleSided,
        alphaMode: mat.alphaMode ?? "OPAQUE",
        alphaCutoff: mat.alphaCutoff ?? 0.5,
    };
}
