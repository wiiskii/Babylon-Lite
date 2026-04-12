/** Dispose test — creates a scene, renders one frame, disposes everything,
 *  then recreates to prove no stale state. Tracks GPU errors via error scopes. */

import { createEngine, createSceneContext, createDefaultCamera, createSphere, createStandardMaterial } from "babylon-lite";
import type { EngineInternal } from "babylon-lite/engine/engine";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const gpuErrors: string[] = [];
(window as any).gpuErrors = gpuErrors;

async function createAndRender() {
    const engine = await createEngine(canvas);

    // Push an error scope to capture GPU validation errors
    (engine as EngineInternal).device.pushErrorScope("validation");

    const scene = createSceneContext(engine);
    const sphere = createSphere(engine);
    sphere.material = createStandardMaterial();
    scene.add(sphere);
    createDefaultCamera(scene);

    // Render one frame
    await engine.start(scene);

    // Stop and wait a tick for GPU work to complete
    engine.stop();
    await new Promise((r) => setTimeout(r, 100));

    // Check for GPU errors before dispose
    const preError = await (engine as EngineInternal).device.popErrorScope();
    if (preError) {
        gpuErrors.push("pre-dispose: " + preError.message);
    }

    // Push another scope for dispose
    (engine as EngineInternal).device.pushErrorScope("validation");

    // Dispose everything
    scene.dispose();
    engine.dispose();

    return { engine, scene };
}

async function run() {
    try {
        // First create/dispose cycle
        await createAndRender();
        (window as any).disposed = true;

        // Second create/dispose cycle — proves no stale state
        const engine2 = await createEngine(canvas);
        (engine2 as EngineInternal).device.pushErrorScope("validation");
        const scene2 = createSceneContext(engine2);
        const sphere2 = createSphere(engine2);
        sphere2.material = createStandardMaterial();
        scene2.add(sphere2);
        createDefaultCamera(scene2);
        await engine2.start(scene2);
        engine2.stop();
        await new Promise((r) => setTimeout(r, 100));
        const err2 = await (engine2 as EngineInternal).device.popErrorScope();
        if (err2) {
            gpuErrors.push("recreate: " + err2.message);
        }
        scene2.dispose();
        engine2.dispose();

        (window as any).recreated = true;
        (window as any).ready = true;
        canvas.dataset.ready = "true";
    } catch (e: any) {
        gpuErrors.push("exception: " + e.message);
        (window as any).ready = true;
        canvas.dataset.ready = "true";
    }
}

void run();
