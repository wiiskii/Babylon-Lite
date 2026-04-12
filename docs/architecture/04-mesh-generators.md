# Module: Mesh Generators

> Package path: `packages/babylon-lite/src/mesh/`

## Purpose

Procedural mesh generation for four primitive shapes: ground (with heightmap support), torus, UV sphere, and box. Each generator produces CPU-side vertex data (positions, normals, UVs, indices) and provides a companion function to upload the data to GPU buffers. All generators match Babylon.js `MeshBuilder` output exactly.

---

## Public API Surface

### Ground (`create-ground.ts`)

```typescript
export interface GroundData {
    positions: Float32Array; // vertexCount × 3
    normals: Float32Array; // vertexCount × 3
    uvs: Float32Array; // vertexCount × 2
    indices: Uint32Array; // indexCount
}

export interface GroundOptions {
    width?: number; // Default: 1
    height?: number; // Default: 1
    subdivisions?: number; // Default: 1
    minHeight?: number; // Default: 0
    maxHeight?: number; // Default: 1
}

export interface GroundGPU {
    positionBuffer: GPUBuffer;
    normalBuffer: GPUBuffer;
    uvBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
    indexCount: number;
}

export function createFlatGroundData(opts?: GroundOptions): GroundData;

export function applyHeightmap(
    ground: GroundData,
    heightmapData: Uint8ClampedArray,
    hmWidth: number,
    hmHeight: number,
    subdivisions: number,
    minHeight: number,
    maxHeight: number
): void;

export async function createGroundFromHeightMap(heightmapUrl: string, opts?: GroundOptions): Promise<GroundData>;
```

### Torus (`create-torus.ts`)

```typescript
export interface TorusData {
    positions: Float32Array; // vertexCount × 3
    normals: Float32Array; // vertexCount × 3
    uvs: Float32Array; // vertexCount × 2
    indices: Uint32Array; // indexCount
}

export interface TorusOptions {
    diameter?: number; // Default: 1
    thickness?: number; // Default: 0.5
    tessellation?: number; // Default: 16
}

export interface TorusGPU {
    positionBuffer: GPUBuffer;
    normalBuffer: GPUBuffer;
    uvBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
    indexCount: number;
}

export function createTorusData(opts?: TorusOptions): TorusData;
export function uploadTorusToGPU(device: GPUDevice, data: TorusData): TorusGPU;
```

### Sphere (`create-sphere.ts`)

```typescript
export interface SphereMeshData {
    positions: Float32Array; // vertexCount × 3
    normals: Float32Array; // vertexCount × 3
    indices: Uint32Array; // indexCount
    vertexCount: number;
    indexCount: number;
}

export interface SphereOptions {
    segments?: number; // Default: 32 (minimum: 3)
    diameter?: number; // Default: 1
    diameterX?: number; // Default: diameter
    diameterY?: number; // Default: diameter
    diameterZ?: number; // Default: diameter
}

export function createSphereData(options?: SphereOptions): SphereMeshData;

export function uploadSphereToGPU(device: GPUDevice, data: SphereMeshData): { posBuffer: GPUBuffer; normBuffer: GPUBuffer; idxBuffer: GPUBuffer; idxCount: number };
```

### Box (`create-box.ts`)

```typescript
export interface BoxData {
    positions: Float32Array; // 24 × 3 = 72 floats
    normals: Float32Array; // 24 × 3 = 72 floats
    indices: Uint32Array; // 36 indices
    vertexCount: number; // always 24
    indexCount: number; // always 36
}

export interface BoxGPU {
    posBuffer: GPUBuffer;
    normBuffer: GPUBuffer;
    idxBuffer: GPUBuffer;
    idxCount: number;
}

export function createBoxData(size?: number): BoxData; // Default: size = 1
export function uploadBoxToGPU(device: GPUDevice, data: BoxData): BoxGPU;
```

---

## Internal Architecture

### Ground

**Grid layout:** `(subdivisions + 1) × (subdivisions + 1)` vertices.

**Vertex counts:**

- Vertices: `(subdivisions + 1)²`
- Indices: `subdivisions² × 6`

**Vertex position formula:**

```
x = -width/2 + (col / subdivisions) * width
y = 0 (flat; displaced by heightmap)
z = -height/2 + (1 - row / subdivisions) * height
```

**UV formula:**

```
u = col / subdivisions
v = 1 - row / subdivisions
```

**Initial normals:** All `(0, 1, 0)` (up).

**Index generation (per quad):**

```
topLeft     = row * cols + col
topRight    = topLeft + 1
bottomLeft  = (row + 1) * cols + col
bottomRight = bottomLeft + 1

Triangle 1: topLeft, bottomLeft, bottomRight
Triangle 2: topLeft, bottomRight, topRight
```

**Heightmap displacement (`applyHeightmap`):**

1. For each vertex at `(row, col)`:
    - Sample heightmap at pixel `(px, py)`:
        ```
        u = col / subdivisions
        v = row / subdivisions  (row 0 = top of image)
        px = floor(u * (hmWidth - 1))
        py = floor(v * (hmHeight - 1))
        ```
    - Compute weighted luminance: `gradient = r * 0.3 + g * 0.59 + b * 0.11`
    - Displace Y: `position.y = minHeight + gradient * (maxHeight - minHeight)`

2. Recompute normals:
    - Reset all normals to zero
    - For each triangle: compute face normal via cross product of edge vectors, **negate** the result (due to Z-flip from `1 - row/subdivisions`), normalize to unit length, then accumulate onto each triangle's 3 vertices
    - Normalize all vertex normals

**Cross product formula for face normals:**

```
e1 = p1 - p0
e2 = p2 - p0
fn = -(e1 × e2)          // negated
fn = fn / |fn|            // normalize before accumulation
```

**Async heightmap loading (`createGroundFromHeightMap`):**

1. Create flat ground data
2. Load image via `new Image()` with `crossOrigin = 'anonymous'`
3. Draw to canvas, extract `ImageData`
4. Call `applyHeightmap`

### Torus

**Parameterization (matches Babylon.js `Mesh.CreateTorus`):**

```
R = diameter / 2          // major radius (default: 0.5)
r = thickness / 2         // tube radius (default: 0.25)
stride = tessellation + 1

outerAngle = i * 2π / tessellation - π/2    // around major ring
innerAngle = j * 2π / tessellation + π      // around tube cross-section
```

**Vertex counts:**

- Vertices: `(tessellation + 1)²`
- Indices: `(tessellation + 1)² × 6` (includes wrapping seam geometry)

**Position formula:**

```
dx = cos(innerAngle)
dy = sin(innerAngle)

x =  (dx * r + R) * cos(outerAngle)
y =  dy * r
z = -(dx * r + R) * sin(outerAngle)
```

**Normal formula** (rotate tube normal by Y-axis rotation):

```
nx =  dx * cos(outerAngle)
ny =  dy
nz = -dx * sin(outerAngle)
```

**UV formula:**

```
u = i / tessellation
v = 1 - j / tessellation
```

**Index generation** (per quad with wrapping):

```
nextI = (i + 1) % stride
nextJ = (j + 1) % stride

Triangle 1: (i*stride + j), (i*stride + nextJ), (nextI*stride + j)
Triangle 2: (i*stride + nextJ), (nextI*stride + nextJ), (nextI*stride + j)
```

### Sphere

**Parameterization (matches Babylon.js `MeshBuilder.CreateSphere`):**

```
totalZRotationSteps = 2 + segments     // vertical rows
totalYRotationSteps = 2 * totalZRotationSteps  // horizontal columns

rx = (diameterX ?? diameter) / 2       // default: 0.5
ry = (diameterY ?? diameter) / 2
rz = (diameterZ ?? diameter) / 2
```

**Default tessellation:** `segments = 32` → `totalZ = 34, totalY = 68` → `35 × 69 = 2415` vertices.

**Vertex counts:**

- Vertices: `(totalZRotationSteps + 1) × (totalYRotationSteps + 1)`
- Indices: `totalZRotationSteps × totalYRotationSteps × 6`

**Position formula:**

```
angleZ = (zStep / totalZRotationSteps) * π       // polar angle [0, π]
angleY = (yStep / totalYRotationSteps) * 2π      // azimuthal angle [0, 2π]

nx = sin(angleZ) * cos(angleY)
ny = cos(angleZ)
nz = sin(angleZ) * sin(angleY)

position = (rx * nx, ry * ny, rz * nz)
normal   = (nx, ny, nz)
```

**Index generation** (per quad):

```
a = zStep * (totalYRotationSteps + 1) + yStep
b = a + totalYRotationSteps + 1

Triangle 1: a, b, a+1
Triangle 2: a+1, b, b+1
```

**Note:** No UV coordinates are generated. The sphere only has positions, normals, and indices.

### Box

**Static geometry** — uses pre-computed constant arrays.

**Vertex count:** 24 (4 per face × 6 faces)
**Index count:** 36 (2 triangles × 3 indices × 6 faces)

**Face order:** +Z, -Z, +X, -X, +Y, -Y

**Vertex positions (at size = 1, half-extent = 0.5):**

| Face | V0             | V1              | V2               | V3              | Normal   |
| ---- | -------------- | --------------- | ---------------- | --------------- | -------- |
| +Z   | (0.5,-0.5,0.5) | (-0.5,-0.5,0.5) | (-0.5,0.5,0.5)   | (0.5,0.5,0.5)   | (0,0,1)  |
| -Z   | (0.5,0.5,-0.5) | (-0.5,0.5,-0.5) | (-0.5,-0.5,-0.5) | (0.5,-0.5,-0.5) | (0,0,-1) |
| +X   | (0.5,0.5,-0.5) | (0.5,-0.5,-0.5) | (0.5,-0.5,0.5)   | (0.5,0.5,0.5)   | (1,0,0)  |
| -X   | (-0.5,0.5,0.5) | (-0.5,-0.5,0.5) | (-0.5,-0.5,-0.5) | (-0.5,0.5,-0.5) | (-1,0,0) |
| +Y   | (-0.5,0.5,0.5) | (-0.5,0.5,-0.5) | (0.5,0.5,-0.5)   | (0.5,0.5,0.5)   | (0,1,0)  |
| -Y   | (0.5,-0.5,0.5) | (0.5,-0.5,-0.5) | (-0.5,-0.5,-0.5) | (-0.5,-0.5,0.5) | (0,-1,0) |

**Index pattern per face:**

```
[base+0, base+1, base+2], [base+0, base+2, base+3]
```

Complete indices:

```
[0,1,2], [0,2,3],  [4,5,6], [4,6,7],  [8,9,10], [8,10,11],
[12,13,14], [12,14,15],  [16,17,18], [16,18,19],  [20,21,22], [20,22,23]
```

**Scaling:** When `size ≠ 1`, all position coordinates are multiplied by `size`. Normals remain unchanged. When `size = 1`, the pre-computed `BOX_POSITIONS` constant is returned directly (no allocation).

### GPU Upload Pattern

All generators follow the same GPU upload pattern:

```typescript
// Per-attribute buffer creation
const buffer = device.createBuffer({
    size: data.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true, // (ground, torus, sphere)
    // OR: writeBuffer after creation (box)
});
new Float32Array(buffer.getMappedRange()).set(data);
buffer.unmap();
```

**Index buffers** use `GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST` with `Uint32Array`.

**Box variant:** Uses `device.queue.writeBuffer()` instead of `mappedAtCreation`.

### Vertex Data Layout

All generators use **separate buffers** (not interleaved):

| Buffer   | Stride | Format    | Content    |
| -------- | ------ | --------- | ---------- |
| Position | 12B    | float32x3 | xyz coords |
| Normal   | 12B    | float32x3 | xyz normal |
| UV       | 8B     | float32x2 | uv coords  |
| Index    | 4B     | uint32    | indices    |

**Exception:** Sphere and Box do not generate UV coordinates.

---

## Pipeline Configuration

Mesh generators do not create pipelines. They produce raw vertex data consumed by material pipelines (e.g., `standard-textured-material.ts`). The expected pipeline vertex layout is:

| Slot | Stride | Location | Format    | Buffer   |
| ---- | ------ | -------- | --------- | -------- |
| 0    | 12B    | 0        | float32x3 | position |
| 1    | 12B    | 1        | float32x3 | normal   |
| 2    | 8B     | 2        | float32x2 | uv       |

---

## Shader Logic

No shaders. Mesh generators are CPU-only geometry producers.

---

## State Machine / Lifecycle

### Ground Lifecycle

```
Option A: Flat ground
  createFlatGroundData(opts) → GroundData

Option B: Heightmap ground
  createGroundFromHeightMap(url, opts) → GroundData  (async)
    ├─ createFlatGroundData(opts)
    ├─ Load image via HTMLImageElement
    ├─ Draw to canvas, extract ImageData
    └─ applyHeightmap(ground, imageData, ...)

Option C: Manual heightmap
  createFlatGroundData(opts) → GroundData
  applyHeightmap(ground, pixelData, ...)
```

### Other Shapes

```
createTorusData(opts) → TorusData → uploadTorusToGPU(device, data) → TorusGPU
createSphereData(opts) → SphereMeshData → uploadSphereToGPU(device, data) → {posBuffer, normBuffer, idxBuffer, idxCount}
createBoxData(size) → BoxData → uploadBoxToGPU(device, data) → BoxGPU
```

All are single-call, synchronous generators (except `createGroundFromHeightMap` which is async).

---

## Babylon.js Equivalence Map

| Babylon Lite                           | Babylon.js                                                      |
| -------------------------------------- | --------------------------------------------------------------- |
| `createFlatGroundData(opts)`           | `MeshBuilder.CreateGround(name, opts, scene)`                   |
| `createGroundFromHeightMap(url, opts)` | `MeshBuilder.CreateGroundFromHeightMap(name, url, opts, scene)` |
| `applyHeightmap()`                     | Internal: `GroundMesh._applyDisplacementMap()`                  |
| Luminance: `r*0.3 + g*0.59 + b*0.11`   | Same luminance formula in Babylon                               |
| `createTorusData(opts)`                | `MeshBuilder.CreateTorus(name, opts, scene)`                    |
| Torus outer angle offset `-π/2`        | Babylon's torus starts at -π/2 rotation                         |
| Torus inner angle offset `+π`          | Babylon's tube cross-section starts at +π                       |
| `createSphereData(opts)`               | `MeshBuilder.CreateSphere(name, opts, scene)`                   |
| `totalZ = 2 + segments`                | Babylon's sphere tessellation formula                           |
| `totalY = 2 * totalZ`                  | Babylon's sphere azimuthal step count                           |
| `createBoxData(size)`                  | `MeshBuilder.CreateBox(name, { size }, scene)`                  |
| Face order: +Z,-Z,+X,-X,+Y,-Y          | Same face order in Babylon                                      |
| Separate pos/normal/uv buffers         | Babylon uses `VertexBuffer` per kind                            |

---

## Dependencies

- None (all generators are self-contained)
- WebGPU API types (GPUDevice, GPUBuffer)
- Browser APIs: `Image`, `HTMLCanvasElement`, `CanvasRenderingContext2D` (ground heightmap only)

---

## Test Specification

### Ground

1. **Flat ground dimensions** — With `width=10, height=10, subdivisions=4`: 25 vertices, 96 indices.
2. **Position range** — Vertex X in `[-width/2, width/2]`, Z in `[-height/2, height/2]`, Y = 0.
3. **UV range** — All UVs in [0, 1].
4. **Heightmap luminance** — Pixel `(255, 0, 0)` → gradient = `0.3`. With minHeight=0, maxHeight=10: Y = 3.0.
5. **Normal recomputation** — After heightmap: all normals should be unit length, Y-dominant for gentle slopes.
6. **Winding** — CCW front face (consistent with `frontFace: 'ccw'` in pipeline).

### Torus

7. **Vertex count** — With `tessellation=16`: `(17)² = 289` vertices, `289 × 6 = 1734` indices.
8. **Symmetry** — Torus should be symmetric about Y axis.
9. **Major radius** — Vertex distance from Y-axis should be approximately `R ± r`.
10. **UV wrap** — UVs should tile correctly with wrapping indices.

### Sphere

11. **Default tessellation** — `segments=32`: `35 × 69 = 2415` vertices, `34 × 68 × 6 = 13872` indices.
12. **Unit radius** — With `diameter=1`: all vertex positions should have magnitude ≈ 0.5.
13. **Poles** — Top pole at `(0, ry, 0)`, bottom pole at `(0, -ry, 0)`.
14. **Normal direction** — Each normal should point radially outward from origin.
15. **Ellipsoid** — With `diameterX=2, diameterY=1, diameterZ=1`: positions scaled non-uniformly but normals remain on unit sphere.

### Box

16. **Counts** — Always 24 vertices, 36 indices regardless of size.
17. **Size=1 optimization** — Returns pre-computed constant arrays directly.
18. **Size scaling** — `size=2`: all positions multiplied by 2, normals unchanged.
19. **Face normals** — Each face has 4 identical axis-aligned normals.
20. **No UV** — Box does not generate UV coordinates.

---

## File Manifest

| File                        | Role                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `src/mesh/create-ground.ts` | Ground plane with heightmap: flat generation, displacement, normal recomputation, GPU upload |
| `src/mesh/create-torus.ts`  | Torus: parametric ring mesh generation, GPU upload                                           |
| `src/mesh/create-sphere.ts` | UV sphere: parametric sphere generation, GPU upload                                          |
| `src/mesh/create-box.ts`    | Box: static 6-face geometry from constant arrays, GPU upload                                 |
