import type { ExecutionContext } from '../types/execution'
import type { ImageFrame } from '../types/image-frame'
import { getUpscaler } from '../websr'

type ModelSize = 'cnn-2x-s' | 'cnn-2x-m' | 'cnn-2x-l'
type ContentType = 'rl' | 'an' | '3d'

export async function executeUpscale(
  ctx: ExecutionContext,
  inputs: ImageFrame[],
  params: Record<string, unknown>,
): Promise<ImageFrame> {
  const input = inputs[0]
  if (!input) throw new Error('No input image')

  const model = (params.model as ModelSize) || 'cnn-2x-s'
  const contentType = (params.contentType as ContentType) || 'rl'

  ctx.onProgress('', 0.05)
  ctx.onStatusMessage?.('', 'Loading upscale model...')

  const sr = await getUpscaler(model, contentType, {
    onStatus: (msg) => ctx.onStatusMessage?.('', msg),
  })

  ctx.onProgress('', 0.3)
  if (ctx.abortSignal.aborted) throw new DOMException('Aborted', 'AbortError')

  const { width, height } = input
  const outW = width * 2
  const outH = height * 2

  // Extract alpha channel from source
  ctx.onStatusMessage?.('', 'Upscaling...')
  const srcCanvas = new OffscreenCanvas(width, height)
  const srcCtx = srcCanvas.getContext('2d')!
  srcCtx.drawImage(input.bitmap, 0, 0)
  const srcData = srcCtx.getImageData(0, 0, width, height).data

  // Upscale RGB with WebSR
  await sr.render(input.bitmap)
  ctx.onProgress('', 0.7)

  // Read upscaled RGB from WebSR canvas via bitmap
  const srCanvas = sr.canvas as unknown as OffscreenCanvas
  const srBitmap = await createImageBitmap(srCanvas)
  const rgbCanvas = new OffscreenCanvas(outW, outH)
  const rgbCtx = rgbCanvas.getContext('2d')!
  rgbCtx.drawImage(srBitmap, 0, 0)
  const srImageData = rgbCtx.getImageData(0, 0, outW, outH)
  const srData = srImageData.data

  // Upscale alpha with bilinear interpolation via canvas
  const alphaCanvas = new OffscreenCanvas(width, height)
  const alphaCtx = alphaCanvas.getContext('2d')!
  const alphaImageData = alphaCtx.createImageData(width, height)
  for (let i = 0; i < width * height; i++) {
    const a = srcData[i * 4 + 3]
    alphaImageData.data[i * 4] = a
    alphaImageData.data[i * 4 + 1] = a
    alphaImageData.data[i * 4 + 2] = a
    alphaImageData.data[i * 4 + 3] = 255
  }
  alphaCtx.putImageData(alphaImageData, 0, 0)

  const alphaUpCanvas = new OffscreenCanvas(outW, outH)
  const alphaUpCtx = alphaUpCanvas.getContext('2d')!
  alphaUpCtx.imageSmoothingEnabled = true
  alphaUpCtx.imageSmoothingQuality = 'high'
  alphaUpCtx.drawImage(alphaCanvas, 0, 0, outW, outH)
  const alphaUpData = alphaUpCtx.getImageData(0, 0, outW, outH).data

  ctx.onProgress('', 0.9)

  // Composite: upscaled RGB + upscaled alpha
  for (let i = 0; i < outW * outH; i++) {
    srData[i * 4 + 3] = alphaUpData[i * 4] // R channel holds the alpha
  }
  rgbCtx.putImageData(srImageData, 0, 0)

  const outBitmap = await createImageBitmap(rgbCanvas)

  ctx.onProgress('', 1)
  ctx.onStatusMessage?.('', null)

  return {
    bitmap: outBitmap,
    width: outBitmap.width,
    height: outBitmap.height,
    revision: Date.now(),
  }
}
