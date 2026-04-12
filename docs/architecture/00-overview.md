# Babylon Lite — Architecture Specification (One-Shot Document)

> **Purpose**: This document is the formal specification of Babylon Lite's architecture.
> It must be so complete that if all source code were deleted, an LLM could perfectly
> regenerate the entire engine from this document alone. Treat this as the ground truth.
>
> **Revision scope**: Scenes 1–22 (BoomBox PBR, Sphere+DirectionalLight, Fog+Boxes+Skybox, Shadows+ESM,
> Alien PBR+Skeleton, PBR Gold Sphere, ChibiRex Animated, HDR Glass Sphere, Sponza, PBR Rough Sphere,
> Shark GLB, PBR Shader Balls, PBR Spheres Grid, Flight Helmet, SpotLights+Ground, Thin Instances,
> PBR+Standard Thin Instances, Spotlight Hard Shadows (PCF), PBR Clearcoat, PBR Emissive Spheres Grid,
> PBR Sheen Cloth, PBR Shadows).
> Detailed per-module specs are in the companion docs listed below.

## Architecture Document Index

| Doc | Module | Scope |
|-----|--------|-------|
| [00-overview.md](00-overview.md) | Overview | Repository structure, public API |
| [01-shadow-generator.md](01-shadow-generator.md) | Shadow Generator | ESM + PCF shadows, depth pass, Gaussian blur |
| [03-texture-2d.md](03-texture-2d.md) | Texture2D | Image upload, mipmap gen, invertY |
| [04-mesh-generators.md](04-mesh-generators.md) | Mesh Generators | Ground/heightmap, torus, sphere, box |
| [05-lights.md](05-lights.md) | Lights | Hemispheric, directional, point, spot + PBR variants, multi-light UBO |
| [06-engine.md](06-engine.md) | Engine | GPU init, MSAA, render loop, swap chain |
| [07-scene.md](07-scene.md) | Scene | SceneContext, one-way ownership |
| [08-camera.md](08-camera.md) | Camera | ArcRotateCamera + FreeCamera, controls |
| [09-core-math.md](09-core-math.md) | Core Math | Vec3, Mat4, Quat, ObservableVec3/Quat |
| [10-pbr-material.md](10-pbr-material.md) | PBR Material | ShaderFragment composition, GGX/IBL, clearcoat, sheen |
| [11-standard-material.md](11-standard-material.md) | Standard Material | ShaderFragment composition, Blinn-Phong |
| [12-background-skybox.md](12-background-skybox.md) | Background/Skybox | DDS/HDR/cubemap skybox, ground, background material |
| [13-loaders.md](13-loaders.md) | Loaders | glTF 2.0, .env, .hdr, .babylon, skybox |
| [14-render-pipeline.md](14-render-pipeline.md) | Renderable Architecture | Renderable interfaces, entity-owned pipelines |
| [15-morph-targets.md](15-morph-targets.md) | Morph Targets | Vertex extension, GPU texture weights |
| [16-animation-parity-testing.md](16-animation-parity-testing.md) | Animation Parity | Animated scene test methodology |
| [17-thin-instances.md](17-thin-instances.md) | Thin Instances | Per-instance matrix + color, PBR + Standard |
| [18-picking.md](18-picking.md) | Picking | GPU ID pass, CPU ray/triangle intersection |
| [19-scene-hierarchy-parenting.md](19-scene-hierarchy-parenting.md) | Scene Hierarchy | TransformNode, parenting, world matrix propagation |
| [20-animation.md](20-animation.md) | Animation | AnimationGroup, keyframe evaluation, glTF integration |
| [21-shader-composition.md](21-shader-composition.md) | Shader Composition | ShaderFragment system, composer, slot injection |
| [22-skeleton.md](22-skeleton.md) | Skeleton | Bone textures, 4/8-bone skinning |
| [23-loader-hdr.md](23-loader-hdr.md) | HDR Loader | RGBE parsing, SH extraction, GPU compute IBL |
| [24-loader-babylon.md](24-loader-babylon.md) | .babylon Loader | .babylon format parsing |
| [25-resource-pool.md](25-resource-pool.md) | Resource Pool | GPU buffer/texture pooling |

---

## 1. Repository Structure

```
babylon-lite/
├── GUIDANCE.md                    # Immutable core pillars & workflow (anti-amnesia)
├── package.json                   # pnpm workspace root
├── pnpm-workspace.yaml            # packages: [packages/*, apps/*]
├── tsconfig.base.json             # Shared TS config
├── vitest.config.ts               # Root test config
│
├── packages/babylon-lite/         # The engine library
│   ├── package.json               # name: "babylon-lite", type: "module"
│   ├── tsconfig.json              # extends ../../tsconfig.base.json
│   ├── vite.config.ts             # lib mode build
│   ├── src/
│   │   ├── index.ts               # Public API barrel (tree-shakable)
│   │   ├── vite-env.d.ts          # Declares ?raw WGSL imports
│   │   ├── math/                   # Math primitives
│   │   │   ├── types.ts           # Vec3, Vec4, Color3, Color4, Mat4, Quat
│   │   │   ├── vec3.ts            # Pure Vec3 functions
│   │   │   ├── mat4.ts            # Pure Mat4 functions (LH, column-major)
│   │   │   ├── observable-vec3.ts # ObservableVec3 (reactive position/target)
│   │   │   ├── observable-quat.ts # ObservableQuat (reactive rotation)
│   │   │   └── index.ts           # Math barrel
│   │   ├── engine/
│   │   │   └── engine.ts          # createEngine(), GPUDevice, swapchain, render loop
│   │   ├── scene/
│   │   │   ├── scene.ts           # createSceneContext(), flat data struct, add()
│   │   │   ├── scene-core.ts      # Core scene logic
│   │   │   ├── scene-camera.ts    # Camera management
│   │   │   ├── scene-remove.ts    # removeFromScene()
│   │   │   ├── set-parent.ts      # setParent() — parent/child transforms
│   │   │   ├── parentable.ts      # IWorldMatrixProvider, IParentable interfaces
│   │   │   ├── transform-node.ts  # TransformNode — hierarchy node without mesh
│   │   │   └── world-matrix-state.ts # Version-based world matrix propagation
│   │   ├── camera/
│   │   │   ├── camera.ts          # Camera interface
│   │   │   ├── arc-rotate.ts      # createArcRotateCamera(), ArcRotateCamera
│   │   │   ├── arc-rotate-controls.ts  # attachControl() for orbit
│   │   │   ├── free-camera.ts     # createFreeCamera(), FreeCamera
│   │   │   └── free-camera-controls.ts # attachFreeControl() for WASD/arrow
│   │   ├── light/
│   │   │   ├── light-base.ts      # Shared light base
│   │   │   ├── types.ts           # LightBase type, SceneAnyLight union
│   │   │   ├── light-matrix.ts    # Light view-projection for shadows
│   │   │   ├── hemispheric.ts     # createHemisphericLight()
│   │   │   ├── hemispheric-pbr.ts # Hemispheric light PBR variant
│   │   │   ├── point-light.ts     # createPointLight()
│   │   │   ├── point-pbr.ts       # Point light PBR variant
│   │   │   ├── directional-light.ts # createDirectionalLight()
│   │   │   ├── directional-pbr.ts # Directional light PBR variant
│   │   │   └── spot-light.ts      # createSpotLight()
│   │   ├── material/
│   │   │   ├── pipeline-cache.ts  # Shared pipeline cache utility
│   │   │   ├── pbr/               # PBR metallic-roughness material
│   │   │   │   ├── pbr-material.ts      # PbrMaterialProps + createPbrMaterial()
│   │   │   │   ├── pbr-template.ts      # PBR shader template (WGSL generation)
│   │   │   │   ├── pbr-flags.ts         # PBR feature flag bitmask
│   │   │   │   ├── pbr-pipeline.ts      # Pipeline cache + feature flags
│   │   │   │   ├── pbr-renderable.ts    # buildPbrRenderables()
│   │   │   │   ├── pbr-single-rebuild.ts     # Single-mesh pipeline rebuild
│   │   │   │   ├── pbr-multilight-wgsl.ts    # Multi-light WGSL generation
│   │   │   │   ├── background-material.ts    # Skybox + Ground material factories
│   │   │   │   ├── background-renderable.ts  # Skybox + Ground → Renderables
│   │   │   │   ├── background-dds-skybox.ts  # DDS environment skybox
│   │   │   │   ├── background-hdr-skybox.ts  # HDR environment skybox
│   │   │   │   ├── background-ground.ts      # Background ground plane
│   │   │   │   └── fragments/          # PBR ShaderFragment modules
│   │   │   │       ├── clearcoat-fragment.ts
│   │   │   │       ├── emissive-fragment.ts
│   │   │   │       ├── ibl-fragment.ts
│   │   │   │       ├── morph-fragment.ts
│   │   │   │       ├── pbr-shadow-fragment.ts
│   │   │   │       ├── reflectance-fragment.ts
│   │   │   │       ├── sheen-fragment.ts
│   │   │   │       └── skeleton-fragment.ts
│   │   │   └── standard/          # Standard Blinn-Phong material
│   │   │       ├── standard-material.ts    # Types, factory, updateSceneUniforms
│   │   │       ├── standard-template.ts    # Standard shader template (WGSL generation)
│   │   │       ├── standard-pipeline.ts    # Pipeline cache + feature flags
│   │   │       ├── standard-renderable.ts  # buildStandardMeshRenderables()
│   │   │       ├── standard-single-rebuild.ts # Single-mesh pipeline rebuild
│   │   │       ├── skybox-cubemap.ts       # CubeMap skybox for StandardMaterial scenes
│   │   │       └── fragments/             # Standard ShaderFragment modules
│   │   │           ├── normal-map-fragment.ts
│   │   │           ├── std-ambient-fragment.ts
│   │   │           ├── std-emissive-fragment.ts
│   │   │           ├── std-lightmap-fragment.ts
│   │   │           ├── std-opacity-fragment.ts
│   │   │           ├── std-reflection-fragment.ts
│   │   │           ├── std-shadow-fragment.ts
│   │   │           └── std-specular-fragment.ts
│   │   ├── shader/                # Shader composition system
│   │   │   ├── shader-composer.ts # ShaderFragment composer engine
│   │   │   ├── fragment-types.ts  # ShaderFragment interface definitions
│   │   │   ├── ubo-layout.ts     # UBO layout helpers
│   │   │   ├── wgsl-helpers.ts   # WGSL code-gen utilities
│   │   │   └── fragments/        # Shared shader fragments
│   │   │       └── thin-instance-fragment.ts
│   │   ├── render/
│   │   │   ├── renderable.ts      # Renderable, PrePassRenderable, SceneUniformUpdater
│   │   │   ├── scene-helpers.ts   # Shared helper utilities
│   │   │   └── lights-ubo.ts     # Multi-light UBO packing
│   │   ├── mesh/
│   │   │   ├── mesh.ts            # Mesh type and GPU upload
│   │   │   ├── mesh-factories.ts  # High-level createSphere/Box/Torus/Ground
│   │   │   ├── thin-instance.ts   # Thin instance CPU data model + public API
│   │   │   ├── thin-instance-gpu.ts # GPU buffer sync (lazy-loaded by renderable)
│   │   │   ├── create-sphere.ts   # Sphere geometry generator
│   │   │   ├── create-box.ts      # Box geometry generator
│   │   │   ├── create-torus.ts    # Torus geometry generator
│   │   │   └── create-ground.ts   # Ground/heightmap geometry generator
│   │   ├── skeleton/
│   │   │   ├── create-skeleton.ts   # Skeleton data creation from glTF
│   │   │   └── skeleton-updater.ts  # Joint matrix computation for skinned meshes
│   │   ├── animation/
│   │   │   ├── animation-group.ts    # AnimationGroup creation from glTF data
│   │   │   ├── evaluate.ts           # Keyframe interpolation (step, linear, cubic)
│   │   │   └── types.ts              # Animation type definitions
│   │   ├── morph/
│   │   │   └── create-morph-targets.ts # Morph target data + GPU texture
│   │   ├── picking/
│   │   │   ├── gpu-picker.ts        # createGpuPicker() — GPU ID-pass picking
│   │   │   ├── picking-pipeline.ts  # Picking render pipeline
│   │   │   ├── picking-shader.ts    # Picking WGSL shaders
│   │   │   ├── picking-helpers.ts   # getPickedNormal(), getPickedUV()
│   │   │   ├── picking-info.ts      # PickingInfo type
│   │   │   ├── detailed-picking.ts  # enableDetailedPicking() — CPU ray/triangle
│   │   │   └── ray.ts              # Ray intersection math
│   │   ├── resource/
│   │   │   └── gpu-pool.ts         # GPU buffer/texture pooling
│   │   ├── shadow/
│   │   │   ├── shadow-base.ts       # Shared shadow logic
│   │   │   ├── shadow-generator.ts  # ESM shadow generator
│   │   │   ├── pcf-shadow-generator.ts # PCF shadow generator
│   │   │   └── shadow-renderable.ts # Shadow → PrePassRenderable
│   │   ├── texture/
│   │   │   ├── texture-2d.ts      # 2D texture loader
│   │   │   ├── solid-texture.ts   # 1×1 solid-color texture factory
│   │   │   ├── cube-texture.ts    # 6-face cube texture loader
│   │   │   └── generate-mipmaps.ts # GPU mipmap generation
│   │   ├── loader-gltf/
│   │   │   ├── load-gltf.ts       # GLB parser, GPU upload
│   │   │   ├── gltf-parser.ts     # glTF JSON parsing helpers
│   │   │   ├── gltf-material.ts   # glTF material → PbrMaterialProps
│   │   │   └── gltf-animation.ts  # glTF animation extraction
│   │   ├── loader-env/
│   │   │   ├── load-env.ts        # .env parser, BRDF LUT generation, cubemap upload
│   │   │   ├── load-dds-env.ts    # DDS environment loading
│   │   │   ├── env-helpers.ts     # Environment helper utilities
│   │   │   └── brdf-rgbd-decode.ts # BRDF RGBD decode helpers
│   │   ├── loader-hdr/
│   │   │   ├── load-hdr.ts        # loadHdrEnvironment() — HDR environment pipeline
│   │   │   ├── hdr-parser.ts      # RGBE file parser
│   │   │   └── hdr-ibl-pipeline.ts # GPU compute IBL from HDR
│   │   ├── loader-babylon/
│   │   │   └── load-babylon.ts    # loadBabylon() — .babylon format parser
│   │   └── loader-skybox/
│   │       ├── load-skybox.ts     # High-level skybox loader
│   │       └── skybox-renderable.ts # Skybox → deferred Renderable builder
│
├── apps/manual-lab/               # Dev sandbox (Scenes 1–22)
│   ├── index.html
│   ├── src/lite/scene1.ts          # Scene 1: BoomBox PBR
│   ├── src/lite/scene2.ts          # Scene 2: Sphere + DirectionalLight
│   ├── ...                         # Scenes 3–21
│   ├── src/lite/scene22.ts         # Scene 22: PBR Shadows
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── reference/                     # Per-scene reference data
│   ├── scene1-boombox/            # Scene 1 reference data
│   ├── scene2-sphere/             # Scene 2 reference data
│   ├── ...                        # Scenes 3–21
│   ├── scene22-pbr-shadows/       # Scene 22 reference data
│   └── (each contains golden screenshots for parity tests)
│
└── docs/architecture/
    └── 00-overview.md             # THIS FILE
```

---

## 2. Public API Surface

All exports from `packages/babylon-lite/src/index.ts`. The API must feel like Babylon.js
but is composed of pure functions and plain data types.

### Functions

```typescript
// Engine lifecycle
createEngine(canvas: HTMLCanvasElement): Promise<Engine>

// Scene
createSceneContext(engine: Engine): SceneContext
createDefaultCamera(scene: SceneContext): ArcRotateCamera
removeFromScene(scene: SceneContext, entity: Mesh | ...): void

// Camera
createArcRotateCamera(scene: SceneContext, options?: {...}): ArcRotateCamera
attachControl(camera: ArcRotateCamera, canvas: HTMLCanvasElement): void
createFreeCamera(scene: SceneContext, options?: {...}): FreeCamera
attachFreeControl(camera: FreeCamera, canvas: HTMLCanvasElement): void

// Loaders
loadGltf(scene: SceneContext, url: string): Promise<GltfResult>
loadEnvironment(scene: SceneContext, url: string): Promise<EnvironmentTextures>
loadHdrEnvironment(scene: SceneContext, url: string): Promise<EnvironmentTextures>
loadBabylon(scene: SceneContext, url: string): Promise<Mesh[]>
loadTexture2D(device: GPUDevice, url: string, options?: Texture2DOptions): Promise<Texture2D>
loadSkybox(scene: SceneContext, baseUrl: string, extension?: string): Promise<void>

// Texture factories
createSolidTexture2D(device: GPUDevice, r: number, g: number, b: number, a?: number): Texture2D

// Lights
createHemisphericLight(direction?: [number,number,number], intensity?: number): HemisphericLight
createPointLight(position: [number,number,number], options?: {...}): PointLight
createDirectionalLight(direction: [number,number,number], options?: {...}): DirectionalLight
createSpotLight(position: [number,number,number], direction: [number,number,number], options?: {...}): SpotLight

// Mesh factories
createSphere(engine: Engine, options?: SphereOptions): Mesh
createBox(engine: Engine, options?: {...}): Mesh
createTorus(engine: Engine, options?: TorusOptions): Mesh
createGround(engine: Engine, options?: GroundOptions): Mesh
createGroundFromHeightMap(scene: SceneContext, url: string, options?: GroundOptions): Promise<Mesh>

// Materials
createStandardMaterial(): StandardMaterialProps
createPbrMaterial(props?: Partial<PbrMaterialProps>): PbrMaterialProps

// Shadows
createShadowGenerator(scene: SceneContext, light: DirectionalLight, config?: ShadowGeneratorConfig): ShadowGenerator
createPcfShadowGenerator(scene: SceneContext, light: DirectionalLight | SpotLight, config?: PcfShadowGeneratorConfig): ShadowGenerator

// Animation
createAnimationController(skeleton, scene): AnimationController
createAnimationGroups(gltfData, meshes, scene): AnimationGroup[]

// Hierarchy
setParent(child: IParentable, parent: IWorldMatrixProvider | null, scene: SceneContext): void
createTransformNode(name: string, scene: SceneContext): TransformNode
cloneTransformNode(node: TransformNode, scene: SceneContext): TransformNode
collectMeshes(node: TransformNode): Mesh[]

// Math
mat4Translation(x: number, y: number, z: number): Mat4
mat4Identity(): Mat4
mat4Scale(sx: number, sy: number, sz: number): Mat4
mat4Compose(tx,ty,tz, qx,qy,qz,qw, sx,sy,sz): Mat4

// Thin Instances
addThinInstance(mesh: Mesh, matrix: Mat4): number
removeThinInstance(mesh: Mesh, index: number): void
setThinInstanceMatrix(mesh: Mesh, index: number, matrix: Mat4): void
setThinInstances(mesh: Mesh, matrices: Mat4[]): void
flushThinInstances(mesh: Mesh): void
setThinInstanceColors(mesh: Mesh, colors: Float32Array): void

// Picking
createGpuPicker(engine: Engine, scene: SceneContext): GpuPicker
enableDetailedPicking(mesh: Mesh): void
getPickedNormal(info: PickingInfo): Vec3
getPickedUV(info: PickingInfo): [number, number]
```

### Types

```typescript
interface Engine {
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  readonly canvas: HTMLCanvasElement;
  readonly msaaSamples: number;
  start(scene: SceneContext): Promise<void>;
  stop(): void;
  resize(): void;
}

interface SceneContext {
  readonly engine: Engine;
  clearColor: GPUColorDict;
  camera: ArcRotateCamera | FreeCamera | null;
  lights: HemisphericLight[];
  meshes: Mesh[];
  animationGroups: AnimationGroup[];
  fog: FogConfig | null;
  shadowGenerators: ShadowGenerator[];
  imageProcessing: ImageProcessingConfig;
  environmentPrimaryColor?: [number, number, number];

  // Internal renderable lists
  _renderables: Renderable[];
  _prePasses: PrePassRenderable[];
  _uniformUpdaters: SceneUniformUpdater[];
  _deferredBuilders: (() => void | Promise<void>)[];
  _fixedDeltaMs: number;
  _beforeRender: ((deltaMs: number) => void)[];
  add(entity: Mesh | SceneAnyLight | ShadowGenerator): void;
}

interface ArcRotateCamera {
  alpha: number;              // Horizontal rotation (azimuth)
  beta: number;               // Vertical angle from top pole
  radius: number;             // Distance from target
  target: Vec3;               // Look-at point
  fov: number;                // Vertical FOV in radians
  minZ: number;               // Near clip plane
  maxZ: number;               // Far clip plane
  getViewMatrix(): Mat4;
  getProjectionMatrix(aspect: number): Mat4;
  getViewProjectionMatrix(aspect: number): Mat4;
  getPosition(): Vec3;
}

interface FreeCamera {
  position: ObservableVec3;   // Camera world position
  rotation: ObservableQuat;   // Camera orientation
  fov: number;
  minZ: number;
  maxZ: number;
  getViewMatrix(): Mat4;
  getProjectionMatrix(aspect: number): Mat4;
  getViewProjectionMatrix(aspect: number): Mat4;
  getPosition(): Vec3;
}

interface Camera { /* Union of ArcRotateCamera | FreeCamera */ }

interface HemisphericLight {
  direction: [number, number, number];
  intensity: number;
  diffuseColor: [number, number, number];
  groundColor: [number, number, number];
}

type LightBase = { intensity: number; diffuseColor: [number, number, number]; }
interface PointLight extends LightBase { position: [number, number, number]; range: number; }
interface DirectionalLight extends LightBase { direction: [number, number, number]; }
interface SpotLight extends LightBase { position: [number, number, number]; direction: [number, number, number]; angle: number; exponent: number; }

interface PbrMaterialProps {
  baseColorTexture?: Texture2D;
  normalTexture?: Texture2D;
  ormTexture?: Texture2D;        // R=occ, G=rough, B=metal
  emissiveTexture?: Texture2D;
  clearCoat?: ClearCoatProps;
  readonly _buildGroup: MeshGroupBuilder;
}

interface ClearCoatProps { intensity: number; roughness: number; normalTexture?: Texture2D; }

interface StandardMaterialProps { diffuseColor?: [number,number,number]; fog?: FogConfig; }
interface FogConfig { mode: 'linear' | 'exp' | 'exp2'; density: number; start: number; end: number; color: [number,number,number]; }

interface ImageProcessingConfig { exposure: number; contrast: number; }

interface Mesh { boundMin: Vec3; boundMax: Vec3; name?: string; }
interface MeshGPU { /* internal GPU state */ }

interface Texture2D { texture: GPUTexture; view: GPUTextureView; sampler: GPUSampler; }
interface Texture2DOptions { srgb?: boolean; invertY?: boolean; mipmap?: boolean; }

interface ShadowGenerator { readonly shadowMap: GPUTexture; readonly config: ShadowGeneratorConfig; }
interface ShadowGeneratorConfig { mapSize?: number; bias?: number; darkness?: number; }
interface PcfShadowGeneratorConfig { mapSize?: number; bias?: number; darkness?: number; filterSize?: number; }

interface GltfResult { meshes: Mesh[]; animationData?: GltfAnimationData; }

interface EnvironmentTextures {
  specularCube: GPUTexture;     specularCubeView: GPUTextureView;
  brdfLut: GPUTexture;          brdfLutView: GPUTextureView;
  cubeSampler: GPUSampler;      brdfSampler: GPUSampler;
  irradianceSH: Float32Array;   // 27 floats (9 vec3 SH coefficients)
}

interface AnimationController { update(deltaMs: number): void; }
interface AnimationGroup { name: string; play(loop?: boolean): void; stop(): void; }
interface AnimationClip { /* keyframe data */ }
interface GltfAnimationData { /* parsed glTF animation channels */ }

interface TransformNode { name: string; position: ObservableVec3; rotation: ObservableQuat; scaling: ObservableVec3; }
interface IWorldMatrixProvider { getWorldMatrix(): Mat4; }
interface IParentable extends IWorldMatrixProvider { /* parentable entity */ }

interface ThinInstanceData { matrices: Mat4[]; colors?: Float32Array; }

class ObservableVec3 { x: number; y: number; z: number; }
class ObservableQuat { x: number; y: number; z: number; w: number; }

interface GpuPicker { pick(x: number, y: number): Promise<PickingInfo | null>; }
interface PickingInfo { mesh: Mesh; faceId: number; worldPosition: Vec3; }

// Low-level (advanced/custom rendering)
interface Renderable { order: number; draw(pass: GPURenderPassEncoder, engine: Engine): void; }
interface PrePassRenderable { execute(encoder: GPUCommandEncoder, engine: Engine): void; }
interface SceneUniformUpdater { update(engine: Engine): void; }

interface SphereOptions { diameter?: number; segments?: number; }
interface TorusOptions { diameter?: number; thickness?: number; tessellation?: number; }
interface GroundOptions { width?: number; height?: number; subdivisions?: number; }
```

---

## 3. Module Specifications

### 3.1 Core Math (`math/`)

**Coordinate system**: Left-handed (LH), matching Babylon.js and WebGPU.

**Mat4 memory layout**: Column-major, 16 contiguous `f32` values.
Indices `[col*4+row]` — matches WGSL `mat4x4<f32>` storage.

```
[0]  [4]  [8]  [12]     col0  col1  col2  col3
[1]  [5]  [9]  [13]  =  (X)   (Y)   (Z)   (Translation)
[2]  [6]  [10] [14]
[3]  [7]  [11] [15]
```

**Key functions**:

| Function | Signature | Notes |
|----------|-----------|-------|
| `mat4Identity()` | `→ Mat4` | 16-float identity |
| `mat4Multiply(a, b)` | `→ Mat4` | Column-major `a * b` |
| `mat4LookAtLH(eye, target, up)` | `→ Mat4` | LH look-at, `zAxis = normalize(target - eye)` |
| `mat4PerspectiveLH(fov, aspect, near, far)` | `→ Mat4` | Zero-to-one depth, `tan = 1/tan(fov/2)` |
| `mat4Invert(m)` | `→ Mat4 \| null` | Full 4x4 inverse via cofactors |
| `mat4Compose(tx,ty,tz, qx,qy,qz,qw, sx,sy,sz)` | `→ Mat4` | TRS composition |
| `mat4FromQuat(qx,qy,qz,qw)` | `→ Mat4` | Quaternion to rotation matrix |

**LookAtLH formula** (matches Babylon.js `Matrix.LookAtLHToRef`):
```
zAxis = normalize(target - eye)          // forward
xAxis = normalize(cross(up, zAxis))      // right
yAxis = cross(zAxis, xAxis)              // up
M = | xAxis.x  yAxis.x  zAxis.x  0 |    (stored column-major)
    | xAxis.y  yAxis.y  zAxis.y  0 |
    | xAxis.z  yAxis.z  zAxis.z  0 |
    | -dot(x,eye)  -dot(y,eye)  -dot(z,eye)  1 |
```

**PerspectiveLH formula** (zero-to-one depth, matches `Matrix.PerspectiveFovLHToRef`):
```
f = 1 / tan(fov / 2)
M = | f/aspect  0  0              0 |
    | 0         f  0              0 |
    | 0         0  far/(far-near) 1 |
    | 0         0  -far*near/(far-near) 0 |
```

### 3.2 Engine (`engine/engine.ts`)

**Responsibilities**: Acquire GPUDevice, configure swapchain, manage MSAA render targets,
drive the render loop.

**Init sequence**:
1. `navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })`
2. `adapter.requestDevice()` — no special features required for Phase 1
3. `canvas.getContext('webgpu')` → configure with `alphaMode: 'opaque'`
4. Create 4x MSAA color + depth render targets

**MSAA configuration**:
- Color target: `format = navigator.gpu.getPreferredCanvasFormat()` (typically `bgra8unorm`), `sampleCount = 4`
- Depth target: `depth24plus-stencil8`, `sampleCount = 4`
- Resolved to swapchain texture each frame

**Render loop** (`engine.start(scene)` — async, returns `Promise<void>`):
```
await run deferred builders → sort renderables → requestAnimationFrame → resize() → renderFrame() → requestAnimationFrame ...
```

**`renderFrame()`**:
1. Get current swapchain texture view
2. Create command encoder
3. Execute pre-passes: iterate `scene._prePasses` → `execute(encoder, engine)`
4. Begin render pass:
   - Color: MSAA view → resolve to swapchain, clearColor from scene, loadOp: 'clear', storeOp: 'store'
   - Depth: depth view, clearValue: 1.0, loadOp: 'clear', storeOp: 'store'
   - Stencil: clearValue: 0, loadOp: 'clear', storeOp: 'store'
5. Set viewport (0, 0, width, height, 0, 1)
6. Update uniforms: iterate `scene._uniformUpdaters` → `update(engine)`
7. Draw calls: iterate `scene._renderables` (sorted by order) → `draw(pass, engine)`
8. End pass, submit

**Resize**: checks `canvas.clientWidth * devicePixelRatio`, destroys and recreates MSAA/depth textures if changed.

### 3.3 Scene (`scene/scene.ts`)

A flat data struct with renderable arrays. No hierarchy. No callbacks.

```typescript
{
  engine,                     // readonly ref to Engine
  clearColor: {r:0.2, g:0.2, b:0.3, a:1.0},
  camera: null,               // set by caller
  lights: [],                 // HemisphericLight[]
  meshes: [],                 // Mesh[] — all meshes (standard + PBR)
  animationGroups: [],        // AnimationGroup[] — glTF animation groups
  fog: null,                  // FogConfig | null
  shadowGenerators: [],       // ShadowGenerator[]
  imageProcessing: { exposure: 0.8, contrast: 1.2 },
  _renderables: [],           // Renderable[] — draw entities
  _prePasses: [],             // PrePassRenderable[] — shadow passes etc.
  _uniformUpdaters: [],       // SceneUniformUpdater[] — per-frame UBO updates
  _deferredBuilders: [],      // (() => void | Promise<void>)[] — run once at engine.start()
  _fixedDeltaMs: 0,           // fixed delta for animation (0 = use real time)
  _beforeRender: [],          // ((deltaMs: number) => void)[] — per-frame callbacks
}
```

**Registration**: `scene.add(entity)` routes by type — `Mesh`, `SceneAnyLight`, or `ShadowGenerator`.
**Deferred builders**: run once at `engine.start()` to create pipelines/bind groups.

### 3.4 Camera (`camera/arc-rotate.ts`)

**ArcRotateCamera** — orbits around a target using spherical coordinates.

**Position formula** (matches Babylon.js `ArcRotateCamera._getViewMatrix`):
```
position = target + Vector3(
  radius * cos(alpha) * sin(beta),
  radius * cos(beta),
  radius * sin(alpha) * sin(beta)
)
```

**`createDefaultCamera(scene)`** auto-frames loaded meshes:
1. Compute world AABB from all `scene.meshes[].boundMin/boundMax`
2. `target = center of AABB`
3. `worldSize = max - min`
4. `radius = length(worldSize) * 1.5`
5. `alpha = -π/2`, `beta = π/2` (matching Babylon's `createDefaultCameraOrLight`)
6. `fov = 0.8` (Babylon default)
7. `minZ = 0.1`, `maxZ = 1000`

The playground then overrides: `camera.alpha = 1.77538207638442`

### 3.5 Light (`light/hemispheric.ts`)

Plain data factory. Returns `HemisphericLight` with:
- `direction: [0, 1, 0]` (up)
- `intensity: 0.7`
- `diffuseColor: [1, 1, 1]` (sky/top)
- `groundColor: [0, 0, 0]` (bottom)

The hemispheric light model in the shader:
```
hemiNdotL = dot(N, lightDir) * 0.5 + 0.5    // remap [-1,1] → [0,1]
hemiColor = mix(groundColor, diffuseColor, hemiNdotL)
contribution = hemiColor * intensity
```

### 3.6 Materials (`material/pbr/`, `material/standard/`)

**Design principle**: Materials own shaders. The engine never imports WGSL or material code — it iterates blind `Renderable` interfaces.

**Dynamic shader composition**: Both PBR and Standard materials use a composer pattern — TypeScript functions build WGSL strings from feature flags. Only the blocks needed for a given mesh's features are emitted. No uber shader, no raw `.wgsl` files for PBR/Standard.

**PBR feature flags**: `PBR_HAS_NORMAL_MAP` (1<<0), `PBR_HAS_EMISSIVE` (1<<1), `PBR_HAS_ENV` (1<<2).

**Standard feature flags**: `HAS_DIFFUSE_TEXTURE` (1<<0), `HAS_EMISSIVE_TEXTURE` (1<<1), `RECEIVE_SHADOWS` (1<<2).

**Pipeline caching**: Both materials cache pipelines per `(features, format, msaaSamples)` tuple. Meshes with the same features share a pipeline.

**Bind group layout (PBR group 1)**: Bindings assigned sequentially — mesh UBO, baseColor, [normal], ORM, [emissive], [BRDF LUT, IBL cube]. Binding count varies by features.

**Bind group layout (Standard group 1)**: mesh UBO, light UBO, material UBO, [diffuse texture], [shadow/UV UBO], [emissive texture]. Group 2 = shadow map (if shadows).

### 3.7 Renderable Architecture (`render/renderable.ts`)

**Entity-owned pipelines**: Each material/entity creates its own pipeline and returns `Renderable` objects. The engine iterates `_prePasses` → `_uniformUpdaters` → `_renderables` without importing any material code.

```typescript
interface Renderable { order: number; draw(pass, engine): void; }
interface PrePassRenderable { execute(encoder, engine): void; }
interface SceneUniformUpdater { update(engine): void; }
```

**Draw order**: skybox (0) → opaque (100) → transparent (200).

**Deferred building**: Entities register builders on `scene._deferredBuilders`. These run once at `engine.start()` to create GPU resources.

### 3.8 glTF Loader (`loader-gltf/load-gltf.ts`)

Parses GLB containers (binary glTF 2.0). Not a general-purpose loader — optimized for
the meshes we encounter in reference scenes. Returns `Mesh[]` (not `GpuMesh[]` — that interface no longer exists).

**Texture caching**: Textures are cached per bitmap identity + sRGB flag to avoid duplicate GPU uploads. Uses a `Map<string, Texture2D>` with key format `${bitmapId}:${srgb?1:0}`.

**Animation extraction**: Creates `AnimationGroup[]` from glTF animations via `createAnimationGroups()`, registers `_beforeRender` callbacks on the scene for playback.

**GLB container format**:
```
[Header: 12B]  magic=0x46546c67, version=2, totalLength
[JSON chunk]   type=0x4E4F534A, length, UTF-8 JSON payload
[BIN chunk]    type=0x004E4942, length, binary blob
```

**Accessor resolution**:
```
byteOffset = bufferView.byteOffset + accessor.byteOffset
TypedArray = new T(binChunk.buffer, binChunk.byteOffset + byteOffset, count * componentCount)
```

**Component types**: FLOAT=5126, UNSIGNED_SHORT=5123, UNSIGNED_INT=5125, UNSIGNED_BYTE=5121

**Mesh extraction flow**:
1. Walk nodes → find nodes with `mesh` property
2. Compute world matrix via node TRS + parent chain
3. Resolve accessors: POSITION, NORMAL, TANGENT, TEXCOORD_0, indices
4. Resolve material: pbrMetallicRoughness textures → ImageBitmap (with `colorSpaceConversion: 'none'`)

**GPU upload**:
- Vertex/index buffers: `mappedAtCreation`, copy bytes, unmap
- Textures: `copyExternalImageToTexture` with `premultipliedAlpha: false`, format `rgba8unorm`
- Mipmaps: `mipLevelCount: 1` (TODO: mipmap generation)
- Null textures → 1×1 opaque white fallback
- Bounding box: computed from positions × world matrix during upload

**BoomBox.glb specifics (Scene 1)**:
- 1 mesh primitive: 18,108 indices, 3,575 vertices
- 4 vertex attributes: position (f32x3), normal (f32x3), tangent (f32x4), uv (f32x2)
- 4 textures: baseColor (2048²), normal (2048²), metallicRoughness (2048²), emissive (2048²)
- World matrix from glTF node: `[-1,0,0,0, 0,1,0,0, 0,0,-1,0, 0,0,0,1]` (180° Y rotation)
- ORM packing: metallicRoughness texture has R=occlusion, G=roughness, B=metallic

### 3.9 Environment Loader (`loader-env/load-env.ts`)

**Babylon.js `.env` format**:
```
[Magic: 8B]  0x86 0x16 0x87 0x96 0xF6 0xD6 0x96 0x36
[JSON manifest: variable]  UTF-8, null-terminated
[Binary image data: rest]  Concatenated PNG/WebP face images
```

**Manifest structure** (relevant fields):
```json
{
  "width": 256,
  "imageType": "image/png",
  "irradiance": { "x": [...], "y": [...], ... "xy": [...] },
  "specular": {
    "lodGenerationScale": 0.8,
    "mipmaps": [ { "position": 0, "length": 12345 }, ... ]
  }
}
```

**Face images**: `mipmaps` array is flat: `[mip0_face0, mip0_face1, ..., mip0_face5, mip1_face0, ...]`.
Each entry has `position` (offset from binary start) and `length` (bytes).

**RGBD encoding**: Faces are RGBD-encoded (HDR in 8-bit). Decode: `hdr.rgb = rgbd.rgb / max(rgbd.a, ε)`.
Decoded in the fragment shader, not during upload.

**Cubemap upload**: `rgba8unorm`, full mip chain. All faces via `copyExternalImageToTexture`
with `premultiplyAlpha: false`, `colorSpaceConversion: 'none'`.

**BRDF LUT generation**: CPU-computed at init (no CDN dependency).
- 256×256 `rgba8unorm` texture
- Split-sum BRDF integration: Hammersley quasi-random sampling + importance-sampled GGX
- 64 samples per texel
- Smith-GGX geometry (IBL variant: `k = a²/2` where `a = roughness²`)
- Output: `R = scale`, `G = bias` (used as `specular = F0 * scale + bias`)

**Irradiance SH**: 9 Vec3 coefficients extracted from manifest, stored as Float32Array(27).

### 3.10 Shaders

PBR and Standard material shaders are **dynamically composed** from feature flags via the ShaderFragment composition system in `pbr-template.ts` and `standard-template.ts`. No raw `.wgsl` files exist for these materials.

Raw `.wgsl` shader files are still used for:
- Background materials (skybox, ground)
- Shadow passes (depth, blur)
- CubeMap skybox

All shaders are WGSL. Raw files are imported via Vite `?raw` by their respective material modules.

#### Scene Uniforms (shared struct)

```wgsl
struct SceneUniforms {
  viewProj: mat4x4<f32>,          // 64B @ offset 0
  cameraPosition: vec3<f32>,      // 12B @ offset 64
  _pad0: f32,                     //  4B @ offset 76
  lightDirection: vec3<f32>,      // 12B @ offset 80
  lightIntensity: f32,            //  4B @ offset 92
  lightDiffuseColor: vec3<f32>,   // 12B @ offset 96
  _pad1: f32,                     //  4B @ offset 108
  lightGroundColor: vec3<f32>,    // 12B @ offset 112
  _pad2: f32,                     //  4B @ offset 124
};                                // Total: 128B
```

#### PBR Vertex Shader (composed by `composePbrVertex`)

**Inputs**: position (loc 0, f32x3), normal (loc 1, f32x3), tangent (loc 2, f32x4, if HAS_NORMAL_MAP), uv (loc 2 or 3, f32x2)
**Outputs**: clipPos (builtin), worldPos, worldNormal, [worldTangent, worldBitangent], uv

**Logic**:
```
worldPos = mesh.world * vec4(position, 1.0)
clipPos = scene.viewProj * worldPos
normalW = normalize((mesh.world * vec4(normal, 0)).xyz)
tangentW = normalize((mesh.world * vec4(tangent.xyz, 0)).xyz)
bitangentW = cross(normalW, tangentW) * tangent.w
```

#### PBR Fragment Shader (composed by `composePbrFragment`)

**BRDF functions** (all matching standard microfacet model):

1. **GGX/Trowbridge-Reitz NDF**:
   ```
   D(NdotH, α) = α⁴ / (π · (NdotH² · (α⁴ - 1) + 1)²)
   where α = roughness²
   ```

2. **Smith-GGX Height-Correlated Geometry**:
   ```
   G(NdotL, NdotV, α) = 0.5 / (NdotL·√(NdotV²·(1-α⁴)+α⁴) + NdotV·√(NdotL²·(1-α⁴)+α⁴))
   ```

3. **Schlick Fresnel**:
   ```
   F(cosθ, F0) = F0 + (1 - F0) · (1 - cosθ)⁵
   ```

4. **sRGB → Linear**: `pow(c, 2.2)` (applied to baseColor and emissive textures)

**Fragment logic**:
```
1. Sample textures (baseColor, ORM, normal, emissive)
2. Linearize sRGB (baseColor, emissive)
3. Normal mapping: TBN * (normalMap * 2 - 1)
4. Compute vectors: V, L, H, NdotL, NdotV, NdotH, VdotH
5. Material: F0 = mix(0.04, baseColor, metallic), diffuseColor = baseColor * (1 - metallic)
6. Direct lighting:
   - Cook-Torrance specular: D * G * F
   - Hemispheric diffuse: mix(groundColor, diffuseColor, dot(N,L)*0.5+0.5) / π
   - Combined: (diffuse * hemiColor + specular * lightColor * NdotL) * intensity
7. IBL:
   - Diffuse: textureSampleLevel(cubemap, N, maxMip) — RGBD decoded
   - Specular: textureSampleLevel(cubemap, reflect(-V,N), roughness*maxMip) — RGBD decoded
   - BRDF LUT: textureSample(brdfLUT, vec2(NdotV, roughness)).rg
   - Combined: (iblDiffuse * diffuseColor + iblSpecular * (F0 * brdf.x + brdf.y)) * occlusion
8. Final: direct + indirect + emissive
```

---

## 4. Scene 1 Rendering Spec (from Spector.GPU Capture)

**Source**: `playground.babylonjs.com/full.html?webgpu=1#QCU8DJ#800`

### Render Pass Configuration
- 1 render pass, 3 draw calls
- Color: `bgra8unorm`, 4x MSAA → resolve to swapchain
- Depth: `depth24plus-stencil8`, 4x MSAA
- Clear color: `{r:0.2, g:0.2, b:0.3, a:1.0}`
- Viewport: 1280×720 (depends on window)

### Draw Call 1: BoomBox
- 18,108 indices (uint16), 3,575 vertices
- 4 vertex buffers: position (42900B), normal (42900B), tangent (57200B), uv (28600B)
- PBR pipeline, back-face culling, depth write enabled

### Draw Call 2: Ground Plane
- 36 indices, 24 vertices
- 2 vertex buffers: position, normal
- Background material shader

### Draw Call 3: Skybox
- 6 indices, 4 vertices
- 3 vertex buffers: position, normal, uv
- Skybox material, depth write DISABLED

### Textures (10 total)
- 4× BoomBox PBR (2048×2048): baseColor, normal, metallicRoughness, emissive
- 1× BRDF LUT (256×256 or 128×128)
- 1× Ground texture (1024×1024)
- 2× Cubemap (specular prefiltered, with mips)
- 2× Render targets (MSAA + depth)

### Camera
- ArcRotateCamera, alpha = 1.77538207638442
- Beta, radius, target: auto-computed from mesh bounds by `createDefaultCameraOrLight(true,true,true)`

### Light
- Hemispheric, direction = [0, 1, 0], intensity = 0.7

---

## 5. Data Flow Diagram

```
main.ts (e.g. scene1.ts)
  │
  ├─→ createEngine(canvas)           → Engine { device, context, format, msaaSamples }
  ├─→ createSceneContext(engine)      → SceneContext { engine, clearColor, camera:null, ... }
  │
  ├─→ loadGltf(scene, url)           → Fetches GLB, parses, uploads to GPU
  │     Returns Mesh[]                  Registers deferred builder → buildPbrRenderables()
  │
  ├─→ loadEnvironment(scene, url)    → Fetches .env, generates BRDF LUT, uploads cubemap
  │     Sets scene._envTextures         Registers deferred builder → buildBackgroundRenderables()
  │
  ├─→ createDefaultCamera(scene)     → Reads mesh bounds → auto-frames
  │     scene.camera = camera
  │
  ├─→ createHemisphericLight()       → Returns plain HemisphericLight data
  │     scene.lights.push(light)
  │
  └─→ engine.start(scene)            → Runs deferred builders (creates pipelines + renderables)
        Sorts renderables by order     → begins requestAnimationFrame loop
        Each frame:
          _prePasses → execute(encoder)    // shadow depth passes
          _uniformUpdaters → update(engine) // write UBOs
          begin render pass
          _renderables → draw(pass)        // sorted by order
          end pass, submit
```

---

## 6. Babylon.js Equivalence Map

| Babylon.js | Babylon Lite | Notes |
|-----------|-------------|-------|
| `new Engine(canvas)` | `createEngine(canvas)` | Async, returns Promise |
| `new Scene(engine)` | `createSceneContext(engine)` | Flat struct, no observables |
| `SceneLoader.Append(url)` | `loadGltf(scene, url)` | GLB only, no plugins |
| `scene.createDefaultEnvironment()` | `loadEnvironment(scene, url)` | Explicit URL |
| `scene.createDefaultCameraOrLight()` | `createDefaultCamera(scene)` + `createHemisphericLight()` | Separate functions |
| `new HemisphericLight(...)` | `createHemisphericLight(dir, intensity)` | Returns plain data |
| `new ArcRotateCamera(...)` | `createDefaultCamera(scene)` | Auto-frames, returns data |
| `PBRMaterial` | `getOrCreatePbrPipeline()` + composer | Feature-flag pipelines |
| `StandardMaterial` | `getOrCreatePipeline()` + composer | Feature-flag pipelines |
| `scene._prepareFrame()` | `engine.start()` runs deferred builders | Lazy pipeline creation |
| `engine.runRenderLoop(...)` | `engine.start(scene)` | Single scene |

---

## 7. Build & Dev Configuration

### TypeScript (`tsconfig.base.json`)
```json
{
  "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
  "lib": ["ES2022", "DOM", "DOM.Iterable"],
  "strict": true, "noUncheckedIndexedAccess": true,
  "noUnusedLocals": true, "noUnusedParameters": true,
  "types": ["@webgpu/types"]
}
```

### Vite (engine lib build)
```typescript
// packages/babylon-lite/vite.config.ts
export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'] },
    rollupOptions: { external: [] },
  },
});
```

### Package resolution
During dev, `package.json` exports point to source: `"main": "./src/index.ts"`.
For production builds, switch to `"./dist/index.js"`.

---

## 8. Test Specification

### Unit Tests (per module)
- **core/mat4**: Identity, multiply, lookAtLH, perspectiveLH, invert — compare with Babylon.js `Matrix` class output
- **core/vec3**: All operations — dot, cross, normalize, length
- **camera**: Position from alpha/beta/radius matches Babylon's formula
- **loader-gltf**: Parse known GLB → verify vertex counts, index counts, bounding box
- **loader-env**: Parse known .env → verify SH coefficients, face count, mip count
- **BRDF LUT**: Generated values within tolerance of reference

### Integration Tests (Playwright + pixel diff)
- Render Scene 1 → screenshot → RMSE against reference capture < threshold
- Automated via CI with headed Chrome (WebGPU requires GPU)

### Regression
- Every new scene must pass all previous scene tests
- Pixel diff threshold: RMSE < 1.0 (out of 255)

---

## 9. Known Limitations

- **No post-processing** — Image processing applied in-shader, no separate post-process pass
- **No LOD** — Meshes rendered at full resolution regardless of distance

---

## 10. File Manifest

| File | Purpose | Lines (approx) |
|------|---------|------|
| `src/index.ts` | Public API barrel | 95 |
| `src/math/types.ts` | Math type definitions | 45 |
| `src/math/vec3.ts` | Vec3 pure functions | 68 |
| `src/math/mat4.ts` | Mat4 pure functions | 185 |
| `src/math/observable-vec3.ts` | Reactive Vec3 (position/target) | — |
| `src/math/observable-quat.ts` | Reactive Quat (rotation) | — |
| `src/engine/engine.ts` | WebGPU device + render loop | 150 |
| `src/scene/scene.ts` | Scene context struct + add() | 130 |
| `src/scene/scene-core.ts` | Core scene logic | — |
| `src/scene/scene-camera.ts` | Camera management | — |
| `src/scene/scene-remove.ts` | removeFromScene() | — |
| `src/scene/set-parent.ts` | setParent() — parent/child transforms | — |
| `src/scene/parentable.ts` | IWorldMatrixProvider, IParentable | — |
| `src/scene/transform-node.ts` | TransformNode factory + collectMeshes | — |
| `src/scene/world-matrix-state.ts` | Version-based world matrix propagation | — |
| `src/camera/camera.ts` | Camera interface | — |
| `src/camera/arc-rotate.ts` | ArcRotateCamera | 85 |
| `src/camera/arc-rotate-controls.ts` | Orbit controls | 70 |
| `src/camera/free-camera.ts` | FreeCamera | — |
| `src/camera/free-camera-controls.ts` | WASD/arrow controls | — |
| `src/light/light-base.ts` | Shared light base | — |
| `src/light/types.ts` | LightBase type, SceneAnyLight | — |
| `src/light/light-matrix.ts` | Light view-projection for shadows | — |
| `src/light/hemispheric.ts` | Hemispheric light factory | 16 |
| `src/light/hemispheric-pbr.ts` | Hemispheric PBR variant | — |
| `src/light/point-light.ts` | Point light factory | 20 |
| `src/light/point-pbr.ts` | Point light PBR variant | — |
| `src/light/directional-light.ts` | Directional light factory | 20 |
| `src/light/directional-pbr.ts` | Directional light PBR variant | — |
| `src/light/spot-light.ts` | Spot light factory | — |
| `src/material/pipeline-cache.ts` | Shared pipeline cache utility | — |
| `src/material/pbr/pbr-material.ts` | PBR material props + factory | 25 |
| `src/material/pbr/pbr-template.ts` | PBR shader template (WGSL gen) | 230 |
| `src/material/pbr/pbr-flags.ts` | PBR feature flag bitmask | — |
| `src/material/pbr/pbr-pipeline.ts` | PBR pipeline cache | 170 |
| `src/material/pbr/pbr-renderable.ts` | PBR renderable builder | 140 |
| `src/material/pbr/pbr-single-rebuild.ts` | Single-mesh PBR rebuild | — |
| `src/material/pbr/pbr-multilight-wgsl.ts` | Multi-light WGSL generation | — |
| `src/material/pbr/background-material.ts` | Skybox + Ground material factories | 217 |
| `src/material/pbr/background-renderable.ts` | Background renderable builder | 96 |
| `src/material/pbr/background-dds-skybox.ts` | DDS environment skybox | — |
| `src/material/pbr/background-hdr-skybox.ts` | HDR environment skybox | — |
| `src/material/pbr/background-ground.ts` | Background ground plane | — |
| `src/material/pbr/fragments/` | PBR ShaderFragment modules | — |
| `src/material/standard/standard-material.ts` | Standard types + factory | 93 |
| `src/material/standard/standard-template.ts` | Standard shader template (WGSL gen) | 230 |
| `src/material/standard/standard-pipeline.ts` | Standard pipeline cache | 280 |
| `src/material/standard/standard-renderable.ts` | Standard renderable builder | 115 |
| `src/material/standard/standard-single-rebuild.ts` | Single-mesh Standard rebuild | — |
| `src/material/standard/skybox-cubemap.ts` | CubeMap skybox pipeline | 104 |
| `src/material/standard/fragments/` | Standard ShaderFragment modules | — |
| `src/shader/shader-composer.ts` | ShaderFragment composer engine | — |
| `src/shader/fragment-types.ts` | ShaderFragment interface definitions | — |
| `src/shader/ubo-layout.ts` | UBO layout helpers | — |
| `src/shader/wgsl-helpers.ts` | WGSL code-gen utilities | — |
| `src/render/renderable.ts` | Renderable/PrePass/Updater interfaces | 20 |
| `src/render/scene-helpers.ts` | Shared helper utilities | — |
| `src/render/lights-ubo.ts` | Multi-light UBO packing | — |
| `src/mesh/mesh.ts` | Mesh type and GPU upload | 80 |
| `src/mesh/mesh-factories.ts` | High-level mesh factories | 50 |
| `src/mesh/thin-instance.ts` | Thin instance CPU data + public API | — |
| `src/mesh/thin-instance-gpu.ts` | Thin instance GPU sync | — |
| `src/skeleton/create-skeleton.ts` | Skeleton data creation from glTF | — |
| `src/skeleton/skeleton-updater.ts` | Joint matrix computation | — |
| `src/animation/animation-group.ts` | AnimationGroup creation | — |
| `src/animation/evaluate.ts` | Keyframe interpolation | — |
| `src/animation/types.ts` | Animation type definitions | — |
| `src/morph/create-morph-targets.ts` | Morph target data + GPU texture | — |
| `src/picking/gpu-picker.ts` | GPU ID-pass picking | — |
| `src/picking/picking-pipeline.ts` | Picking render pipeline | — |
| `src/picking/picking-shader.ts` | Picking WGSL shaders | — |
| `src/picking/picking-helpers.ts` | getPickedNormal(), getPickedUV() | — |
| `src/picking/picking-info.ts` | PickingInfo type | — |
| `src/picking/detailed-picking.ts` | CPU ray/triangle intersection | — |
| `src/picking/ray.ts` | Ray intersection math | — |
| `src/resource/gpu-pool.ts` | GPU buffer/texture pooling | — |
| `src/shadow/shadow-base.ts` | Shared shadow logic | — |
| `src/shadow/shadow-generator.ts` | ESM shadow generator | 150 |
| `src/shadow/pcf-shadow-generator.ts` | PCF shadow generator | — |
| `src/shadow/shadow-renderable.ts` | Shadow PrePassRenderable | 80 |
| `src/texture/texture-2d.ts` | 2D texture loader | 60 |
| `src/texture/solid-texture.ts` | 1×1 solid-color factory | — |
| `src/texture/cube-texture.ts` | 6-face cube texture loader | 141 |
| `src/texture/generate-mipmaps.ts` | GPU mipmap generation | — |
| `src/loader-gltf/load-gltf.ts` | GLB parser + GPU upload | 390 |
| `src/loader-gltf/gltf-parser.ts` | glTF JSON parsing helpers | — |
| `src/loader-gltf/gltf-material.ts` | glTF material → PbrMaterialProps | — |
| `src/loader-gltf/gltf-animation.ts` | glTF animation extraction | — |
| `src/loader-env/load-env.ts` | .env parser + BRDF gen | 240 |
| `src/loader-env/load-dds-env.ts` | DDS environment loading | — |
| `src/loader-env/env-helpers.ts` | Environment helper utilities | — |
| `src/loader-env/brdf-rgbd-decode.ts` | BRDF RGBD decode helpers | — |
| `src/loader-hdr/load-hdr.ts` | HDR environment pipeline | — |
| `src/loader-hdr/hdr-parser.ts` | RGBE file parser | — |
| `src/loader-hdr/hdr-ibl-pipeline.ts` | GPU compute IBL from HDR | — |
| `src/loader-babylon/load-babylon.ts` | .babylon format parser | — |
| `src/loader-skybox/load-skybox.ts` | High-level skybox loader | — |
| `src/loader-skybox/skybox-renderable.ts` | Skybox → Renderable builder | — |
| `apps/manual-lab/src/lite/scene1.ts` | Scene 1: BoomBox PBR | 44 |
| `apps/manual-lab/src/lite/scene*.ts` | Scenes 1–22 (dev sandbox) | — |
