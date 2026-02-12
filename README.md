# PipeMagic

Visual image processing pipeline editor that runs entirely in the browser. Build node-based pipelines to process images using AI models — no server required.

**[Try it live](https://mo1app.github.io/pipemagic/)**

## Features

- **Node-based editor** — Drag-and-drop pipeline builder powered by Vue Flow
- **Background removal** — AI-powered using RMBG-1.4 (via Hugging Face Transformers.js)
- **Normalize** — Auto-crop and center subjects with configurable padding
- **Outline** — GPU-accelerated outline generation using WebGPU (JFA algorithm)
- **Upscale 2x** — AI upscaling with Real-ESRGAN
- **Fully client-side** — All processing happens in-browser using WebGPU and WASM
- **Batch processing** — Drop multiple images onto the input node
- **Save/Load** — Export and import pipelines as JSON files

## Tech Stack

- Nuxt 3 / Vue 3 + TypeScript
- Vue Flow (node graph editor)
- Tailwind CSS 4
- Hugging Face Transformers.js (AI models)
- WebGPU + WGSL shaders
- Pinia (state management)

## Running locally

```bash
yarn install
yarn dev
```

Open [http://localhost:3003](http://localhost:3003).

## Build

```bash
yarn generate
```

Static output goes to `.output/public/`.

## License

MIT
