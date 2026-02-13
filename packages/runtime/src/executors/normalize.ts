import type { ExecutionContext } from '../types/execution'
import type { ImageFrame } from '../types/image-frame'
import { bitmapToImageData } from '../utils/image'

export async function executeNormalize(
  ctx: ExecutionContext,
  inputs: ImageFrame[],
  params: Record<string, unknown>,
): Promise<ImageFrame> {
  const input = inputs[0]
  if (!input) throw new Error('No input image')

  const size = (params.size as number) || 1024
  const padding = (params.padding as number) ?? 16

  ctx.onProgress('', 0.1)

  // 1. Convert to ImageData to scan pixels
  const imageData = bitmapToImageData(input.bitmap)
  const { data, width, height } = imageData

  // 2. Find tight bounding box of non-transparent content (alpha > 0)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3]
      if (alpha > 10) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  ctx.onProgress('', 0.4)

  // Handle fully transparent image -- return empty canvas at target size
  if (maxX < 0 || maxY < 0) {
    const canvas = new OffscreenCanvas(size, size)
    const bitmap = await createImageBitmap(canvas)
    return { bitmap, width: size, height: size, revision: Date.now() }
  }

  // 3. Crop dimensions
  const cropW = maxX - minX + 1
  const cropH = maxY - minY + 1

  // 4. Compute scale to fit within (size - 2*padding) preserving aspect ratio
  const available = size - 2 * padding
  const scale = Math.min(available / cropW, available / cropH)
  const scaledW = Math.round(cropW * scale)
  const scaledH = Math.round(cropH * scale)

  ctx.onProgress('', 0.6)

  // 5. Create a size x size canvas, draw cropped content centered and scaled
  // First, crop the source into a temp canvas
  const cropCanvas = new OffscreenCanvas(cropW, cropH)
  const cropCtx = cropCanvas.getContext('2d')!
  cropCtx.drawImage(input.bitmap, minX, minY, cropW, cropH, 0, 0, cropW, cropH)

  ctx.onProgress('', 0.8)

  // Draw onto final square canvas
  const outCanvas = new OffscreenCanvas(size, size)
  const outCtx = outCanvas.getContext('2d')!
  const offsetX = Math.round((size - scaledW) / 2)
  const offsetY = Math.round((size - scaledH) / 2)
  outCtx.drawImage(cropCanvas, 0, 0, cropW, cropH, offsetX, offsetY, scaledW, scaledH)

  const bitmap = await createImageBitmap(outCanvas)

  ctx.onProgress('', 1)

  return { bitmap, width: size, height: size, revision: Date.now() }
}
