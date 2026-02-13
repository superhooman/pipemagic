import type { PipelineDefinition } from './types/pipeline'
import type { RunOptions, RunResult } from './runner'
import { runPipeline } from './runner'
import { initGpu, getGpuDevice } from './utils/gpu'

export class PipeMagic {
  private gpuInitialized = false

  async run(
    pipeline: PipelineDefinition,
    inputImage: Blob | File | ImageBitmap,
    options: RunOptions = {},
  ): Promise<RunResult> {
    // Init GPU once
    if (!this.gpuInitialized) {
      await initGpu()
      this.gpuInitialized = true
    }

    // Convert input to ImageBitmap if needed
    let bitmap: ImageBitmap
    if (inputImage instanceof ImageBitmap) {
      bitmap = inputImage
    } else {
      bitmap = await createImageBitmap(inputImage)
    }

    return runPipeline(pipeline, bitmap, getGpuDevice(), options)
  }
}

// Re-export everything consumers might need
export { runPipeline } from './runner'
export type { RunOptions, RunResult } from './runner'
export type { NodeExecutor } from './runner'

export { initGpu, getGpuDevice } from './utils/gpu'

export type {
  ImageFrame,
  NodeStatus,
  NodeState,
  ExecutionContext,
  NodeType,
  NodePosition,
  NodeDef,
  EdgeDef,
  PipelineDefinition,
  InputNodeParams,
  OutputNodeParams,
  RemoveBgParams,
  UpscaleParams,
  NormalizeParams,
  OutlineParams,
  NodeParamsMap,
} from './types'
export { createDefaultNodeState, DEFAULT_PARAMS } from './types'

export {
  topoSort,
  hasCycle,
  validatePipeline,
  getUpstreamNodes,
  getDownstreamNodes,
} from './utils/graph'
export type { ValidationError } from './utils/graph'

export { computeCacheKey } from './utils/hash'

export {
  bitmapToCanvas,
  bitmapToImageData,
  imageDataToBitmap,
  resizeBitmap,
  bitmapToBlob,
  fileToBitmap,
  bitmapToDataUrl,
} from './utils/image'

export {
  bitmapToTexture,
  textureToBitmap,
  createFrame,
} from './utils/gpu'

export { executeRemoveBg } from './executors/remove-bg'
export { executeNormalize } from './executors/normalize'
export { executeUpscale } from './executors/upscale'
export { executeOutline } from './executors/outline'
