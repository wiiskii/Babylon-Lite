/** High-level Mesh — position/rotation/scaling + material + GPU geometry.
 *  Plain data (no scene reference). The scene collects meshes via scene.add(). */

import type { Mat4 } from "../math/types.js";
import { mat4Compose, mat4Translation, mat4Identity } from "../math/mat4.js";
import type { StandardMaterialProps } from "../material/standard/standard-material.js";
import type { PbrMaterialProps } from "../material/pbr/pbr-material.js";
import type { SkeletonData, MorphTargetData } from "../animation/types.js";
import { ObservableVec3 } from "../math/observable-vec3.js";
import type { ThinInstanceData } from "./thin-instance.js";
import type { IWorldMatrixProvider } from "../scene/parentable.js";
import { createWorldMatrixState } from "../scene/world-matrix-state.js";

// ─── Mesh GPU Geometry ───────────────────────────────────────────────

/** Opaque GPU geometry handle (user never touches these). */
export interface MeshGPU {
    readonly positionBuffer: GPUBuffer;
    readonly normalBuffer: GPUBuffer;
    readonly tangentBuffer?: GPUBuffer | null;
    readonly uvBuffer: GPUBuffer;
    readonly uv2Buffer?: GPUBuffer | null;
    readonly indexBuffer: GPUBuffer;
    readonly indexCount: number;
    readonly indexFormat: GPUIndexFormat;
}

// ─── Mesh ────────────────────────────────────────────────────────────

/** A renderable mesh — plain data with transform, material, and GPU geometry.
 *  Works with both standard and PBR pipelines; routing is based on material type. */
export interface Mesh {
    name: string;
    /** Unique ID from source file (e.g. .babylon). Used for light include/exclude filtering. */
    id?: string;
    position: ObservableVec3;
    rotation: ObservableVec3;
    scaling: ObservableVec3;
    material: StandardMaterialProps | PbrMaterialProps;
    receiveShadows: boolean;
    /** World-space bounding box (set by loaders for camera framing). */
    boundMin?: [number, number, number];
    boundMax?: [number, number, number];
    /** Skeleton GPU data (skeletal animation). Type-only — no module dependency. */
    skeleton?: SkeletonData | null;
    /** Morph target GPU data. Type-only — no module dependency. */
    morphTargets?: MorphTargetData | null;
    /** User-controlled render order. Lower = drawn first within phase.
     *  Only affects ordering within the opaque or transparent phase. */
    renderOrder?: number;
    /** Thin instance data (CPU-side). GPU buffer managed by render system. */
    thinInstances?: ThinInstanceData | null;
    // IWorldMatrixProvider + IParentable (installed by initMeshTransform)
    parent: IWorldMatrixProvider | null;
    readonly worldMatrix: Mat4;
    readonly worldMatrixVersion: number;
}

/** @internal Mesh with internal GPU fields — for engine/renderable code only. Not re-exported from index.ts. */
export interface MeshInternal extends Mesh {
    _materialDirty: boolean;
    readonly _gpu: MeshGPU;
    _cpuPositions?: Float32Array;
    _cpuNormals?: Float32Array;
    _cpuUvs?: Float32Array;
    _cpuIndices?: Uint32Array;
}

/** Wire ObservableVec3 position/rotation/scaling onto a partially-built mesh object.
 *  Used by all mesh creation paths (factories, loaders). */
export function initMeshTransform(mesh: Mesh, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): void {
    function meshLocalMatrix(): Mat4 {
        const ppx = mesh.position.x,
            ppy = mesh.position.y,
            ppz = mesh.position.z;
        const rrx = mesh.rotation.x,
            rry = mesh.rotation.y,
            rrz = mesh.rotation.z;
        const ssx = mesh.scaling.x,
            ssy = mesh.scaling.y,
            ssz = mesh.scaling.z;

        // Fast path: no rotation → translation × scale
        if (rrx === 0 && rry === 0 && rrz === 0) {
            if (ssx === 1 && ssy === 1 && ssz === 1) {
                return mat4Translation(ppx, ppy, ppz);
            }
            const m = mat4Identity();
            m[0] = ssx;
            m[5] = ssy;
            m[10] = ssz;
            m[12] = ppx;
            m[13] = ppy;
            m[14] = ppz;
            return m;
        }

        // Euler XYZ → quaternion → compose
        const cx = Math.cos(rrx * 0.5),
            sx2 = Math.sin(rrx * 0.5);
        const cy = Math.cos(rry * 0.5),
            sy2 = Math.sin(rry * 0.5);
        const cz = Math.cos(rrz * 0.5),
            sz2 = Math.sin(rrz * 0.5);
        const qx = sx2 * cy * cz + cx * sy2 * sz2;
        const qy = cx * sy2 * cz - sx2 * cy * sz2;
        const qz = cx * cy * sz2 + sx2 * sy2 * cz;
        const qw = cx * cy * cz - sx2 * sy2 * sz2;
        return mat4Compose(ppx, ppy, ppz, qx, qy, qz, qw, ssx, ssy, ssz);
    }

    const wm = createWorldMatrixState(meshLocalMatrix);
    const onDirty = () => wm.markLocalDirty();

    mesh.position = new ObservableVec3(px, py, pz, onDirty);
    mesh.rotation = new ObservableVec3(rx, ry, rz, onDirty);
    mesh.scaling = new ObservableVec3(sx, sy, sz, onDirty);

    Object.defineProperty(mesh, "parent", {
        get() {
            return wm.parent;
        },
        set(v) {
            wm.parent = v;
        },
        configurable: true,
        enumerable: true,
    });
    Object.defineProperty(mesh, "worldMatrix", {
        get() {
            return wm.getWorldMatrix();
        },
        configurable: true,
        enumerable: false,
    });
    Object.defineProperty(mesh, "worldMatrixVersion", {
        get() {
            return wm.getWorldMatrixVersion();
        },
        configurable: true,
        enumerable: false,
    });
}

// ─── GPU Geometry Upload ─────────────────────────────────────────────

/** Upload typed arrays to GPU buffers and return a MeshGPU handle. */
export function uploadMeshToGPU(device: GPUDevice, positions: Float32Array, normals: Float32Array, indices: Uint32Array, uvs?: Float32Array, uvs2?: Float32Array): MeshGPU {
    const positionBuffer = createGpuBuffer(device, positions, GPUBufferUsage.VERTEX);
    const normalBuffer = createGpuBuffer(device, normals, GPUBufferUsage.VERTEX);
    const indexBuffer = createGpuBuffer(device, indices, GPUBufferUsage.INDEX);

    // UVs: use provided or create zero-filled buffer
    let uvBuffer: GPUBuffer;
    if (uvs && uvs.length > 0) {
        uvBuffer = createGpuBuffer(device, uvs, GPUBufferUsage.VERTEX);
    } else {
        uvBuffer = device.createBuffer({
            size: (positions.length / 3) * 8,
            usage: GPUBufferUsage.VERTEX,
            mappedAtCreation: true,
        });
        uvBuffer.unmap();
    }

    // UV2: only create if provided
    let uv2Buffer: GPUBuffer | null = null;
    if (uvs2 && uvs2.length > 0) {
        uv2Buffer = createGpuBuffer(device, uvs2, GPUBufferUsage.VERTEX);
    }

    return {
        positionBuffer,
        normalBuffer,
        uvBuffer,
        uv2Buffer,
        indexBuffer,
        indexCount: indices.length,
        indexFormat: "uint32",
    };
}

function createGpuBuffer(device: GPUDevice, data: ArrayBufferView, usage: GPUBufferUsageFlags): GPUBuffer {
    const buf = device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
    new Uint8Array(buf.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    buf.unmap();
    return buf;
}
