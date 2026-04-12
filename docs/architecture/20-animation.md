# Module: Animation
> Package path: `packages/babylon-lite/src/animation/`

## Purpose

Provides a zero-allocation keyframe animation system for glTF animations. Supports skeletal joint transforms, morph target weights, and arbitrary TRS channels. Each glTF animation clip is wrapped in an `AnimationGroup` that exposes play/pause/stop/seek controls matching the Babylon.js API surface. Evaluation runs LINEAR, STEP, and CUBICSPLINE interpolation using pre-allocated scratch buffers, with no per-frame heap allocation.

## Public API Surface

### Constants

```typescript
// Interpolation modes (numeric for hot-path comparison)
export const INTERP_LINEAR      = 0;
export const INTERP_STEP        = 1;
export const INTERP_CUBICSPLINE = 2;

// Target paths (numeric)
export const PATH_TRANSLATION = 0;
export const PATH_ROTATION    = 1;
export const PATH_SCALE       = 2;
export const PATH_WEIGHTS     = 3;
```

### Types

```typescript
export type InterpMode  = 0 | 1 | 2;
export type TargetPath  = 0 | 1 | 2 | 3;

export interface AnimationSampler {
    readonly input: Float32Array;          // keyframe timestamps (seconds, monotonically increasing)
    readonly output: Float32Array;         // packed values; CUBICSPLINE: [inTangent, value, outTangent] per key
    readonly interpolation: InterpMode;
}

export interface AnimationChannel {
    readonly samplerIdx: number;
    readonly nodeIdx: number;
    readonly path: TargetPath;
}

export interface AnimationClip {
    readonly name: string;
    readonly channels: readonly AnimationChannel[];
    readonly samplers: readonly AnimationSampler[];
    readonly duration: number;             // max of all sampler input times (seconds)
}

export interface NodeRest {
    readonly parentIdx: number;            // -1 for root nodes
    tx: number; ty: number; tz: number;    // translation
    rx: number; ry: number; rz: number; rw: number; // rotation quaternion
    sx: number; sy: number; sz: number;    // scale
}

export interface SkeletonBinding {
    readonly jointNodes: readonly number[];
    readonly inverseBindMatrices: Float32Array;
    readonly invMeshWorld: Mat4;
    readonly boneTexture: GPUTexture;
    readonly boneCount: number;
}

export interface MorphBinding {
    readonly nodeIdx: number;
    readonly weightsBuffer: GPUBuffer;
    readonly targetCount: number;          // max 4 supported
}

export interface GltfAnimationData {
    readonly clips: readonly AnimationClip[];
    readonly nodes: readonly NodeRest[];
    readonly skeletons: readonly SkeletonBinding[];
    readonly morphBindings: readonly MorphBinding[];
}

export interface SkeletonData {
    readonly boneTexture: GPUTexture;
    readonly boneCount: number;
    readonly jointsBuffer: GPUBuffer;
    readonly weightsBuffer: GPUBuffer;
    readonly joints1Buffer: GPUBuffer | null;  // 8-bone skinning
    readonly weights1Buffer: GPUBuffer | null;
}

export interface MorphTargetData {
    readonly texture: GPUTexture;
    readonly count: number;
    readonly weightsBuffer: GPUBuffer;
}
```

### AnimationGroup Interface

```typescript
export interface AnimationGroup {
    readonly name: string;
    readonly duration: number;             // seconds
    readonly isPlaying: boolean;
    currentFrame: number;                  // current time in seconds (not frames!)
    speedRatio: number;                    // default 1
    loopAnimation: boolean;               // default true
    play(): void;
    pause(): void;
    stop(): void;                          // resets to frame 0
    goToFrame(frame: number): void;        // seeks to frame/60 seconds, pauses
    _tick(deltaMs: number, device: GPUDevice): void;
    readonly _ctrl?: AnimationController;
}
```

### Functions

```typescript
export function createAnimationGroups(animData: GltfAnimationData): AnimationGroup[];

export function evaluateSampler(
    sampler: AnimationSampler,
    t: number,
    stride: number,          // 3 for vec3, 4 for quat
    isQuat: boolean,         // true → uses slerp for LINEAR, normalizes for CUBICSPLINE
    dst: Float32Array,
    dstOffset: number
): void;
```

## Internal Architecture

### Data Layout

All animation data uses flat typed arrays for GPU-friendly memory layout:

- **NodeRest**: 10 fields per node (tx,ty,tz, rx,ry,rz,rw, sx,sy,sz) stored in `GltfAnimationData.nodes[]`
- **AnimationSampler.output**: Packed contiguously:
  - LINEAR/STEP: `[value0, value1, ...]` — `stride` floats per keyframe
  - CUBICSPLINE: `[inTangent0, value0, outTangent0, inTangent1, value1, outTangent1, ...]` — `stride * 3` floats per keyframe

### Keyframe Search

`findKeyframe(input, t)` performs binary search to find index `i` such that `input[i] <= t < input[i+1]`. Returns 0 for `t <= input[0]`, and `length-2` for `t >= input[last]`.

### Scratch Buffer: `_quat`

A module-level `[0,0,0,1]` array is reused for quaternion slerp output to avoid per-call allocation.

### Frame Timing Model

- `AnimationGroup.currentFrame` stores time in **seconds** (not frame numbers, despite the name — matches BJS convention)
- `goToFrame(frame)` converts frame number to seconds: `ctrl.time = frame / 60`
- `_tick(deltaMs)` advances `ctrl.time += (deltaMs / 1000) * speedRatio`
- Duration is in seconds (max sampler input timestamp)
- Looping wraps via modulo: `time %= duration`

### AnimationGroup Creation

`createAnimationGroups()` creates one `AnimationGroup` per `AnimationClip`. Each group wraps an `AnimationController` (from `skeleton-updater.ts`) with a single-clip slice of the animation data. All groups auto-play by default (matching BJS behavior).

## Pipeline Configuration

N/A — Animation is a CPU-side system. GPU interaction is limited to:
- `device.queue.writeTexture()` for bone matrix upload (via `skeleton-updater.ts`)
- `device.queue.writeBuffer()` for morph weight upload

## Shader Logic

N/A — No shaders in this module. Skinning WGSL is in `shader/fragments/skeleton-fragment.ts`.

## State Machine / Lifecycle

```
┌─────────┐  play()   ┌─────────┐  pause()  ┌────────┐
│ STOPPED │ ────────► │ PLAYING │ ────────► │ PAUSED │
│ (t=0)   │ ◄──────── │         │ ◄──────── │        │
└─────────┘  stop()   └─────────┘  play()   └────────┘
                            │
                            │ _tick(deltaMs)
                            ▼
                      advance time, wrap/clamp,
                      evaluate channels,
                      upload bone matrices + morph weights
```

- **STOPPED**: `ctrl.playing = false`, `ctrl.time = 0`, `stopped = true`. `_tick()` returns immediately.
- **PLAYING**: `ctrl.playing = true`. Each `_tick()` advances time, evaluates samplers, uploads GPU data.
- **PAUSED**: `ctrl.playing = false`. `_tick()` still evaluates (ensures pose is current) but doesn't advance time.
- **goToFrame(f)**: Sets `ctrl.time = f/60`, sets `ctrl.playing = false` (pauses at that pose).

## Babylon.js Equivalence Map

| Babylon.js API | Babylon Lite |
|---|---|
| `AnimationGroup` | `AnimationGroup` interface |
| `AnimationGroup.play()` | `group.play()` |
| `AnimationGroup.pause()` | `group.pause()` |
| `AnimationGroup.stop()` | `group.stop()` |
| `AnimationGroup.goToFrame(f)` | `group.goToFrame(f)` (frame at 60fps) |
| `AnimationGroup.speedRatio` | `group.speedRatio` |
| `AnimationGroup.loopAnimation` | `group.loopAnimation` |
| `scene.animationGroups` | `scene.animationGroups` |
| `Animation.ANIMATIONTYPE_QUATERNION` | `PATH_ROTATION = 1` |
| `Animation.ANIMATIONTYPE_VECTOR3` | `PATH_TRANSLATION = 0`, `PATH_SCALE = 2` |

## Dependencies

- `../math/mat4.js` — `quatSlerp` for LINEAR quaternion interpolation
- `../skeleton/skeleton-updater.js` — `createAnimationController`, `AnimationController`
- `../loader-gltf/gltf-animation.ts` — `parseAnimationData` (glTF → `GltfAnimationData`)
- `../loader-gltf/gltf-parser.ts` — `resolveAccessor`, `computeNodeWorldMatrix`, `findParent`

## Test Specification

1. **LINEAR interpolation**: Verify vec3 lerp and quat slerp produce correct intermediate values
2. **STEP interpolation**: Verify output snaps to keyframe value without blending
3. **CUBICSPLINE interpolation**: Verify Hermite spline evaluation with tangents; verify quaternion normalization
4. **Binary search edge cases**: `t` before first key, after last key, exactly on a key, between keys
5. **AnimationGroup lifecycle**: play → tick → verify time advances; pause → tick → verify time frozen; stop → verify reset to 0
6. **goToFrame**: Verify `goToFrame(120)` sets time to `2.0` seconds and pauses
7. **Looping**: Verify time wraps correctly at duration boundary
8. **Speed ratio**: Verify `speedRatio = 2` doubles playback speed
9. **Morph weight upload**: Verify correct weights written to GPU buffer for PATH_WEIGHTS channels

## File Manifest

| File | Purpose |
|---|---|
| `types.ts` | All animation data types, interpolation/path constants, GPU-attached data interfaces |
| `evaluate.ts` | Keyframe interpolation engine (LINEAR, STEP, CUBICSPLINE); binary search; zero-allocation |
| `animation-group.ts` | User-facing AnimationGroup factory; wraps AnimationController per clip |
