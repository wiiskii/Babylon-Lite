import type { PickingInfo } from "./picking-info.js";
import type { MeshInternal } from "../mesh/mesh.js";

/**
 * Get the interpolated normal at the picked point.
 * Requires detailed picking (faceId >= 0) and mesh._cpuNormals.
 * @param useWorldCoordinates - if true, transform normal by world matrix (default: false)
 */
export function getPickedNormal(info: PickingInfo, useWorldCoordinates = false): [number, number, number] | null {
    const mi = info.pickedMesh as MeshInternal | undefined;
    if (info.faceId < 0 || !mi || !mi._cpuNormals || !mi._cpuIndices) {
        return null;
    }

    const normals = mi._cpuNormals;
    const indices = mi._cpuIndices;
    const face = info.faceId;

    const i0 = indices[face * 3]!;
    const i1 = indices[face * 3 + 1]!;
    const i2 = indices[face * 3 + 2]!;

    // Barycentric interpolation: P = (1 - bu - bv) * N0 + bu * N1 + bv * N2
    const w = 1 - info.bu - info.bv;
    const nx = w * normals[i0 * 3]! + info.bu * normals[i1 * 3]! + info.bv * normals[i2 * 3]!;
    const ny = w * normals[i0 * 3 + 1]! + info.bu * normals[i1 * 3 + 1]! + info.bv * normals[i2 * 3 + 1]!;
    const nz = w * normals[i0 * 3 + 2]! + info.bu * normals[i1 * 3 + 2]! + info.bv * normals[i2 * 3 + 2]!;

    // Normalize
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-10) {
        return [0, 1, 0];
    }
    const invLen = 1 / len;

    if (!useWorldCoordinates) {
        return [nx * invLen, ny * invLen, nz * invLen];
    }

    // Transform by world matrix (upper-left 3x3, then normalize)
    const wm = mi.worldMatrix;
    const wnx = wm[0]! * nx + wm[4]! * ny + wm[8]! * nz;
    const wny = wm[1]! * nx + wm[5]! * ny + wm[9]! * nz;
    const wnz = wm[2]! * nx + wm[6]! * ny + wm[10]! * nz;
    const wLen = Math.sqrt(wnx * wnx + wny * wny + wnz * wnz);
    if (wLen < 1e-10) {
        return [0, 1, 0];
    }
    const wInvLen = 1 / wLen;
    return [wnx * wInvLen, wny * wInvLen, wnz * wInvLen];
}

/**
 * Get the interpolated UV coordinates at the picked point.
 * Requires detailed picking (faceId >= 0) and mesh._cpuUvs.
 */
export function getPickedUV(info: PickingInfo): [number, number] | null {
    const mi = info.pickedMesh as MeshInternal | undefined;
    if (info.faceId < 0 || !mi || !mi._cpuUvs || !mi._cpuIndices) {
        return null;
    }

    const uvs = mi._cpuUvs;
    const indices = mi._cpuIndices;
    const face = info.faceId;

    const i0 = indices[face * 3]!;
    const i1 = indices[face * 3 + 1]!;
    const i2 = indices[face * 3 + 2]!;

    const w = 1 - info.bu - info.bv;
    const u = w * uvs[i0 * 2]! + info.bu * uvs[i1 * 2]! + info.bv * uvs[i2 * 2]!;
    const v = w * uvs[i0 * 2 + 1]! + info.bu * uvs[i1 * 2 + 1]! + info.bv * uvs[i2 * 2 + 1]!;

    return [u, v];
}
