import type { ImageFrame } from '../types/image-frame'

// -- GPU device singleton --

let gpuDevice: GPUDevice | null = null
let gpuInitialized = false

export async function initGpu(): Promise<GPUDevice | null> {
  if (gpuInitialized) return gpuDevice

  try {
    if (!navigator.gpu) {
      throw new Error('WebGPU not available in this browser')
    }
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) {
      throw new Error('No WebGPU adapter found')
    }
    const device = await adapter.requestDevice()
    device.lost.then((info) => {
      console.error('WebGPU device lost:', info.message)
      gpuDevice = null
      gpuInitialized = false
    })
    gpuDevice = device
  } catch (e: any) {
    console.warn('WebGPU init failed:', e.message)
    gpuDevice = null
  }

  gpuInitialized = true
  return gpuDevice
}

export function getGpuDevice(): GPUDevice | null {
  return gpuDevice
}

// -- Texture / bitmap utilities --

export function bitmapToTexture(device: GPUDevice, bitmap: ImageBitmap): GPUTexture {
  const texture = device.createTexture({
    size: [bitmap.width, bitmap.height, 1],
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.RENDER_ATTACHMENT,
  })
  device.queue.copyExternalImageToTexture(
    { source: bitmap },
    { texture },
    [bitmap.width, bitmap.height],
  )
  return texture
}

export async function textureToBitmap(device: GPUDevice, texture: GPUTexture): Promise<ImageBitmap> {
  const width = texture.width
  const height = texture.height
  const bytesPerRow = Math.ceil((width * 4) / 256) * 256
  const bufferSize = bytesPerRow * height

  const stagingBuffer = device.createBuffer({
    size: bufferSize,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  })

  const encoder = device.createCommandEncoder()
  encoder.copyTextureToBuffer(
    { texture },
    { buffer: stagingBuffer, bytesPerRow },
    [width, height],
  )
  device.queue.submit([encoder.finish()])

  await stagingBuffer.mapAsync(GPUMapMode.READ)
  const data = new Uint8Array(stagingBuffer.getMappedRange())

  // Compact rows if bytesPerRow has padding
  const imageData = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const srcOffset = y * bytesPerRow
    const dstOffset = y * width * 4
    imageData.set(data.subarray(srcOffset, srcOffset + width * 4), dstOffset)
  }

  stagingBuffer.unmap()
  stagingBuffer.destroy()

  const imgData = new ImageData(imageData, width, height)
  return createImageBitmap(imgData)
}

export function createFrame(bitmap: ImageBitmap): ImageFrame {
  return {
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    revision: Date.now(),
  }
}
