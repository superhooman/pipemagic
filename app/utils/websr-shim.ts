// WebSR is loaded as a global <script> in nuxt.config.ts head.
// The UMD bundle sets window.WebSR when no CJS/AMD env is detected.
export function loadWebSR(): any {
  const WebSR = (globalThis as any).WebSR
  if (!WebSR) throw new Error('WebSR not loaded — check head script in nuxt.config.ts')
  return WebSR
}
