import { usePipelineStore } from '~/stores/pipeline'
import {
  initGpu,
  getGpuDevice,
  createFrame,
  topoSort,
  getUpstreamNodes,
  validatePipeline,
  computeCacheKey,
  resizeBitmap,
  executeRemoveBg,
  executeUpscale,
  executeNormalize,
  executeOutline,
} from 'pipemagic'
import type {
  NodeType,
  NodeDef,
  EdgeDef,
  ImageFrame,
  ExecutionContext,
  NodeExecutor,
} from 'pipemagic'

const executors: Record<string, NodeExecutor> = {
  'remove-bg': executeRemoveBg,
  'normalize': executeNormalize,
  'upscale': executeUpscale,
  'outline': executeOutline,
}

export function usePipelineRunner() {
  const store = usePipelineStore()
  const runError = ref<string | null>(null)

  async function run() {
    // Validate
    const nodeDefs = store.nodes.map(n => ({
      id: n.id,
      type: n.type as NodeType,
      position: n.position,
      params: n.data?.params || {},
    })) as NodeDef[]

    const edgeDefs = store.edges.map(e => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle || 'output',
      target: e.target,
      targetHandle: e.targetHandle || 'input',
    })) as EdgeDef[]

    const errors = validatePipeline(nodeDefs, edgeDefs)
    if (errors.length > 0) {
      const msg = errors.map(e => e.message).join('\n')
      console.warn('Pipeline validation errors:', msg)
      runError.value = msg
      return
    }

    // Check input images
    const inputNodes = store.nodes.filter(n => n.type === 'input')
    for (const inputNode of inputNodes) {
      if (!store.inputImages.has(inputNode.id)) {
        runError.value = 'Please add an image to the Input node before running.'
        return
      }
    }
    runError.value = null

    // Init GPU (optional)
    await initGpu()

    // Set up abort
    const abortController = new AbortController()
    store.abortController = abortController
    store.isRunning = true

    // Clear previous execution states (keep caches)
    for (const node of store.nodes) {
      const state = store.getNodeState(node.id)
      if (state.status !== 'done' && state.status !== 'cached') {
        store.updateNodeState(node.id, { status: 'pending', progress: 0, error: null })
      }
    }

    // Build execution context
    const ctx: ExecutionContext = {
      abortSignal: abortController.signal,
      gpuDevice: getGpuDevice(),
      onProgress: (nodeId, progress) => {
        store.updateNodeState(nodeId, { progress })
      },
      onStatus: (nodeId, status, error) => {
        store.updateNodeState(nodeId, { status, error: error || null })
      },
      onStatusMessage: (nodeId, message) => {
        store.updateNodeState(nodeId, { statusMessage: message })
      },
      onDownloadProgress: (nodeId, progress) => {
        store.updateNodeState(nodeId, { downloadProgress: progress })
      },
    }

    try {
      // Topo sort
      const order = topoSort(nodeDefs, edgeDefs)
      console.log('[pipeline] execution order:', order)

      // Execute in order
      for (const nodeId of order) {
        if (abortController.signal.aborted) break

        const node = store.nodes.find(n => n.id === nodeId)
        if (!node) continue

        const nodeType = node.type as NodeType
        const params = node.data?.params || {}
        console.log(`[pipeline] executing node ${nodeId} (${nodeType})`)

        // Gather inputs from upstream nodes
        const upstreamIds = getUpstreamNodes(nodeId, edgeDefs)
        const inputs: ImageFrame[] = []
        const inputRevisions: number[] = []

        for (const upId of upstreamIds) {
          const upState = store.getNodeState(upId)
          if (upState.output) {
            inputs.push(upState.output)
            inputRevisions.push(upState.output.revision)
          }
        }

        // Check cache
        const cacheKey = computeCacheKey(nodeId, params, inputRevisions)
        const existingState = store.getNodeState(nodeId)
        if (existingState.cacheKey === cacheKey && existingState.output) {
          store.updateNodeState(nodeId, { status: 'cached' })
          continue
        }

        // Execute
        store.updateNodeState(nodeId, { status: 'running', progress: 0 })

        try {
          let output: ImageFrame

          if (nodeType === 'input') {
            // Input node: just pass through the stored image
            const frame = store.inputImages.get(nodeId)
            if (!frame) throw new Error('No input image')
            const maxSize = (params.maxSize as number) || 2048
            const fit = (params.fit as 'contain' | 'cover' | 'fill') || 'contain'
            const resized = await resizeBitmap(frame.bitmap, maxSize, fit)
            output = createFrame(resized)
          } else if (nodeType === 'output') {
            // Output node: pass through the first input
            if (inputs.length === 0) throw new Error('No input to output node')
            output = inputs[0]
          } else {
            // Processing node
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

          console.log(`[pipeline] node ${nodeId} (${nodeType}) done`)
          store.updateNodeState(nodeId, {
            status: 'done',
            progress: 1,
            statusMessage: null,
            downloadProgress: null,
            output,
            cacheKey,
            error: null,
          })
        } catch (e: any) {
          if (e.name === 'AbortError' || abortController.signal.aborted) break
          console.error(`[pipeline] node ${nodeId} (${nodeType}) error:`, e)
          store.updateNodeState(nodeId, {
            status: 'error',
            error: e.message || 'Unknown error',
          })
        }
      }
    } finally {
      store.isRunning = false
      store.abortController = null
    }
  }

  function stop() {
    store.abortController?.abort()
  }

  return { run, stop, runError }
}
