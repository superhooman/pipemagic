export interface InputNodeParams {
  maxSize: number
  fit: 'contain' | 'cover' | 'fill'
}

export interface OutputNodeParams {
  format: 'png' | 'jpeg' | 'webp'
  quality: number
}

export interface RemoveBgParams {
  threshold: number
  device: 'webgpu' | 'wasm' | 'auto'
  dtype: 'fp32' | 'fp16' | 'q8'
}

export interface UpscaleParams {
  model: 'cnn-2x-s' | 'cnn-2x-m' | 'cnn-2x-l'
  contentType: 'rl' | 'an' | '3d'
}

export interface NormalizeParams {
  size: number
  padding: number
}

export interface OutlineParams {
  thickness: number
  color: string
  opacity: number
  quality: 'low' | 'medium' | 'high'
  position: 'outside' | 'center' | 'inside'
  threshold: number
}

export type NodeParamsMap = {
  'input': InputNodeParams
  'output': OutputNodeParams
  'remove-bg': RemoveBgParams
  'normalize': NormalizeParams
  'upscale': UpscaleParams
  'outline': OutlineParams
}

export const DEFAULT_PARAMS: NodeParamsMap = {
  'input': { maxSize: 2048, fit: 'contain' },
  'output': { format: 'png', quality: 0.92 },
  'remove-bg': { threshold: 0.5, device: 'auto', dtype: 'fp16' },
  'normalize': { size: 1024, padding: 16 },
  'upscale': { model: 'cnn-2x-s', contentType: 'rl' },
  'outline': { thickness: 4, color: '#ffffff', opacity: 1, quality: 'medium', position: 'outside', threshold: 0 },
}
