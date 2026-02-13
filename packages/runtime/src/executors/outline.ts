import type { ExecutionContext } from '../types/execution'
import type { ImageFrame } from '../types/image-frame'
import { bitmapToImageData, imageDataToBitmap } from '../utils/image'
import { bitmapToTexture, textureToBitmap, createFrame } from '../utils/gpu'

import seedSrc from '../shaders/jfa-seed.wgsl'
import stepSrc from '../shaders/jfa-step.wgsl'
import distSrc from '../shaders/jfa-distance.wgsl'
import compositeSrc from '../shaders/outline-composite.wgsl'

export async function executeOutline(
  ctx: ExecutionContext,
  inputs: ImageFrame[],
  params: Record<string, unknown>,
): Promise<ImageFrame> {
  const input = inputs[0]
  if (!input) throw new Error('No input image')

  const thickness = (params.thickness as number) || 4
  const color = (params.color as string) || '#ffffff'
  const opacity = (params.opacity as number) ?? 1
  const quality = (params.quality as string) || 'medium'
  const position = (params.position as string) || 'outside'

  // Parse color
  const r = parseInt(color.slice(1, 3), 16) / 255
  const g = parseInt(color.slice(3, 5), 16) / 255
  const b = parseInt(color.slice(5, 7), 16) / 255

  const positionValue = position === 'outside' ? 1 : position === 'center' ? 0.5 : 0
  const threshold = (params.threshold as number) ?? 0

  if (ctx.gpuDevice) {
    try {
      return await executeOutlineGpu(ctx, input, { thickness, r, g, b, opacity, quality, positionValue, threshold })
    } catch (e) {
      console.warn('WebGPU outline failed, falling back to canvas:', e)
    }
  }

  return executeOutlineCanvas(input, { thickness, r, g, b, opacity, positionValue, threshold })
}

interface OutlineOpts {
  thickness: number
  r: number
  g: number
  b: number
  opacity: number
  quality: string
  positionValue: number
  threshold: number
}

async function executeOutlineGpu(
  ctx: ExecutionContext,
  input: ImageFrame,
  opts: OutlineOpts,
): Promise<ImageFrame> {
  const device = ctx.gpuDevice!

  const { width, height } = input
  ctx.onProgress('', 0.1)

  // Create textures
  const inputTexture = bitmapToTexture(device, input.bitmap)

  const jfaTexA = device.createTexture({
    size: [width, height],
    format: 'rg32float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  const jfaTexB = device.createTexture({
    size: [width, height],
    format: 'rg32float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  const outerDistTex = device.createTexture({
    size: [width, height],
    format: 'r32float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  const innerDistTex = device.createTexture({
    size: [width, height],
    format: 'r32float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  const outputTexture = device.createTexture({
    size: [width, height],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  })

  // Create pipelines
  const seedModule = device.createShaderModule({ code: seedSrc })
  const seedPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: seedModule, entryPoint: 'main' },
  })

  const stepModule = device.createShaderModule({ code: stepSrc })
  const stepPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: stepModule, entryPoint: 'main' },
  })

  const distModule = device.createShaderModule({ code: distSrc })
  const distPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: distModule, entryPoint: 'main' },
  })

  const seedParamsBuf = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const stepParamsBuf = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  const maxDim = Math.max(width, height)
  const numSteps = Math.ceil(Math.log2(maxDim))
  const wgX = Math.ceil(width / 8)
  const wgY = Math.ceil(height / 8)

  // Runs seed -> JFA flood -> distance for one direction
  function runJfaPass(distTarget: GPUTexture, invert: boolean) {
    // Seed pass
    device.queue.writeBuffer(seedParamsBuf, 0, new Float32Array([0.1, invert ? 1.0 : 0.0, 0, 0]))
    const seedBG = device.createBindGroup({
      layout: seedPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: inputTexture.createView() },
        { binding: 1, resource: jfaTexA.createView() },
        { binding: 2, resource: { buffer: seedParamsBuf } },
      ],
    })
    let encoder = device.createCommandEncoder()
    let pass = encoder.beginComputePass()
    pass.setPipeline(seedPipeline)
    pass.setBindGroup(0, seedBG)
    pass.dispatchWorkgroups(wgX, wgY)
    pass.end()
    device.queue.submit([encoder.finish()])

    // JFA steps
    let readTex = jfaTexA
    let writeTex = jfaTexB
    let stepSize = Math.pow(2, numSteps - 1)

    for (let i = 0; i < numSteps; i++) {
      if (ctx.abortSignal.aborted) throw new DOMException('Aborted', 'AbortError')

      device.queue.writeBuffer(stepParamsBuf, 0, new Int32Array([stepSize, 0, 0, 0]))
      const bg = device.createBindGroup({
        layout: stepPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: readTex.createView() },
          { binding: 1, resource: writeTex.createView() },
          { binding: 2, resource: { buffer: stepParamsBuf } },
        ],
      })
      encoder = device.createCommandEncoder()
      pass = encoder.beginComputePass()
      pass.setPipeline(stepPipeline)
      pass.setBindGroup(0, bg)
      pass.dispatchWorkgroups(wgX, wgY)
      pass.end()
      device.queue.submit([encoder.finish()])

      const tmp = readTex
      readTex = writeTex
      writeTex = tmp
      stepSize = Math.max(1, Math.floor(stepSize / 2))
    }

    // Distance pass
    const distBG = device.createBindGroup({
      layout: distPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: readTex.createView() },
        { binding: 1, resource: distTarget.createView() },
      ],
    })
    encoder = device.createCommandEncoder()
    pass = encoder.beginComputePass()
    pass.setPipeline(distPipeline)
    pass.setBindGroup(0, distBG)
    pass.dispatchWorkgroups(wgX, wgY)
    pass.end()
    device.queue.submit([encoder.finish()])
  }

  ctx.onProgress('', 0.2)

  // Outer distance: foreground seeds -> distance for outside pixels
  runJfaPass(outerDistTex, false)

  ctx.onProgress('', 0.5)

  // Inner distance: background seeds -> distance for inside pixels
  runJfaPass(innerDistTex, true)

  ctx.onProgress('', 0.8)

  // Composite pass
  const compModule = device.createShaderModule({ code: compositeSrc })
  const compParamsBuf = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(compParamsBuf, 0, new Float32Array([
    opts.r, opts.g, opts.b, 1.0,  // outlineColor
    opts.thickness, opts.opacity, opts.positionValue, opts.threshold,  // thickness, opacity, position, threshold
  ]))

  const compPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: compModule, entryPoint: 'main' },
  })
  const compBindGroup = device.createBindGroup({
    layout: compPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: inputTexture.createView() },
      { binding: 1, resource: outerDistTex.createView() },
      { binding: 2, resource: innerDistTex.createView() },
      { binding: 3, resource: outputTexture.createView() },
      { binding: 4, resource: { buffer: compParamsBuf } },
    ],
  })

  let encoder = device.createCommandEncoder()
  let pass = encoder.beginComputePass()
  pass.setPipeline(compPipeline)
  pass.setBindGroup(0, compBindGroup)
  pass.dispatchWorkgroups(wgX, wgY)
  pass.end()
  device.queue.submit([encoder.finish()])

  ctx.onProgress('', 0.95)

  // Read back
  const bitmap = await textureToBitmap(device, outputTexture)

  // Cleanup
  inputTexture.destroy()
  jfaTexA.destroy()
  jfaTexB.destroy()
  outerDistTex.destroy()
  innerDistTex.destroy()
  outputTexture.destroy()
  seedParamsBuf.destroy()
  stepParamsBuf.destroy()
  compParamsBuf.destroy()

  ctx.onProgress('', 1)
  return createFrame(bitmap)
}

/** Canvas fallback: chamfer distance. */
async function executeOutlineCanvas(
  input: ImageFrame,
  opts: Omit<OutlineOpts, 'quality'>,
): Promise<ImageFrame> {
  const { width, height } = input
  const imageData = bitmapToImageData(input.bitmap)
  const src = imageData.data

  // Build alpha mask
  const alpha = new Float32Array(width * height)
  for (let i = 0; i < width * height; i++) {
    alpha[i] = src[i * 4 + 3] / 255
  }

  // Compute outer distance field (from foreground seeds)
  const outerDist = new Float32Array(width * height)
  outerDist.fill(1e10)
  for (let i = 0; i < width * height; i++) {
    if (alpha[i] > 0.1) {
      outerDist[i] = 0
    }
  }
  chamferDistance(outerDist, width, height)

  // Compute inner distance field (from background seeds)
  const innerDist = new Float32Array(width * height)
  innerDist.fill(1e10)
  for (let i = 0; i < width * height; i++) {
    if (alpha[i] <= 0.1) {
      innerDist[i] = 0
    }
  }
  chamferDistance(innerDist, width, height)

  // Composite outline
  const output = new Uint8ClampedArray(width * height * 4)
  const innerEdge = opts.thickness * opts.positionValue
  const outerEdge = opts.thickness * (1 - opts.positionValue)
  const cr = opts.r * 255
  const cg = opts.g * 255
  const cb = opts.b * 255

  for (let i = 0; i < width * height; i++) {
    const isInside = alpha[i] > 0.1
    const signedDist = (isInside ? -innerDist[i] : outerDist[i]) + opts.threshold

    // Smoothstep outline band
    const low = -outerEdge
    const high = innerEdge
    let outlineAlpha = 0
    if (signedDist >= low - 0.5 && signedDist <= high + 0.5) {
      const t1 = smoothstep(low - 0.5, low + 0.5, signedDist)
      const t2 = 1 - smoothstep(high - 0.5, high + 0.5, signedDist)
      outlineAlpha = t1 * t2
    }

    const blendAlpha = outlineAlpha * opts.opacity
    const origR = src[i * 4]
    const origG = src[i * 4 + 1]
    const origB = src[i * 4 + 2]
    const origA = src[i * 4 + 3] / 255

    output[i * 4] = Math.round(origR * (1 - blendAlpha) + cr * blendAlpha)
    output[i * 4 + 1] = Math.round(origG * (1 - blendAlpha) + cg * blendAlpha)
    output[i * 4 + 2] = Math.round(origB * (1 - blendAlpha) + cb * blendAlpha)
    output[i * 4 + 3] = Math.round(Math.max(origA, blendAlpha) * 255)
  }

  const outImageData = new ImageData(output, width, height)
  const bitmap = await imageDataToBitmap(outImageData)
  return {
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    revision: Date.now(),
  }
}

/** Two-pass chamfer distance transform (in-place). */
function chamferDistance(dist: Float32Array, width: number, height: number) {
  // Forward pass
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x
      dist[idx] = Math.min(
        dist[idx],
        dist[(y - 1) * width + (x - 1)] + 1.414,
        dist[(y - 1) * width + x] + 1,
        dist[(y - 1) * width + (x + 1)] + 1.414,
        dist[y * width + (x - 1)] + 1,
      )
    }
  }

  // Backward pass
  for (let y = height - 2; y >= 1; y--) {
    for (let x = width - 2; x >= 1; x--) {
      const idx = y * width + x
      dist[idx] = Math.min(
        dist[idx],
        dist[(y + 1) * width + (x + 1)] + 1.414,
        dist[(y + 1) * width + x] + 1,
        dist[(y + 1) * width + (x - 1)] + 1.414,
        dist[y * width + (x + 1)] + 1,
      )
    }
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}
