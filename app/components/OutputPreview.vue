<script setup lang="ts">
import { usePipelineStore } from '~/stores/pipeline'
import { bitmapToBlob } from 'pipemagic'

const store = usePipelineStore()
const previewUrl = ref<string | null>(null)
const isZoomed = ref(false)

watch(() => store.outputImage, async (img) => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  if (img) {
    const blob = await bitmapToBlob(img.bitmap, 'png')
    previewUrl.value = URL.createObjectURL(blob)
  } else {
    previewUrl.value = null
  }
}, { immediate: true })

onUnmounted(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})
</script>

<template>
  <div>
    <div class="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mb-2">Output Preview</div>
    <div
      v-if="previewUrl"
      class="cursor-zoom-in"
      @click="isZoomed = true"
    >
      <img :src="previewUrl" class="w-full rounded border border-gray-700" alt="Output preview">
      <div v-if="store.outputImage" class="text-[10px] text-gray-500 mt-1">
        {{ store.outputImage.width }} x {{ store.outputImage.height }}
      </div>
    </div>
    <div v-else class="text-xs text-gray-600 text-center py-4">
      Run pipeline to see output
    </div>

    <!-- Zoom overlay -->
    <Teleport to="body">
      <div
        v-if="isZoomed && previewUrl"
        class="fixed inset-0 z-50 bg-black/80 flex items-center justify-center cursor-zoom-out"
        @click="isZoomed = false"
      >
        <img
          :src="previewUrl"
          class="max-w-[90vw] max-h-[90vh] object-contain"
          alt="Output zoom"
        >
      </div>
    </Teleport>
  </div>
</template>
