import type { EnvironmentTextures } from "./load-env.js";
import { polynomialToPreScaledHarmonics } from "./load-env.js";
import { getOrCreateSampler } from "../resource/gpu-pool.js";

/** Create the standard sampler pair used by all environment loaders */
export function createEnvSamplers(device: GPUDevice): { cubeSampler: GPUSampler; brdfSampler: GPUSampler } {
    return {
        cubeSampler: getOrCreateSampler(device, { magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" }),
        brdfSampler: getOrCreateSampler(device, { magFilter: "linear", minFilter: "linear" }),
    };
}

/** Assemble the EnvironmentTextures object from pre-computed components */
export function assembleEnvironmentTextures(
    specularCube: GPUTexture,
    brdfLut: GPUTexture,
    irradianceSH: Float32Array,
    lodGenerationScale: number,
    device: GPUDevice
): EnvironmentTextures {
    const { cubeSampler, brdfSampler } = createEnvSamplers(device);
    return {
        specularCube,
        specularCubeView: specularCube.createView({ dimension: "cube" }),
        brdfLut,
        brdfLutView: brdfLut.createView(),
        cubeSampler,
        brdfSampler,
        irradianceSH,
        sphericalHarmonics: polynomialToPreScaledHarmonics(irradianceSH),
        lodGenerationScale,
    };
}
