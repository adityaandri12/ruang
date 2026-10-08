// WebGL detection for the 3D office.
//
// A probe must not be the reason 3D fails: browsers cap live WebGL contexts (often at 8-16)
// and drop the oldest when the cap is hit, so every probe context is released right away and
// the answer is cached for the page's lifetime. React StrictMode, remounts and route changes
// then reuse one answer instead of probing again and getting a different one.

export type WebGLSupport = 'webgl2' | 'webgl' | 'none'

/** Context names to try, best first. `experimental-webgl` covers older Safari, Edge and WebViews. */
const CONTEXT_IDS = ['webgl2', 'webgl', 'experimental-webgl'] as const

let cached: WebGLSupport | undefined

function release(context: WebGLRenderingContext | WebGL2RenderingContext) {
  try { context.getExtension('WEBGL_lose_context')?.loseContext() } catch { /* best effort */ }
}

export interface WebGLProbe { support: WebGLSupport; reason?: string }

/** Probes for WebGL and says why it is missing. `doc` is injectable for tests. */
export function probeWebGL(doc: Pick<Document, 'createElement'> | undefined = typeof document === 'undefined' ? undefined : document): WebGLProbe {
  if (!doc) return { support: 'none', reason: 'no document (server render)' }
  let canvas: HTMLCanvasElement
  try { canvas = doc.createElement('canvas') } catch (error) { return { support: 'none', reason: `canvas creation threw: ${String(error)}` } }
  if (typeof canvas?.getContext !== 'function') return { support: 'none', reason: 'canvas has no getContext' }
  const errors: string[] = []
  for (const id of CONTEXT_IDS) {
    let context: RenderingContext | null = null
    try { context = canvas.getContext(id) } catch (error) { errors.push(`${id}: ${String(error)}`); context = null }
    if (!context) continue
    const gl = context as WebGLRenderingContext
    // A context that is already lost (GPU reset, blocklisted driver) cannot render.
    const usable = typeof gl.isContextLost !== 'function' || !gl.isContextLost()
    release(gl)
    // One canvas only ever gives one context type, so after the first hit there is nothing more to try.
    if (!usable) return { support: 'none', reason: `${id} context was created already lost` }
    return { support: id === 'webgl2' ? 'webgl2' : 'webgl' }
  }
  return { support: 'none', reason: errors.length ? `getContext threw (${errors.join('; ')})` : `getContext returned null for ${CONTEXT_IDS.join(', ')}` }
}

/** Probes for WebGL without caching. `doc` is injectable for tests. */
export function detectWebGL(doc?: Pick<Document, 'createElement'>): WebGLSupport {
  return (doc ? probeWebGL(doc) : probeWebGL()).support
}

/** Whether this browser can render the 3D office. Probed once per page, then cached. */
export function webglAvailable(doc?: Pick<Document, 'createElement'>): boolean {
  if (doc) return detectWebGL(doc) !== 'none'
  if (cached === undefined) {
    const probe = probeWebGL()
    cached = probe.support
    if (probe.support === 'none') console.warn(`[ruang] 3D office disabled, WebGL unavailable: ${probe.reason}`)
  }
  return cached !== 'none'
}

/** Clears the cached answer (tests, or a manual "try 3D again"). */
export function resetWebGLCache() { cached = undefined }

/** Rough category of a 3D scene failure, so console reports say what broke. */
export function sceneErrorKind(error: unknown): 'chunk-load' | 'webgl-context' | 'shader' | 'texture' | 'unknown' {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  if (/dynamically imported module|ChunkLoadError|Loading chunk|Importing a module script failed/i.test(text)) return 'chunk-load'
  if (/WebGL|context/i.test(text)) return 'webgl-context'
  if (/shader|program|compile/i.test(text)) return 'shader'
  if (/texture|image/i.test(text)) return 'texture'
  return 'unknown'
}
