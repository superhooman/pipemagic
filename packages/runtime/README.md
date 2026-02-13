# pipemagic

Browser-based image processing pipeline runtime. Chain together GPU-accelerated operations like background removal, normalization, outlining, and upscaling — no server required.

Built for the [PipeMagic](https://github.com/mo1app/pipemagic) visual pipeline editor, but works standalone in any web app.

## Install

```sh
npm install pipemagic
```

Background removal requires `@huggingface/transformers` (optional peer dependency):

```sh
npm install @huggingface/transformers
```

## Quick Start

```ts
import { PipeMagic } from 'pipemagic'

const pm = new PipeMagic()

const result = await pm.run(pipeline, imageFile, {
  onNodeProgress(nodeId, progress) {
    console.log(`${nodeId}: ${Math.round(progress * 100)}%`)
  },
})

// result.blob  → output image as Blob
// result.width, result.height → dimensions
```

## Pipeline Definition

Pipelines are JSON graphs of nodes and edges. Each node has a type, parameters, and connects to other nodes via edges:

```ts
import type { PipelineDefinition } from 'pipemagic'

const stickerPipeline: PipelineDefinition = {
  version: 1,
  nodes: [
    { id: 'in',        type: 'input',     position: { x: 0, y: 0 }, params: { maxSize: 2048, fit: 'contain' } },
    { id: 'rmbg',      type: 'remove-bg', position: { x: 1, y: 0 }, params: { threshold: 0.5, device: 'auto', dtype: 'fp16' } },
    { id: 'norm',      type: 'normalize', position: { x: 2, y: 0 }, params: { size: 2048, padding: 160 } },
    { id: 'outline',   type: 'outline',   position: { x: 3, y: 0 }, params: { thickness: 50, color: '#ffffff', opacity: 1, quality: 'high', position: 'outside', threshold: 5 } },
    { id: 'upscale',   type: 'upscale',   position: { x: 4, y: 0 }, params: { model: 'cnn-2x-l', contentType: 'rl' } },
    { id: 'out',       type: 'output',    position: { x: 5, y: 0 }, params: { format: 'png', quality: 0.92 } },
  ],
  edges: [
    { id: 'e1', source: 'in',      sourceHandle: 'output', target: 'rmbg',    targetHandle: 'input' },
    { id: 'e2', source: 'rmbg',    sourceHandle: 'output', target: 'norm',    targetHandle: 'input' },
    { id: 'e3', source: 'norm',    sourceHandle: 'output', target: 'outline', targetHandle: 'input' },
    { id: 'e4', source: 'outline', sourceHandle: 'output', target: 'upscale', targetHandle: 'input' },
    { id: 'e5', source: 'upscale', sourceHandle: 'output', target: 'out',     targetHandle: 'input' },
  ],
}
```

## Node Types

### `input`

Resizes the source image to fit within bounds.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `maxSize` | `number` | `2048` | Maximum width/height |
| `fit` | `'contain' \| 'cover' \| 'fill'` | `'contain'` | Resize mode |

### `remove-bg`

Removes the background using [RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4) via transformers.js. Requires `@huggingface/transformers`.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `threshold` | `number` | `0.5` | Segmentation threshold |
| `device` | `'webgpu' \| 'wasm' \| 'auto'` | `'auto'` | Inference device |
| `dtype` | `'fp32' \| 'fp16' \| 'q8'` | `'fp16'` | Model precision |

### `normalize`

Crops to content bounding box and centers on a square canvas with padding.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `size` | `number` | `1024` | Output canvas size |
| `padding` | `number` | `16` | Padding around content |

### `outline`

Adds an outline around non-transparent content using Jump Flooding Algorithm (WebGPU) with canvas fallback.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `thickness` | `number` | `4` | Outline width in pixels |
| `color` | `string` | `'#ffffff'` | Outline color (hex) |
| `opacity` | `number` | `1` | Outline opacity (0-1) |
| `quality` | `'low' \| 'medium' \| 'high'` | `'medium'` | Rendering quality |
| `position` | `'outside' \| 'center' \| 'inside'` | `'outside'` | Outline placement |
| `threshold` | `number` | `0` | Distance field offset |

### `upscale`

2x upscaling via [WebSR](https://github.com/nicknbytes/websr) (loaded from CDN at runtime). Requires WebGPU.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | `'cnn-2x-s' \| 'cnn-2x-m' \| 'cnn-2x-l'` | `'cnn-2x-s'` | Model size |
| `contentType` | `'rl' \| 'an' \| '3d'` | `'rl'` | Content type hint |

### `output`

Encodes the final image as a Blob.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `format` | `'png' \| 'jpeg' \| 'webp'` | `'png'` | Output format |
| `quality` | `number` | `0.92` | Compression quality |

## Callbacks

All callbacks are optional:

```ts
await pm.run(pipeline, image, {
  // Per-node progress (0 to 1)
  onNodeProgress(nodeId, progress) { },

  // Status changes: 'pending' | 'running' | 'done' | 'error' | 'cached'
  onNodeStatus(nodeId, status, error?) { },

  // Status messages (e.g. "Loading model...", "Upscaling...")
  onNodeStatusMessage(nodeId, message) { },

  // Model download progress (0 to 1, or null when done)
  onNodeDownloadProgress(nodeId, progress) { },

  // AbortSignal to cancel the pipeline
  signal: abortController.signal,
})
```

## Using Individual Executors

You can also use executors directly without a pipeline:

```ts
import { executeRemoveBg, executeOutline, initGpu, getGpuDevice, createFrame } from 'pipemagic'

await initGpu()

const inputFrame = createFrame(await createImageBitmap(file))
const ctx = {
  abortSignal: new AbortController().signal,
  gpuDevice: getGpuDevice(),
  onProgress: () => {},
  onStatus: () => {},
}

const result = await executeRemoveBg(ctx, [inputFrame], { threshold: 0.5, device: 'auto', dtype: 'fp16' })
```

## Browser Requirements

- **WebGPU** — required for outline (JFA) and upscale (WebSR). Falls back to canvas for outline if unavailable.
- **SharedArrayBuffer** — required by the ONNX runtime used in background removal. Your page needs these headers:
  ```
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Opener-Policy: same-origin
  ```
- Models and WebSR weights are loaded from CDN on first use — no bundling required.

## License

MIT
