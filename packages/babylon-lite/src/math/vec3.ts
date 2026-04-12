import type { Vec3 } from "./types.js";

// --- Constructors ---

export function vec3(x: number, y: number, z: number): Vec3 {
    return { x, y, z };
}

export const Vec3Up: Readonly<Vec3> = { x: 0, y: 1, z: 0 };

// --- Arithmetic (all return new objects — no mutation) ---

export function addVec3(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subVec3(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scaleVec3(v: Vec3, s: number): Vec3 {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function dotVec3(a: Vec3, b: Vec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function crossVec3(a: Vec3, b: Vec3): Vec3 {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

export function lengthVec3(v: Vec3): number {
    return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function normalizeVec3(v: Vec3): Vec3 {
    const len = lengthVec3(v);
    if (len < 1e-10) {
        return { x: 0, y: 0, z: 0 };
    }
    const inv = 1 / len;
    return { x: v.x * inv, y: v.y * inv, z: v.z * inv };
}

export function negateVec3(v: Vec3): Vec3 {
    return { x: -v.x, y: -v.y, z: -v.z };
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
    return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
    };
}

/** Write Vec3 into a Float32Array at the given byte offset (for uniform buffers). */
export function writeVec3(out: Float32Array, offset: number, v: Vec3): void {
    out[offset] = v.x;
    out[offset + 1] = v.y;
    out[offset + 2] = v.z;
}
