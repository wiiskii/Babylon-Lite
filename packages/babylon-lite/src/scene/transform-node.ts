/** TransformNode — a live scene graph node with TRS, parent, and children.
 *
 *  Implements IWorldMatrixProvider (can be a parent) and IParentable (can have a parent).
 *  Uses shared createWorldMatrixState for version-based lazy caching.
 *  Position/scaling use ObservableVec3, rotation uses ObservableQuat. */

import type { Mat4 } from "../math/types.js";
import type { Mesh } from "../mesh/mesh.js";
import type { MeshInternal } from "../mesh/mesh.js";
import { initMeshTransform } from "../mesh/mesh.js";
import type { IWorldMatrixProvider, IParentable } from "./parentable.js";
import { mat4Compose, mat4Identity } from "../math/mat4.js";
import { ObservableVec3 } from "../math/observable-vec3.js";
import { ObservableQuat } from "../math/observable-quat.js";
import { createWorldMatrixState } from "./world-matrix-state.js";

export interface TransformNode extends IWorldMatrixProvider, IParentable {
    name: string;
    position: ObservableVec3;
    rotationQuaternion: ObservableQuat;
    scaling: ObservableVec3;
    children: (TransformNode | Mesh)[];
    parent: IWorldMatrixProvider | null;
    readonly worldMatrix: Mat4;
    readonly worldMatrixVersion: number;
}

/** Create a TransformNode with TRS values and lazy world matrix. */
export function createTransformNode(name: string, px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0, qw = 1, sx = 1, sy = 1, sz = 1): TransformNode {
    const wm = createWorldMatrixState(() => {
        const p = node.position,
            r = node.rotationQuaternion,
            s = node.scaling;
        const isIdentity = p.x === 0 && p.y === 0 && p.z === 0 && r.x === 0 && r.y === 0 && r.z === 0 && r.w === 1 && s.x === 1 && s.y === 1 && s.z === 1;
        return isIdentity ? mat4Identity() : mat4Compose(p.x, p.y, p.z, r.x, r.y, r.z, r.w, s.x, s.y, s.z);
    });

    const onDirty = () => wm.markLocalDirty();

    const node: TransformNode = {
        name,
        position: new ObservableVec3(px, py, pz, onDirty),
        rotationQuaternion: new ObservableQuat(qx, qy, qz, qw, onDirty),
        scaling: new ObservableVec3(sx, sy, sz, onDirty),
        children: [],

        get parent() {
            return wm.parent;
        },
        set parent(v) {
            wm.parent = v;
        },
        get worldMatrix() {
            return wm.getWorldMatrix();
        },
        get worldMatrixVersion() {
            return wm.getWorldMatrixVersion();
        },
    };
    return node;
}

/** Deep-clone a TransformNode tree. Meshes are shallow-cloned (shared GPU buffers). */
export function cloneTransformNode(src: TransformNode): TransformNode {
    const clone = createTransformNode(
        src.name + "_clone",
        src.position.x,
        src.position.y,
        src.position.z,
        src.rotationQuaternion.x,
        src.rotationQuaternion.y,
        src.rotationQuaternion.z,
        src.rotationQuaternion.w,
        src.scaling.x,
        src.scaling.y,
        src.scaling.z
    );
    for (const child of src.children) {
        if (isTransformNode(child)) {
            const childClone = cloneTransformNode(child);
            childClone.parent = clone;
            clone.children.push(childClone);
        } else {
            const mesh = child as Mesh;
            const mi = mesh as MeshInternal;
            const meshClone = {
                ...mesh,
                name: mesh.name + "_clone",
                _materialDirty: false,
                _gpu: { ...mi._gpu },
            } as unknown as MeshInternal;
            initMeshTransform(
                meshClone,
                mesh.position.x,
                mesh.position.y,
                mesh.position.z,
                mesh.rotation.x,
                mesh.rotation.y,
                mesh.rotation.z,
                mesh.scaling.x,
                mesh.scaling.y,
                mesh.scaling.z
            );
            meshClone.parent = clone;
            clone.children.push(meshClone);
        }
    }
    return clone;
}

/** Recursively collect all meshes in a subtree.
 *  Sets parent links so world matrices propagate through the hierarchy. */
export function collectMeshes(node: TransformNode, parentProvider?: IWorldMatrixProvider): Mesh[] {
    if (parentProvider) {
        node.parent = parentProvider;
    }
    const result: Mesh[] = [];
    for (const child of node.children) {
        if (isTransformNode(child)) {
            child.parent = node;
            result.push(...collectMeshes(child, node));
        } else {
            const mesh = child as Mesh;
            mesh.parent = node;
            result.push(mesh);
        }
    }
    return result;
}

/** Check if an object is a TransformNode (duck-typed). */
export function isTransformNode(obj: unknown): obj is TransformNode {
    return typeof obj === "object" && obj !== null && "children" in obj && "rotationQuaternion" in obj && !("_gpu" in obj);
}
