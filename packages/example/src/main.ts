import { PipeMagic } from 'pipemagic'
import type { PipelineDefinition, NodeStatus } from 'pipemagic'

// -- Sticker preset pipeline definition --

const stickerPipeline: PipelineDefinition = {
  version: 1,
  nodes: [
    {
      id: 'input',
      type: 'input',
      position: { x: 0, y: 0 },
      params: { maxSize: 2048, fit: 'contain' },
    },
    {
      id: 'remove-bg',
      type: 'remove-bg',
      position: { x: 1, y: 0 },
      params: { threshold: 0.5, device: 'auto', dtype: 'fp16' },
    },
    {
      id: 'normalize',
      type: 'normalize',
      position: { x: 2, y: 0 },
      params: { size: 2048, padding: 160 },
    },
    {
      id: 'outline',
      type: 'outline',
      position: { x: 3, y: 0 },
      params: {
        thickness: 50,
        color: '#ffffff',
        opacity: 1,
        quality: 'high',
        position: 'outside',
        threshold: 5,
      },
    },
    {
      id: 'upscale',
      type: 'upscale',
      position: { x: 4, y: 0 },
      params: { model: 'cnn-2x-l', contentType: 'rl' },
    },
    {
      id: 'output',
      type: 'output',
      position: { x: 5, y: 0 },
      params: { format: 'png', quality: 0.92 },
    },
  ],
  edges: [
    { id: 'e1', source: 'input', sourceHandle: 'output', target: 'remove-bg', targetHandle: 'input' },
    { id: 'e2', source: 'remove-bg', sourceHandle: 'output', target: 'normalize', targetHandle: 'input' },
    { id: 'e3', source: 'normalize', sourceHandle: 'output', target: 'outline', targetHandle: 'input' },
    { id: 'e4', source: 'outline', sourceHandle: 'output', target: 'upscale', targetHandle: 'input' },
    { id: 'e5', source: 'upscale', sourceHandle: 'output', target: 'output', targetHandle: 'input' },
  ],
}

// -- Node display names --

const nodeLabels: Record<string, string> = {
  'input': 'Input',
  'remove-bg': 'Remove BG',
  'normalize': 'Normalize',
  'outline': 'Outline',
  'upscale': 'Upscale 2x',
  'output': 'Output',
}

// -- DOM refs --

const dropZone = document.getElementById('drop-zone')!
const fileInput = document.getElementById('file-input') as HTMLInputElement
const progressArea = document.getElementById('progress-area')!
const resultArea = document.getElementById('result-area')!
const resultImg = document.getElementById('result-img') as HTMLImageElement
const downloadBtn = document.getElementById('download-btn')!
const errorMsg = document.getElementById('error-msg')!

// -- State --

let resultBlob: Blob | null = null
const pm = new PipeMagic()

// -- Progress UI --

const nodeProgress = new Map<string, { bar: HTMLDivElement; status: HTMLDivElement; message: HTMLDivElement }>()

function initProgressUI() {
  progressArea.innerHTML = ''
  nodeProgress.clear()

  for (const node of stickerPipeline.nodes) {
    if (node.type === 'input' || node.type === 'output') continue

    const row = document.createElement('div')
    row.className = 'node-row'

    const name = document.createElement('div')
    name.className = 'node-name'
    name.textContent = nodeLabels[node.id] || node.id

    const barWrap = document.createElement('div')
    barWrap.className = 'node-bar-wrap'
    const bar = document.createElement('div')
    bar.className = 'node-bar'
    barWrap.appendChild(bar)

    const status = document.createElement('div')
    status.className = 'node-status'

    row.appendChild(name)
    row.appendChild(barWrap)
    row.appendChild(status)

    const message = document.createElement('div')
    message.className = 'node-message'

    progressArea.appendChild(row)
    progressArea.appendChild(message)

    nodeProgress.set(node.id, { bar, status, message })
  }
}

function updateNodeUI(nodeId: string, statusText: string, progress: number, statusClass?: string) {
  const ui = nodeProgress.get(nodeId)
  if (!ui) return
  ui.bar.style.width = `${Math.round(progress * 100)}%`
  ui.bar.className = `node-bar${statusClass ? ' ' + statusClass : ''}`
  ui.status.textContent = statusText
}

function setNodeMessage(nodeId: string, msg: string | null) {
  const ui = nodeProgress.get(nodeId)
  if (!ui) return
  ui.message.textContent = msg || ''
}

// -- Pipeline execution --

async function runPipeline(file: File) {
  // Show input preview
  const previewUrl = URL.createObjectURL(file)
  dropZone.innerHTML = `<img src="${previewUrl}" alt="Input">`
  dropZone.classList.add('has-image')

  // Reset UI
  resultArea.classList.remove('active')
  errorMsg.classList.remove('active')
  progressArea.classList.add('active')
  initProgressUI()
  resultBlob = null

  try {
    const result = await pm.run(stickerPipeline, file, {
      onNodeProgress(nodeId, progress) {
        updateNodeUI(nodeId, `${Math.round(progress * 100)}%`, progress)
      },
      onNodeStatus(nodeId, status: NodeStatus, error?: string) {
        if (status === 'running') {
          updateNodeUI(nodeId, 'Running', 0)
        } else if (status === 'done') {
          updateNodeUI(nodeId, 'Done', 1, 'done')
          setNodeMessage(nodeId, null)
        } else if (status === 'error') {
          updateNodeUI(nodeId, 'Error', 1, 'error')
          setNodeMessage(nodeId, error || 'Unknown error')
        }
      },
      onNodeStatusMessage(nodeId, message) {
        setNodeMessage(nodeId, message)
      },
      onNodeDownloadProgress(nodeId, progress) {
        if (progress != null) {
          setNodeMessage(nodeId, `Downloading model: ${Math.round(progress * 100)}%`)
        }
      },
    })

    // Show result
    resultBlob = result.blob
    const resultUrl = URL.createObjectURL(result.blob)
    resultImg.src = resultUrl
    resultArea.classList.add('active')

    console.log(`Pipeline complete: ${result.width}x${result.height}`)
  } catch (e: any) {
    if (e.name === 'AbortError') return
    errorMsg.textContent = `Error: ${e.message}`
    errorMsg.classList.add('active')
    console.error('Pipeline error:', e)
  }
}

// -- Drop zone handlers --

dropZone.addEventListener('click', () => fileInput.click())

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault()
  dropZone.classList.add('dragover')
})

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover')
})

dropZone.addEventListener('drop', (e) => {
  e.preventDefault()
  dropZone.classList.remove('dragover')
  const file = e.dataTransfer?.files[0]
  if (file?.type.startsWith('image/')) {
    runPipeline(file)
  }
})

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (file) {
    runPipeline(file)
    fileInput.value = ''
  }
})

// -- Download --

downloadBtn.addEventListener('click', () => {
  if (!resultBlob) return
  const url = URL.createObjectURL(resultBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'sticker.png'
  a.click()
  URL.revokeObjectURL(url)
})
