/**
 * Build Bundle Scenes — builds each lab scene as a standalone, tree-shaken,
 * minified production bundle into apps/manual-lab/public/bundle/.
 *
 * The "Bundle" tab in the lab gallery loads these pre-built files directly,
 * showing what a real consumer gets after tree-shaking + minification.
 *
 * Also writes manifest.json with per-scene sizes for the gallery UI.
 *
 * Usage: npx tsx scripts/build-bundle-scenes.ts
 */
import { buildBundleScenes } from './bundle-scenes-core';

buildBundleScenes().catch((err) => { console.error(err); process.exit(1); });
