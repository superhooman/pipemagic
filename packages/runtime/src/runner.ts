import type { NodeType, NodeDef, EdgeDef, PipelineDefinition } from './types/pipeline'
import type { ImageFrame } from './types/image-frame'
import type { ExecutionContext, NodeStatus, NodeState } from './types/execution'
import { createDefaultNodeState } from './types/execution'
import { topoSort, getUpstreamNodes, validatePipeline } from './utils/graph'
import { computeCacheKey } from './utils/hash'
import { resizeBitmap } from './utils/image'
import { createFrame } from './utils/gpu'
import { executeRemoveBg } from './executors/remove-bg'
import { executeUpscale } from './executors/upscale'
import { executeNormalize } from './executors/normalize'
import { executeOutline } from './executors/outline'

export type NodeExecutor = (
  ctx: ExecutionContext,
  inputs: ImageFrame[],
  params: Record<string, unknown>,
) => Promise<ImageFrame>

const executors: Record<string, NodeExecutor> = {
  'remove-bg': executeRemoveBg,
  'normalize': executeNormalize,
  'upscale': executeUpscale,
  'outline': executeOutline,
}

export interface RunOptions {
  signal?: AbortSignal
  onNodeProgress?: (nodeId: string, progress: number) => void
  onNodeStatus?: (nodeId: string, status: NodeStatus, error?: string) => void
  onNodeStatusMessage?: (nodeId: string, message: string | null) => void
  onNodeDownloadProgress?: (nodeId: string, progress: number | null) => void
}

export interface RunResult {
  blob: Blob
  width: number
  height: number
  nodeOutputs: Map<string, ImageFrame>
}

export async function runPipeline(
  pipeline: PipelineDefinition,
  inputImage: ImageBitmap,
  gpuDevice: GPUDevice | null,
  options: RunOptions = {},
): Promise<RunResult> {
  const { nodes, edges } = pipeline
  const { signal, onNodeProgress, onNodeStatus, onNodeStatusMessage, onNodeDownloadProgress } = options

  // Validate
  const errors = validatePipeline(nodes, edges)
  if (errors.length > 0) {
    throw new Error(`Pipeline validation failed: ${errors.map(e => e.message).join('; ')}`)
  }

  // Set up abort
  const abortSignal = signal ?? new AbortController().signal

  // Local node state (replaces Pinia store)
  const nodeStates = new Map<string, NodeState>()
  for (const node of nodes) {
    nodeStates.set(node.id, createDefaultNodeState())
  }

  function updateState(nodeId: string, update: Partial<NodeState>) {
    const state = nodeStates.get(nodeId)
    if (state) Object.assign(state, update)
  }

  // Build execution context
  const ctx: ExecutionContext = {
    abortSignal,
    gpuDevice,
    onProgress: (nodeId, progress) => {
      updateState(nodeId, { progress })
      onNodeProgress?.(nodeId, progress)
    },
    onStatus: (nodeId, status, error) => {
      updateState(nodeId, { status, error: error || null })
      onNodeStatus?.(nodeId, status, error)
    },
    onStatusMessage: (nodeId, message) => {
      updateState(nodeId, { statusMessage: message })
      onNodeStatusMessage?.(nodeId, message)
    },
    onDownloadProgress: (nodeId, progress) => {
      updateState(nodeId, { downloadProgress: progress })
      onNodeDownloadProgress?.(nodeId, progress)
    },
  }

  // Topo sort
  const order = topoSort(nodes, edges)

  // Store the input image as a frame for input nodes
  const inputFrame = createFrame(inputImage)

  // Track last output for returning
  let lastOutputFrame: ImageFrame | null = null

  // Execute in order
  for (const nodeId of order) {
    if (abortSignal.aborted) throw new DOMException('Aborted', 'AbortError')

    const node = nodes.find(n => n.id === nodeId)
    if (!node) continue

    const nodeType = node.type as NodeType
    const params = node.params || {}

    // Gather inputs from upstream nodes
    const upstreamIds = getUpstreamNodes(nodeId, edges)
    const inputs: ImageFrame[] = []
    const inputRevisions: number[] = []

    for (const upId of upstreamIds) {
      const upState = nodeStates.get(upId)
      if (upState?.output) {
        inputs.push(upState.output)
        inputRevisions.push(upState.output.revision)
      }
    }

    // Check cache
    const cacheKey = computeCacheKey(nodeId, params, inputRevisions)
    const existingState = nodeStates.get(nodeId)!
    if (existingState.cacheKey === cacheKey && existingState.output) {
      updateState(nodeId, { status: 'cached' })
      onNodeStatus?.(nodeId, 'cached')
      if (nodeType === 'output') lastOutputFrame = existingState.output
      continue
    }

    // Execute
    updateState(nodeId, { status: 'running', progress: 0 })
    onNodeStatus?.(nodeId, 'running')

    try {
      let output: ImageFrame

      if (nodeType === 'input') {
        const maxSize = (params.maxSize as number) || 2048
        const fit = (params.fit as 'contain' | 'cover' | 'fill') || 'contain'
        const resized = await resizeBitmap(inputFrame.bitmap, maxSize, fit)
        output = createFrame(resized)
      } else if (nodeType === 'output') {
        if (inputs.length === 0) throw new Error('No input to output node')
        output = inputs[0]
      } else {
        const executor = executors[nodeType]
        if (!executor) throw new Error(`No executor for node type: ${nodeType}`)
        if (inputs.length === 0) throw new Error('No input image')
        // Create per-node context with correct nodeId in progress callback
        const nodeCtx: ExecutionContext = {
          ...ctx,
          onProgress: (_id, progress) => ctx.onProgress(nodeId, progress),
          onStatus: (_id, status, error) => ctx.onStatus(nodeId, status, error),
          onStatusMessage: (_id, message) => ctx.onStatusMessage?.(nodeId, message),
          onDownloadProgress: (_id, progress) => ctx.onDownloadProgress?.(nodeId, progress),
        }
        output = await executor(nodeCtx, inputs, params)
      }

      updateState(nodeId, {
        status: 'done',
        progress: 1,
        statusMessage: null,
        downloadProgress: null,
        output,
        cacheKey,
        error: null,
      })
      onNodeStatus?.(nodeId, 'done')

      if (nodeType === 'output') lastOutputFrame = output
    } catch (e: any) {
      if (e.name === 'AbortError' || abortSignal.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }
      updateState(nodeId, {
        status: 'error',
        error: e.message || 'Unknown error',
      })
      onNodeStatus?.(nodeId, 'error', e.message)
    }
  }

  if (!lastOutputFrame) {
    throw new Error('Pipeline produced no output')
  }

  // Find the output node's format params for blob conversion
  const outputNode = nodes.find(n => n.type === 'output')
  const format = (outputNode?.params?.format as 'png' | 'jpeg' | 'webp') || 'png'
  const quality = (outputNode?.params?.quality as number) ?? 0.92

  const { bitmapToBlob } = await import('./utils/image')
  const blob = await bitmapToBlob(lastOutputFrame.bitmap, format, quality)

  // Collect all node outputs
  const nodeOutputs = new Map<string, ImageFrame>()
  for (const [id, state] of nodeStates) {
    if (state.output) nodeOutputs.set(id, state.output)
  }

  return {
    blob,
    width: lastOutputFrame.width,
    height: lastOutputFrame.height,
    nodeOutputs,
  }
}
