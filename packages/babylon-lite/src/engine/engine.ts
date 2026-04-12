import type { SceneContext } from "../scene/scene.js";

/** Handle to the WebGPU engine — public API surface. */
export interface Engine {
    readonly canvas: HTMLCanvasElement;
    readonly msaaSamples: number;

    /** Number of GPU draw calls in the last rendered frame. */
    drawCallCount: number;

    /** Start the render loop for the given scene.
     *  Resolves after the first frame has been rendered. */
    start(scene: SceneContext): Promise<void>;
    /** Stop the render loop. */
    stop(): void;
    /** Resize render targets to match canvas size. */
    resize(): void;
    /** Release all engine-owned GPU resources (render targets, device). */
    dispose(): void;
}

/** @internal Engine with GPU internals exposed. Not re-exported from index.ts. */
export interface EngineInternal extends Engine {
    readonly device: GPUDevice;
    readonly context: GPUCanvasContext;
    readonly format: GPUTextureFormat;
}

interface RenderTargets {
    msaaTexture: GPUTexture;
    msaaView: GPUTextureView;
    depthTexture: GPUTexture;
    depthView: GPUTextureView;
    width: number;
    height: number;
}

/** Create the Babylon Lite engine. Acquires GPU adapter + device, configures swapchain. */
export async function createEngine(canvas: HTMLCanvasElement): Promise<Engine> {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) {
        throw new Error("WebGPU adapter not available");
    }

    const features: GPUFeatureName[] = [];
    if (adapter.features.has("float32-filterable")) {
        features.push("float32-filterable");
    }
    const device = await adapter.requestDevice({ requiredFeatures: features });
    const context = canvas.getContext("webgpu");
    if (!context) {
        throw new Error("WebGPU context not available");
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });

    const msaaSamples = 4;
    let targets = createRenderTargets(device, canvas.width, canvas.height, format, msaaSamples);
    let animFrameId = 0;
    let renderFn: ((now: number) => void) | null = null;

    function resize(): void {
        const w = (canvas.clientWidth * devicePixelRatio) | 0;
        const h = (canvas.clientHeight * devicePixelRatio) | 0;
        if (w === targets.width && h === targets.height) {
            return;
        }
        canvas.width = w;
        canvas.height = h;
        context!.configure({ device, format, alphaMode: "opaque" });
        targets.msaaTexture.destroy();
        targets.depthTexture.destroy();
        targets = createRenderTargets(device, w, h, format, msaaSamples);
    }

    const engine: EngineInternal = {
        device,
        context,
        format,
        canvas,
        msaaSamples,
        drawCallCount: 0,

        start(scene: SceneContext): Promise<void> {
            return new Promise<void>((resolve) => {
                const boot = async () => {
                    // Run deferred builders (entities register these at add/load time)
                    await scene._build();
                    // Split renderables into opaque and transparent
                    for (const r of scene._renderables) {
                        if (r.isTransparent) {
                            scene._transparentRenderables.push(r);
                        } else {
                            scene._opaqueRenderables.push(r);
                        }
                    }
                    // Sort opaque by render order (stable sort)
                    scene._opaqueRenderables.sort((a, b) => a.order - b.order);
                    // Also keep _renderables sorted for pre-passes and legacy consumers
                    scene._renderables.sort((a, b) => a.order - b.order);

                    let lastTime = 0;
                    let firstFrame = true;
                    renderFn = (now: number) => {
                        // First frame: delta=0 (matches Babylon.js _localDelayOffset which
                        // absorbs the first accumulated deltaTime, so frame 1 evaluates at t=0)
                        const delta = firstFrame ? 0 : scene._fixedDeltaMs > 0 ? scene._fixedDeltaMs : lastTime > 0 ? now - lastTime : 16.667;
                        lastTime = now;
                        resize();
                        for (const cb of scene._beforeRender) {
                            cb(delta);
                        }
                        if (scene._materialSwapQueue.length > 0) {
                            scene._processMaterialSwaps();
                        }
                        renderFrame(engine, targets, scene);
                        if (firstFrame) {
                            firstFrame = false;
                            resolve();
                        }
                        animFrameId = requestAnimationFrame(renderFn!);
                    };
                    animFrameId = requestAnimationFrame(renderFn);
                };
                void boot();
            });
        },

        stop() {
            if (animFrameId) {
                cancelAnimationFrame(animFrameId);
            }
            animFrameId = 0;
            renderFn = null;
        },

        resize,

        dispose() {
            engine.stop();
            targets.msaaTexture.destroy();
            targets.depthTexture.destroy();
            context.unconfigure();
            // Pipeline caches auto-clear on device change (no side-effect registry needed)
            device.destroy();
        },
    };

    return engine;
}

function createRenderTargets(device: GPUDevice, width: number, height: number, format: GPUTextureFormat, sampleCount: number): RenderTargets {
    const msaaTexture = device.createTexture({
        size: { width, height },
        format,
        sampleCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const depthTexture = device.createTexture({
        size: { width, height },
        format: "depth24plus-stencil8",
        sampleCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    return {
        msaaTexture,
        msaaView: msaaTexture.createView(),
        depthTexture,
        depthView: depthTexture.createView(),
        width,
        height,
    };
}

function renderFrame(engine: EngineInternal, targets: RenderTargets, scene: SceneContext): void {
    const swapChainView = engine.context.getCurrentTexture().createView();
    const encoder = engine.device.createCommandEncoder();

    // Pre-passes: shadow maps from lights that have shadow generators
    let drawCalls = 0;
    for (const light of scene.lights) {
        const sg = light.shadowGenerator;
        if (sg) {
            drawCalls += sg.renderShadowMap(encoder);
        }
    }
    // Additional pre-passes (compute, etc.)
    for (const pp of scene._prePasses) {
        drawCalls += pp.execute(encoder, engine);
    }

    // Update scene uniforms (one per shared UBO)
    for (const u of scene._uniformUpdaters) {
        u.update(engine);
    }

    // Update per-mesh UBOs (world matrices) for dynamic transforms
    for (const r of scene._opaqueRenderables) {
        if (r.updateUBOs) {
            r.updateUBOs();
        }
    }
    for (const r of scene._transparentRenderables) {
        if (r.updateUBOs) {
            r.updateUBOs();
        }
    }

    // Per-frame transparent sort by camera distance (back-to-front)
    const cam = scene.camera;
    if (scene._transparentRenderables.length > 1 && cam) {
        const camPos = cam.getPosition();
        const cx = camPos.x,
            cy = camPos.y,
            cz = camPos.z;
        for (const r of scene._transparentRenderables) {
            if (r._worldCenter) {
                const [wx, wy, wz] = r._worldCenter;
                r._sortDistance = (wx - cx) ** 2 + (wy - cy) ** 2 + (wz - cz) ** 2;
            }
        }
        scene._transparentRenderables.sort((a, b) => (b._sortDistance ?? 0) - (a._sortDistance ?? 0) || a.order - b.order);
    }

    const pass = encoder.beginRenderPass({
        colorAttachments: [
            {
                view: targets.msaaView,
                resolveTarget: swapChainView,
                clearValue: scene.clearColor,
                loadOp: "clear",
                storeOp: "store",
            },
        ],
        depthStencilAttachment: {
            view: targets.depthView,
            depthClearValue: 1.0,
            depthLoadOp: "clear",
            depthStoreOp: "store",
            stencilClearValue: 0,
            stencilLoadOp: "clear",
            stencilStoreOp: "store",
        },
    });

    pass.setViewport(0, 0, targets.width, targets.height, 0, 1);

    let lp: GPURenderPipeline | null = null;
    let lb: GPUBindGroup | null = null;
    const draw = (list: typeof scene._opaqueRenderables) => {
        for (const r of list) {
            if (r._pipeline && r._pipeline !== lp) {
                pass.setPipeline(r._pipeline);
                lp = r._pipeline;
            }
            if (r._sceneBG && r._sceneBG !== lb) {
                pass.setBindGroup(0, r._sceneBG);
                lb = r._sceneBG;
            }
            drawCalls += r.draw(pass, engine);
        }
    };
    draw(scene._opaqueRenderables);
    draw(scene._transparentRenderables);

    pass.end();
    engine.device.queue.submit([encoder.finish()]);
    engine.drawCallCount = drawCalls;
}
