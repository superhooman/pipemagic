/**
 * Standalone WebSR utility -- loads runtime + weights from jsDelivr CDN.
 * Zero app-specific imports. Safe to copy into other projects.
 */

const CDN_BASE = 'https://cdn.jsdelivr.net/npm/@websr/websr@0.0.15'
const SCRIPT_URL = `${CDN_BASE}/dist/websr.js`

type ModelSize = 'cnn-2x-s' | 'cnn-2x-m' | 'cnn-2x-l'
type ContentType = 'rl' | 'an' | '3d'

// -- Singleton state --

let scriptLoaded = false
let gpuDevice: GPUDevice | null = null
let instance: any = null
let currentKey: string | null = null
const weightsCache = new Map<string, any>()

// -- CDN script loader --

function loadScript(): Promise<void> {
  if (scriptLoaded && (globalThis as any).WebSR) return Promise.resolve()

  return new Promise((resolve, reject) => {
    // Check if already present (e.g. loaded by another call)
    if ((globalThis as any).WebSR) {
      scriptLoaded = true
      return resolve()
    }

    const el = document.createElement('script')
    el.src = SCRIPT_URL
    el.crossOrigin = 'anonymous'
    el.onload = () => {
      scriptLoaded = true
      resolve()
    }
    el.onerror = () => reject(new Error(`Failed to load WebSR from ${SCRIPT_URL}`))
    document.head.appendChild(el)
  })
}

// -- Weight fetcher --

async function fetchWeights(model: ModelSize, contentType: ContentType): Promise<any> {
  const key = `${model}-${contentType}`
  const cached = weightsCache.get(key)
  if (cached) return cached

  const url = `${CDN_BASE}/weights/anime4k/${key}.json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch weights: ${url} (${res.status})`)
  const weights = await res.json()
  weightsCache.set(key, weights)
  return weights
}

// -- Public API --

interface Upscaler {
  render: (source: ImageBitmap) => Promise<void>
  canvas: OffscreenCanvas
}

interface UpscalerCallbacks {
  onStatus?: (msg: string) => void
}

export async function getUpscaler(
  model: ModelSize,
  contentType: ContentType,
  callbacks?: UpscalerCallbacks,
): Promise<Upscaler> {
  const onStatus = callbacks?.onStatus

  // 1. Load runtime
  onStatus?.('Loading WebSR runtime...')
  await loadScript()
  const WebSR = (globalThis as any).WebSR
  if (!WebSR) throw new Error('WebSR global not found after script load')

  // 2. Init WebGPU (once)
  if (!gpuDevice) {
    onStatus?.('Initializing WebGPU...')
    const device = await WebSR.initWebGPU()
    if (!device) throw new Error('WebGPU is required for upscaling')
    gpuDevice = device
  }

  // 3. Fetch weights
  const key = `${model}-${contentType}`
  onStatus?.(`Loading ${model} (${contentType}) weights...`)
  const weights = await fetchWeights(model, contentType)

  // 4. Reuse / switch / create instance
  if (instance && currentKey === key) {
    return instance
  }

  if (instance && currentKey !== key) {
    onStatus?.('Switching model...')
    instance.switchNetwork(`anime4k/${model}`, weights)
    currentKey = key
    return instance
  }

  onStatus?.(`Creating ${model} (${contentType}) upscaler...`)
  const canvas = new OffscreenCanvas(1, 1) as unknown as HTMLCanvasElement
  instance = new WebSR({
    network_name: `anime4k/${model}`,
    weights,
    gpu: gpuDevice,
    canvas,
  })
  currentKey = key
  return instance
}
