import type { EngineContext, RenderingContext } from "../engine/engine.js";
import { _vis, isRenderingContextRegistered, registerRenderingContext, unregisterRenderingContext } from "../engine/engine.js";
import type { SurfaceContext } from "../engine/surface.js";
import type { Camera } from "../camera/camera.js";
import type { LightBase } from "../light/types.js";
import type { Mesh } from "../mesh/mesh.js";
import { disposeMeshGpu } from "../mesh/mesh-dispose.js";
import { registerMeshScene, unregisterMeshScene, enqueueMaterialSwap } from "./mesh-scene-registry.js";
import type { AnimationGroup } from "../animation/animation-group.js";
import type { ShadowGenerator } from "../shadow/shadow-generator.js";
import type { FogConfig } from "../material/standard/standard-material.js";
import type { Renderable, PrePassRenderable, SceneUniformUpdater, MeshGroupBuilder } from "../render/renderable.js";
import type { TransformNode } from "./transform-node.js";
import type { SceneNode } from "./scene-node.js";
import type { EnvironmentTextures } from "../loader-env/load-env.js";
import type { FrameGraph } from "../frame-graph/frame-graph.js";
import { createFrameGraph, _appendTask } from "../frame-graph/frame-graph.js";
import { createRenderTask, type RenderTask } from "../frame-graph/render-task.js";
import { createRenderTarget, disposeRenderTarget, type RenderTarget } from "../engine/render-target.js";
import type { Material, MaterialView } from "../material/material.js";
import { getNoColorView, preloadNoColorViewDispatch } from "../material/no-color-view-dispatch.js";
import type { AssetContainer } from "../asset-container.js";
import type { SceneLightGpuState } from "../render/lights-ubo.js";
import type { ClusteredLightContainer } from "../light/clustered.js";
import type { GaussianSplattingMesh } from "../mesh/GaussianSplatting/gaussian-splatting-mesh.js";

/** Image processing configuration. */
export interface ImageProcessingConfig {
    exposure: number;
    contrast: number;
    toneMappingEnabled: boolean;
    /** "standard" (BJS TONEMAPPING_STANDARD, default) or "aces" (BJS TONEMAPPING_ACES). */
    toneMappingType?: "standard" | "aces";
}

/** A clipping plane expressed as the coefficients `[a, b, c, d]` of `a·x + b·y + c·z + d`. */
export type ClipPlane = readonly [number, number, number, number];

/** Top-level scene context — pure state, no attached methods. */
export interface SceneContext extends RenderingContext {
    /** Surface this scene renders into. Set at scene-creation time and immutable
     *  afterwards — the default render task is sized and MSAA-matched to this surface,
     *  and `registerScene` attaches the scene to it. For the engine's primary surface
     *  (the common single-canvas case) this is the engine itself. The owning engine is
     *  reachable via `scene.surface.engine`. */
    readonly surface: SurfaceContext;
    clearColor: GPUColorDict;
    camera: Camera | null;
    lights: LightBase[];
    imageProcessing: ImageProcessingConfig;

    /** All meshes added to the scene (standard + PBR). */
    meshes: Mesh[];

    /** Animation groups loaded from glTF or created manually. */
    animationGroups: AnimationGroup[];

    /** Fog configuration. Null = no fog. */
    fog: FogConfig | null;

    /** Scene clip plane as (normal.x, normal.y, normal.z, d). Matches Babylon.js Plane `dot(worldPosition, plane) > 0` discard semantics. */
    clipPlane: ClipPlane | null;

    /** Shadow generators registered on this scene. */
    shadowGenerators: ShadowGenerator[];

    /** Background material primaryColor (linear RGB). Default from Babylon createDefaultEnvironment. */
    environmentPrimaryColor?: [number, number, number];

    /** Environment cubemap Y rotation in radians. */
    envRotationY?: number;

    /** Fixed delta time in ms for deterministic animation. 0 = use real rAF delta. */
    fixedDeltaMs: number;

    /** All renderables in this scene. The active frame-graph tasks bucket them
     *  (opaque / direct / transparent) at bind time based on `isTransparent`, `_direct`, and `_transmissive`. */
    /** @internal */
    _renderables: Renderable[];
    /** @internal Pre-pass work (shadow maps, compute, etc.). */
    _prePasses: PrePassRenderable[];
    /** GaussianSplatting meshes attached to this scene.  Populated by
     *  `attachGaussianSplattingMesh`.  Scene-core stays GS-agnostic apart from
     *  this opaque registry (used by `gpu-picker` to iterate GS meshes without
     *  scanning `_renderables`). */
    /** @internal */
    _gsMeshes: GaussianSplattingMesh[];
    /** @internal Scene uniform updaters (one per shared UBO). */
    _uniformUpdaters: SceneUniformUpdater[];
    /** @internal Opt-in feature writers for the SceneUniforms UBO (fog, clip plane, env SH).
     *  Populated lazily via the scene-ubo-extras seam; run by the render task. */
    _sceneUboContributors?: ((data: Float32Array, scene: SceneContext) => void)[];
    /** @internal Per-frame callbacks run before rendering (animation, physics, etc.). */
    _beforeRender: ((deltaMs: number) => void)[];
    /** @internal Deferred builders — registered by loaders/factories, run once at startEngine(). */
    _deferredBuilders: (() => void | Promise<void>)[];
    /** @internal Mesh group registry — maps builder to its mesh list (internal bookkeeping). */
    _groups: Map<MeshGroupBuilder, Mesh[]>;

    // ─── Dispose infrastructure ────────────────────────────────
    /** @internal Shared cleanup callbacks (scene UBOs, lights UBOs, etc.). Registered by builders. */
    _disposables: (() => void)[];
    /** @internal Per-mesh cleanup callbacks (mesh UBOs, bind groups). For material swap + dispose. */
    _meshDisposables: Map<Mesh, (() => void)[]>;
    /** @internal Meshes whose material was changed via setter — drained before each render frame. */
    _materialSwapQueue: Mesh[];
    /** @internal Monotonic counter bumped when the renderable list changes (add/remove/rebuild). */
    _renderableVersion: number;
    /** @internal Lazily-loaded processor; populated on first material reassignment. */
    _processSwaps?: (scene: SceneContext) => void;
    /** True once the initial deferred build (buildScene) has run. Meshes added after
     *  this point are materialized via the per-frame swap drain rather than the
     *  boot-only deferred-builder path. */
    /** @internal */
    _built: boolean;

    // ─── Stashed internal state (typed to avoid `as any` casts) ────
    /** @internal */
    _envTextures?: EnvironmentTextures;
    /** @internal Scene-owned shared LightsUniforms UBO state (group 0 binding 1). */
    _lightGpuState?: SceneLightGpuState;

    /** Frame graph driving this scene's rendering. Created eagerly by
     *  `createSceneContext` with a default `RenderTask` that mirrors
     *  `_renderables` into the swapchain. User code may add additional tasks
     *  (offscreen RTTs, post-FX, UI overlays, etc.). */
    /** @internal */
    _frameGraph: FrameGraph;

    /** @internal Optional clustered point-light container. Only populated by the clustered-light extension API. */
    _clusteredLightContainer?: ClusteredLightContainer;
    /** @internal Updates clustered light cells for the camera used by the current render pass. */
    _clusteredLightUpdater?: (camera: Camera | null | undefined, targetWidth: number, targetHeight: number) => void;
}

/** Options passed to the scene-context factory. */
export interface SceneContextOptions {
    defaultRenderTask?: boolean;
    /** Opt in to an opaque depth pre-pass (early-Z). When true, opaque scene
     *  geometry is rendered depth-only into a shared depth buffer BEFORE the
     *  main opaque colour pass, so the colour pass's fragment shader is skipped
     *  on occluded fragments. Off by default; ignored when `defaultRenderTask`
     *  is `false` (there is no scene colour task to feed). */
    depthPrepass?: boolean;
}

/** Create an empty scene context bound to the given `surface`. The default render task
 *  is built against the surface's format, MSAA configuration, and swapchain RT — the
 *  scene is permanently bound to that surface. Pass `engine` directly (since
 *  `EngineContext extends SurfaceContext`) for the common single-canvas case, or pass
 *  an auxiliary surface created via `createSurface`. */
export function createSceneContext(surface: SurfaceContext, options?: SceneContextOptions): SceneContext {
    const eng = surface.engine;

    // Closures below capture `ctx` by-reference via this object.
    const ctxLocal: Omit<SceneContext, "_frameGraph"> = {
        surface,
        clearColor: { r: 0.2, g: 0.2, b: 0.3, a: 1.0 },
        camera: null,
        lights: [],
        meshes: [],
        animationGroups: [],
        fog: null,
        clipPlane: null,
        shadowGenerators: [],
        imageProcessing: { exposure: 1.0, contrast: 1.0, toneMappingEnabled: false },
        _renderables: [],
        _prePasses: [],
        _gsMeshes: [],
        _uniformUpdaters: [],
        fixedDeltaMs: 0,
        _beforeRender: [],
        _deferredBuilders: [],
        _groups: new Map(),
        _disposables: [],
        _meshDisposables: new Map(),
        _materialSwapQueue: [],
        _renderableVersion: 0,
        _built: false,
        _drawCallsPre: 0,

        _update(): void {
            // When the engine was created with `useFloatingOrigin: true`, mark
            // the active camera so `getViewMatrix` knows to zero its
            // translation column (the GPU view × world product is then the
            // eye-relative result the LWR offset trick produces). For non-LWR
            // engines `eng.useFloatingOrigin` is false and this is a single
            // boolean check per frame — the inner branch is dead.
            if (eng.useFloatingOrigin && ctx.camera && !ctx.camera._useFloatingOrigin) {
                ctx.camera._useFloatingOrigin = true;
                ctx.camera._viewVer = -1;
                ctx.camera._vpVer = -1;
            }
            const d = ctx.fixedDeltaMs > 0 ? ctx.fixedDeltaMs : eng._currentDelta;
            const encoder = eng._currentEncoder;
            let draws = 0;
            for (const cb of ctx._beforeRender) {
                cb(d);
            }
            if (ctx._materialSwapQueue.length > 0) {
                ctx._processSwaps?.(ctx);
            }
            for (const pp of ctx._prePasses) {
                draws += pp.execute(encoder, eng);
            }
            for (const u of ctx._uniformUpdaters) {
                u.update(eng);
            }
            ctx._drawCallsPre = draws;
        },
        _record(): number {
            return ctx._frameGraph.execute();
        },
        _resize(): void {
            // Canvas backing-store changed: rebuild the frame graph so canvas-sized
            // render targets get re-allocated at the new pixel size before the next record.
            ctx._frameGraph.build();
        },
    };

    const ctx = ctxLocal as SceneContext;
    // Eagerly attach the frame graph + a default swapchain render-pass task. The
    // graph drives all GPU work for this scene; user code can add more tasks
    // (offscreen RTTs, post-FX, UI overlays) before/after.
    const fg = createFrameGraph(eng);
    ctx._frameGraph = fg;
    if (options?.defaultRenderTask !== false) {
        // MSAA: render into an MSAA colour RT (which owns depth) and resolve into the
        // single-sample scRT. No MSAA: render straight into the colour-only
        // scRT with a task-owned single-sample depth buffer it builds/clears/frees.
        // All three reads (format / msaaSamples / scRT) come from the bound `surface`.
        const msaa = surface.msaaSamples > 1;
        const samples = msaa ? surface.msaaSamples : 1;
        if (options?.depthPrepass) {
            // ── Opaque depth pre-pass (early-Z) ─────────────────────────────
            // A producer task ("scene-depth-prepass") clears + writes opaque scene
            // depth into a shared depth buffer; the scene colour task then *loads*
            // that exact physical depth texture so its opaque colour fragments
            // early-Z against the pre-written depth (reverse-Z greater-equal: an
            // occluded fragment's depth is < the stored value ⇒ test fails ⇒ the
            // fragment shader is skipped).
            //
            // Depth-sharing idiom mirrors GeometryRendererTask + RenderTask
            // (frame-graph/geometry-renderer-task.ts:282-283,463-468 wires an
            // `_eager` depth wrapper onto a task-owned depth texture, which a
            // later RenderTask consumes via `config.depth` ⇒ `loadOp:"load"`,
            // render-task.ts:218). Here the *producer* owns the real depth RT
            // (non-eager ⇒ built/cleared/resized/disposed by its own RenderTask,
            // render-task.ts:253), and the *consumer* takes an eager wrapper RT
            // re-pointed at that texture each record() (so it loads, never
            // rebuilds/clears/disposes it).
            const sharedDepth = createRenderTarget({ lbl: "scene-depth-prepass", dFormat: "depth24plus-stencil8", samples, size: surface });
            // Eager wrapper: same depth/stencil format + sample count, NO colour
            // format. The scene colour task takes this as `config.depth` ⇒ eager ⇒
            // `loadOp:"load"`; `buildRenderTarget`/`disposeRenderTarget` no-op on it.
            const depthConsumer: RenderTarget = {
                _descriptor: { lbl: "scene-depth-prepass.consumer", dFormat: "depth24plus-stencil8", samples, size: surface },
                _colorTexture: null,
                _colorView: null,
                _depthTexture: null,
                _depthView: null,
                _width: 0,
                _height: 0,
                _eager: true,
                // The texture is owned by `sharedDepth` (the producer RT). Never
                // destroy it through the wrapper.
                _ownsDepthTexture: false,
            };

            // Producer: a colour-less RenderTask whose `rt` IS the shared depth.
            // No colour format ⇒ no colour attachment, and the no-color material
            // pipelines drop their fragment stage (standard-pipeline.ts:201 /
            // pbr-pipeline.ts:131 force depthWrite on for NO_COLOR_OUTPUT). Depth
            // comes via `rt` (not `config.depth`) so `_depthLoadOp` defaults to
            // "clear" (render-task.ts:384) ⇒ this pass clears + writes depth.
            // Reverse-Z is inherited: the RT carries no `_depthCompare`/`_depthClearValue`,
            // so pipelines use REVERSE_DEPTH_COMPARE ("greater-equal") and the
            // attachment clears to 0 (render-target.ts:33,44 defaults). We must NOT
            // copy the shadow-map's forward-Z (less-equal / clear 1).
            const prepassTask = createRenderTask({ name: "scene-depth-prepass", rt: sharedDepth, clrColor: ctx.clearColor }, eng, ctx);
            // One no-color view per source material, reused across re-records.
            const prepassViews = new Map<Material, MaterialView>();
            // Lazily load the no-color view factories for whichever material
            // families the opaque meshes use (mirrors the shadow task's preload,
            // shadow-task.ts:35). registerScene awaits every task's `_preload`
            // before fg.build() runs record(), so the factories are present when
            // syncDepthPrepassMeshes calls getNoColorView.
            prepassTask._preload = async (): Promise<void> => {
                await preloadNoColorViewDispatch(opaqueMeshesForPrepass(ctx));
            };

            // Mirror the producer's freshly-built depth texture onto the eager
            // consumer wrapper. Wraps the producer's record() — the prepass is
            // ordered first in the frame graph, so by the time the scene colour
            // task records (and bakes its depth-attachment view), the wrapper is
            // current. Direct analogue of geometry-renderer-task.ts:463-468.
            const baseRecord = prepassTask.record;
            prepassTask.record = (): void => {
                const queued = syncDepthPrepassMeshes(prepassTask, ctx, prepassViews);
                baseRecord.call(prepassTask);
                if (queued === 0) {
                    // No opaque meshes ⇒ the base record() would otherwise
                    // auto-mirror the WHOLE scene (including transparent meshes)
                    // into this depth pass. Strip those bindings so the prepass
                    // only clears depth and draws nothing.
                    prepassTask._renderables.length = 0;
                    prepassTask._opaqueBindings.length = 0;
                    prepassTask._directBindings.length = 0;
                    prepassTask._transparentBindings.length = 0;
                    prepassTask._opaqueBundles.length = 0;
                    prepassTask._autoFromScene = false;
                }
                depthConsumer._depthTexture = sharedDepth._depthTexture;
                depthConsumer._depthView = sharedDepth._depthView;
                depthConsumer._width = sharedDepth._width;
                depthConsumer._height = sharedDepth._height;
            };

            const rt = msaa ? createRenderTarget({ lbl: "scene-color", format: surface.format, samples: surface.msaaSamples, size: surface }) : surface.scRT;
            // Insert the prepass FIRST, then the scene colour task that consumes
            // its depth. (Shadow tasks, when present, are unshifted ahead of both
            // by registerSceneWithShadowSupport — scene-core.ts ensureShadowTask —
            // which is fine: the prepass only needs to precede the colour task.)
            _appendTask(fg, prepassTask);
            _appendTask(fg, createRenderTask({ name: "scene", rt, rst: msaa ? surface.scRT : undefined, depth: depthConsumer, clrColor: ctx.clearColor }, eng, ctx));
            ctx._disposables.push(() => disposeRenderTarget(sharedDepth));
        } else {
            const rt = msaa
                ? createRenderTarget({ lbl: "scene-color", format: surface.format, dFormat: "depth24plus-stencil8", samples: surface.msaaSamples, size: surface })
                : surface.scRT;
            const depth = msaa ? undefined : createRenderTarget({ lbl: "scene-depth", dFormat: "depth24plus-stencil8", samples: 1, size: surface });
            _appendTask(fg, createRenderTask({ name: "scene", rt, rst: msaa ? surface.scRT : undefined, depth, clrColor: ctx.clearColor }, eng, ctx));
        }
    }
    ctx._disposables.push(() => fg.dispose());
    return ctx;
}

/** Opaque meshes to mirror into the depth pre-pass: every scene renderable the
 *  scene colour task buckets as opaque — i.e. NOT alpha-blended (`isTransparent`)
 *  and NOT transmissive/refractive (`_transmissive`). This reads the SAME flags
 *  the colour task buckets on (render-task.ts:355) off the already-built scene
 *  renderables, so the opaque/transparent split can never drift from the colour
 *  pass. Each opaque renderable's `.mesh` is returned (deduped).
 *
 *  Alpha-tested / discard materials: their source renderable is opaque
 *  (`isTransparent` is false — they don't alpha-BLEND), so they are mirrored
 *  here. The depth-only fragment correctly runs their discard only for
 *  ShaderMaterial (whose no-color view keeps the discard via `depthOnlyFragment`,
 *  shader-pipeline.ts) and Node materials (their no-color view re-emits the
 *  graph). Standard/PBR no-color views drop the WHOLE fragment stage, so an
 *  alpha-tested Standard/PBR mesh would pre-write depth for fully-cut-out
 *  fragments — punching holes the colour pass then can't overdraw. We therefore
 *  EXCLUDE Standard/PBR materials flagged alpha-tested; they fall through to the
 *  colour pass with no early-Z benefit (correct, just unoptimised). PBR's
 *  no-color view already strips PBR_HAS_ALPHA_BLEND, and Standard/PBR alpha-test
 *  depth-only fragments are not wired, so this guard is the safe default. */
function opaqueMeshesForPrepass(scene: SceneContext): Mesh[] {
    const out: Mesh[] = [];
    const seen = new Set<Mesh>();
    for (const r of scene._renderables) {
        if (r.isTransparent || r._transmissive) {
            continue;
        }
        const mesh = r.mesh;
        if (!mesh || seen.has(mesh)) {
            continue;
        }
        const material = mesh.material;
        if (!material) {
            continue;
        }
        const family = material._buildGroup._materialFamily;
        if ((family === "standard" || family === "pbr") && isAlphaTested(material)) {
            continue;
        }
        seen.add(mesh);
        out.push(mesh);
    }
    return out;
}

/** Whether a Standard/PBR material relies on per-fragment alpha discard
 *  (alpha-test: `alphaCutOff > 0`, the field both families key
 *  PBR_HAS_ALPHA_TEST / the discard branch off — standard-material.ts:80,
 *  pbr-material.ts:161). Such materials must NOT be mirrored into the depth
 *  pre-pass with a Standard/PBR no-color view, which drops the fragment stage
 *  and would pre-write depth for cut-out fragments. */
function isAlphaTested(material: Material): boolean {
    const cutOff = (material as Material & { alphaCutOff?: number }).alphaCutOff;
    return (cutOff ?? 0) > 0;
}

/** Re-queue the current opaque meshes onto the depth-prepass task. Runs each
 *  record() (so resize / mesh-add / material-swap rebuilds re-sync), mirroring
 *  how the shadow task re-derives its caster list per record (shadow-task.ts).
 *  Returns the number of meshes queued. */
function syncDepthPrepassMeshes(task: RenderTask, scene: SceneContext, views: Map<Material, MaterialView>): number {
    // Discard any prior auto-mirrored renderables and re-queue from the live
    // opaque list. `addMesh` pushes onto `_pendingMeshes`, resolved (and the
    // list rebucketed) by the wrapped `record()` that runs right after.
    task._renderables.length = 0;
    task._autoFromScene = false;
    let queued = 0;
    for (const mesh of opaqueMeshesForPrepass(scene)) {
        const material = mesh.material;
        if (material) {
            task.addMesh(mesh, { material: getNoColorView(material, views) });
            queued++;
        }
    }
    return queued;
}

/** Register a callback to run before each rendered frame. */
export function onBeforeRender(scene: SceneContext, cb: (deltaMs: number) => void): void {
    (scene as SceneContext)._beforeRender.unshift(cb);
}

/** Register a callback to run when `disposeScene` is called. Used to tie
 *  user-owned GPU resources (e.g. a `SpriteRenderer`) to the scene's lifetime. */
export function onSceneDispose(scene: SceneContext, cb: () => void): void {
    (scene as SceneContext)._disposables.push(cb);
}

/** Get the scene's frame graph. Always non-null — created in `createSceneContext`. */
export function getFrameGraph(scene: SceneContext): FrameGraph {
    return (scene as SceneContext)._frameGraph;
}

export interface DeferredSceneRenderables {
    renderables: readonly Renderable[];
    dispose?: () => void;
}

/** @internal Register optional scene-hosted render work without teaching `addToScene` about the feature. */
export function addDeferredSceneRenderables(
    scene: SceneContext,
    build: (engine: EngineContext, scene: SceneContext) => DeferredSceneRenderables | Promise<DeferredSceneRenderables>
): void {
    const ctx = scene as SceneContext;
    ctx._deferredBuilders.push(async () => {
        const built = await build(ctx.surface.engine, ctx);
        ctx._renderables.push(...built.renderables);
        if (built.dispose) {
            ctx._disposables.push(built.dispose);
        }
    });
}

/**
 * Adds an entity (mesh, light, camera, transform node, shadow generator, or asset container)
 * to the scene, dispatching on its type. Asset containers are unpacked and each contained
 * entity added recursively. Optional scene-hosted systems such as depth-hosted sprites
 * expose their own opt-in add functions so mesh-only scenes do not pay feature-specific
 * routing bytes here.
 * @param scene - The owning scene (pillar 4b: entities never reference the scene themselves).
 * @param entity - The entity (or asset container) to add.
 */
export function addToScene(scene: SceneContext, entity: Mesh | LightBase | Camera | ShadowGenerator | TransformNode | AssetContainer): void {
    const ctx = scene as SceneContext;
    // AssetContainer from loadGltf / loadBabylon — process each field present
    if ("entities" in entity) {
        const result = entity as AssetContainer;
        for (const e of result.entities) {
            addToScene(scene, e);
        }
        if (result.clearColor) {
            ctx.clearColor = result.clearColor;
        }
        if (result.camera && !ctx.camera) {
            ctx.camera = result.camera;
        }
        if (result.animationGroups?.length) {
            const engine = ctx.surface.engine;
            const groups = result.animationGroups;
            ctx.animationGroups.push(...groups);
            ctx._beforeRender.push((deltaMs: number) => {
                for (const g of groups) {
                    if (!g._stopped && g._ctrl) {
                        g._ctrl.tick(deltaMs, engine);
                    }
                }
            });
        }
        return;
    }
    if ("_gpu" in entity && "material" in entity) {
        const mesh = entity as unknown as Mesh;
        ctx.meshes.push(mesh);
        registerMeshScene(ctx, mesh);
        const build = mesh.material ? (mesh.material as unknown as { _buildGroup?: MeshGroupBuilder })._buildGroup : undefined;
        if (build) {
            let group = ctx._groups.get(build);
            if (!group) {
                group = [];
                ctx._groups.set(build, group);
                ctx._deferredBuilders.push(async () => {
                    const result = await build(ctx, group!);
                    ctx._renderables.push(...result.renderables);
                    if (result.updater) {
                        ctx._uniformUpdaters.push(result.updater);
                    }
                });
            }
            group.push(mesh);
            // Added after the initial build: the deferred builder for this group has
            // already run (and only runs at boot), so materialize this mesh's renderable
            // through the per-frame material-swap drain instead.
            if (ctx._built) {
                enqueueMaterialSwap(ctx, mesh);
            }
        }
    } else if ("lightType" in entity) {
        ctx.lights.push(entity as LightBase);
    }
    // Recurse into children of meshes, lights, cameras — set parent links
    const kids = (entity as unknown as SceneNode).children;
    if (kids?.length) {
        for (const child of kids) {
            (child as unknown as SceneNode).parent = entity as unknown as SceneNode;
            addToScene(scene, child);
        }
    }
}

/** Release all GPU resources owned by this scene. */
export function disposeScene(scene: SceneContext): void {
    const ctx = scene as SceneContext;
    unregisterRenderingContext(ctx.surface, ctx);
    for (const fn of ctx._disposables) {
        fn();
    }
    for (const fns of ctx._meshDisposables.values()) {
        for (const fn of fns) {
            fn();
        }
    }
    ctx._meshDisposables.clear();
    for (const mesh of ctx.meshes) {
        // Free the mesh's shared GPU buffers only when this was its LAST owning scene.
        if (unregisterMeshScene(ctx, mesh)) {
            disposeMeshGpu(mesh);
        }
    }
    ctx.meshes.length = 0;
    ctx._renderables.length = 0;
    ctx._prePasses.length = 0;
    ctx._gsMeshes.length = 0;
    ctx._uniformUpdaters.length = 0;
    ctx._beforeRender.length = 0;
    ctx._deferredBuilders.length = 0;
    ctx._disposables.length = 0;
    ctx._materialSwapQueue.length = 0;
    ctx.lights.length = 0;
    ctx.animationGroups.length = 0;
    ctx.shadowGenerators.length = 0;
    ctx.camera = null;
}

/** @internal Run all deferred builders (called by registerScene's boot step before the first frame). */
export async function buildScene(scene: SceneContext): Promise<void> {
    const ctx = scene as SceneContext;
    while (ctx._deferredBuilders.length > 0) {
        const builders = [...ctx._deferredBuilders];
        ctx._deferredBuilders = [];
        await Promise.all(builders.map(async (b) => b()));
    }
    ctx._materialSwapQueue.length = 0;
    ctx._renderableVersion++;
    ctx._built = true;
}

/**
 * Register a scene with the engine. Builds deferred work, sorts renderables by order,
 * and adds the scene to its bound surface's render list in overlay order. The scene is
 * always attached to `scene.surface` (which equals the engine itself in the
 * single-canvas case).
 */
export async function registerScene(scene: SceneContext): Promise<void> {
    const ctx = scene;
    const surface = ctx.surface;
    if (isRenderingContextRegistered(surface, ctx)) {
        return;
    }
    await buildScene(scene);
    ctx._renderables.sort(byOrder);
    await Promise.all(ctx._frameGraph._tasks.map((task) => task._preload?.()).filter((preload): preload is Promise<void> => preload !== undefined));
    ctx._frameGraph.build();
    if (surface._renderingContexts.length > 0) {
        (await import("./swapchain-overlay.js")).configureSwapchainOverlayScene(surface, ctx);
    }
    registerRenderingContext(surface, ctx);
}

/**
 * Register a scene with the engine and install the scene-owned shadow frame-graph task.
 * Use only for scenes that generate shadow maps. Like {@link registerScene}, the scene
 * is attached to `scene.surface` (and its owning engine is `scene.surface.engine`).
 */
export async function registerSceneWithShadowSupport(scene: SceneContext): Promise<void> {
    const ctx = scene as SceneContext;
    const surface = ctx.surface;
    if (isRenderingContextRegistered(surface, ctx)) {
        return;
    }
    await buildScene(scene);
    ctx._renderables.sort(byOrder);
    await ensureShadowTask(surface.engine, ctx);
    await Promise.all(ctx._frameGraph._tasks.map((task) => task._preload?.()).filter((preload): preload is Promise<void> => preload !== undefined));
    ctx._frameGraph.build();
    if (surface._renderingContexts.length > 0) {
        (await import("./swapchain-overlay.js")).configureSwapchainOverlayScene(surface, ctx);
    }
    registerRenderingContext(surface, ctx);
}

const byOrder = (a: Renderable, b: Renderable): number => a.order - b.order;

async function ensureShadowTask(engine: EngineContext, scene: SceneContext): Promise<void> {
    const { createShadowTask } = await import("../frame-graph/shadow-task.js");
    scene._frameGraph._tasks.unshift(createShadowTask(engine, scene));
}

/** Remove a previously-registered scene. Idempotent. Does not dispose scene resources.
 *  The scene is always removed from `scene.surface`. */
export function unregisterScene(scene: SceneContext): void {
    unregisterRenderingContext(scene.surface, scene as SceneContext);
}
