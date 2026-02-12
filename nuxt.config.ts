import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  ssr: false,
  srcDir: 'app/',

  devServer: {
    port: 3003,
  },

  modules: [
    '@pinia/nuxt',
  ],

  css: [
    '~/assets/css/main.css',
  ],

  app: {
    baseURL: process.env.NUXT_APP_BASE_URL || '/',
    head: {
      title: 'PipeMagic',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
      script: [
        { src: '/coi-serviceworker.min.js' },
      ],
    },
    spaLoadingTemplate: true,
  },

  vite: {
    plugins: [
      tailwindcss(),
    ],
    worker: {
      format: 'es',
    },
  },

  routeRules: {
    '/**': {
      headers: {
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
    },
  },

  nitro: {
    routeRules: {
      '/**': {
        headers: {
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Cross-Origin-Opener-Policy': 'same-origin',
        },
      },
    },
  },
})
