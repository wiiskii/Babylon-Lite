/** Opt-in auto-dirty tracking for material properties.
 *
 *  Import and call `enableMaterialTracking(material)` to install property
 *  setters that automatically set `_uboDirty = true` on any mutation —
 *  including in-place array writes like `material.diffuseColor[0] = 0.5`.
 *
 *  The PBR and Standard tracking logic is dynamically imported so only the
 *  relevant code is bundled. Scenes using only PBR materials never pull in
 *  Standard tracking code, and vice versa. */

/** Enable automatic dirty tracking on a PBR or Standard material.
 *  After calling this, any property mutation auto-sets _uboDirty. */
export async function enableMaterialTracking(material: { _uboDirty?: boolean; specularPower?: unknown }): Promise<void> {
    if ("specularPower" in material) {
        const { installStdTracking } = await import("./tracking/std-tracking.js");
        installStdTracking(material as any);
    } else {
        const { installPbrTracking } = await import("./tracking/pbr-tracking.js");
        installPbrTracking(material as any);
    }
}
