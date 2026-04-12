/** Parenting interfaces — zero entity imports, zero runtime code.
 *
 *  IWorldMatrixProvider is the contract a parent exposes.
 *  IParentable is the contract a child exposes.
 *  Any combination is valid: mesh→mesh, light→mesh, camera→transformNode, etc. */

import type { Mat4 } from "../math/types.js";

/** Any object that provides a world-space transformation matrix.
 *  Implementations compute lazily on property access (getter). */
export interface IWorldMatrixProvider {
    /** World-space 4×4 column-major matrix. May trigger lazy recomputation. */
    readonly worldMatrix: Mat4;
    /** Monotonically increasing counter — bumped each time worldMatrix recomputes.
     *  Children snapshot this value to detect when their parent has changed. */
    readonly worldMatrixVersion: number;
}

/** Any object that can be attached to a parent in the scene hierarchy.
 *  When parent is null, position/rotation/scaling are in world space. */
export interface IParentable {
    parent: IWorldMatrixProvider | null;
}
