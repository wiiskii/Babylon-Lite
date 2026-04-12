/**
 * GPU Resource Pool — ref-counted textures + deduplicated samplers.
 *
 * Texture ref counting: acquire increments, release decrements.
 * When count hits 0 the GPUTexture is destroyed.
 *
 * Sampler pool: identical descriptors return the same GPUSampler.
 */

import type { Texture2D } from "../texture/texture-2d.js";

// ── Texture ref counting ─────────────────────────────────────

const _texRefs = new WeakMap<GPUTexture, number>();

/** Increment ref count on a Texture2D. First acquire sets count to 1. */
export function acquireTexture(tex: Texture2D): void {
    _texRefs.set(tex.texture, (_texRefs.get(tex.texture) ?? 0) + 1);
}

/**
 * Decrement ref count on a Texture2D.
 * Calls `tex.texture.destroy()` when count reaches 0.
 * Returns true if the texture was destroyed.
 */
export function releaseTexture(tex: Texture2D): boolean {
    const c = (_texRefs.get(tex.texture) ?? 1) - 1;
    if (c <= 0) {
        tex.texture.destroy();
        _texRefs.delete(tex.texture);
        return true;
    }
    _texRefs.set(tex.texture, c);
    return false;
}

/** Increment ref count on a raw GPUTexture (for env textures). */
export function acquireGPUTexture(tex: GPUTexture): void {
    _texRefs.set(tex, (_texRefs.get(tex) ?? 0) + 1);
}

/** Decrement ref count on a raw GPUTexture. Destroys at 0. */
export function releaseGPUTexture(tex: GPUTexture): boolean {
    const c = (_texRefs.get(tex) ?? 1) - 1;
    if (c <= 0) {
        tex.destroy();
        _texRefs.delete(tex);
        return true;
    }
    _texRefs.set(tex, c);
    return false;
}

// ── Sampler deduplication ────────────────────────────────────

const _samplerCache = new WeakMap<GPUDevice, Map<string, GPUSampler>>();

function samplerKey(desc: GPUSamplerDescriptor): string {
    return `${desc.minFilter ?? "nearest"}:${desc.magFilter ?? "nearest"}:${desc.mipmapFilter ?? "nearest"}:${desc.addressModeU ?? "clamp-to-edge"}:${desc.addressModeV ?? "clamp-to-edge"}:${desc.addressModeW ?? "clamp-to-edge"}:${desc.maxAnisotropy ?? 1}`;
}

/** Get or create a deduplicated sampler. Same config → same GPUSampler. */
export function getOrCreateSampler(device: GPUDevice, desc: GPUSamplerDescriptor = {}): GPUSampler {
    let dc = _samplerCache.get(device);
    if (!dc) {
        dc = new Map();
        _samplerCache.set(device, dc);
    }
    const key = samplerKey(desc);
    let s = dc.get(key);
    if (!s) {
        s = device.createSampler(desc);
        dc.set(key, s);
    }
    return s;
}

/** Clear sampler cache for a device. */
export function clearSamplerCache(device: GPUDevice): void {
    _samplerCache.delete(device);
}
