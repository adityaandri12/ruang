// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectWebGL, probeWebGL, resetWebGLCache, sceneErrorKind, webglAvailable } from './webgl.ts'

describe('sceneErrorKind', () => {
  it('categorises 3D scene failures', () => {
    expect(sceneErrorKind(new TypeError('Failed to fetch dynamically imported module: /assets/Office3D.js'))).toBe('chunk-load')
    expect(sceneErrorKind(new Error('Error creating WebGL context.'))).toBe('webgl-context')
    expect(sceneErrorKind(new Error('THREE.WebGLProgram: Shader Error'))).toBe('webgl-context')
    expect(sceneErrorKind(new Error('Fragment shader compile failed'))).toBe('shader')
    expect(sceneErrorKind(new Error('Texture upload failed'))).toBe('texture')
    expect(sceneErrorKind('boom')).toBe('unknown')
  })
})

/** A fake document whose canvas answers getContext from `contexts`. */
function fakeDocument(contexts: Record<string, unknown>, options: { lost?: boolean; throws?: string[] } = {}) {
  const loseContext = vi.fn()
  const getContext = vi.fn((id: string) => {
    if (options.throws?.includes(id)) throw new Error(`${id} blocked`)
    return contexts[id] ? { isContextLost: () => options.lost ?? false, getExtension: (name: string) => name === 'WEBGL_lose_context' ? { loseContext } : null } : null
  })
  const doc = { createElement: vi.fn(() => ({ getContext })) } as unknown as Pick<Document, 'createElement'>
  return { doc, getContext, loseContext }
}

afterEach(() => { resetWebGLCache(); vi.restoreAllMocks() })

describe('detectWebGL', () => {
  it('prefers WebGL 2 and releases the probe context', () => {
    const { doc, loseContext } = fakeDocument({ webgl2: true, webgl: true })
    expect(detectWebGL(doc)).toBe('webgl2')
    expect(loseContext).toHaveBeenCalledOnce()
  })

  it('falls back to WebGL 1 and to experimental-webgl for older browsers', () => {
    expect(detectWebGL(fakeDocument({ webgl: true }).doc)).toBe('webgl')
    expect(detectWebGL(fakeDocument({ 'experimental-webgl': true }).doc)).toBe('webgl')
  })

  it('keeps trying when a context id throws instead of returning null', () => {
    expect(detectWebGL(fakeDocument({ webgl: true }, { throws: ['webgl2'] }).doc)).toBe('webgl')
  })

  it('reports none when no context exists, it is already lost, or there is no canvas', () => {
    expect(detectWebGL(fakeDocument({}).doc)).toBe('none')
    expect(detectWebGL(fakeDocument({ webgl2: true }, { lost: true }).doc)).toBe('none')
    expect(detectWebGL({ createElement: () => { throw new Error('no DOM') } } as unknown as Document)).toBe('none')
    expect(detectWebGL({ createElement: () => ({}) } as unknown as Document)).toBe('none')
  })
})

describe('probeWebGL', () => {
  it('explains why WebGL is missing', () => {
    expect(probeWebGL(fakeDocument({}).doc).reason).toMatch(/returned null/)
    expect(probeWebGL(fakeDocument({}, { throws: ['webgl2', 'webgl', 'experimental-webgl'] }).doc).reason).toMatch(/webgl2 blocked/)
    expect(probeWebGL(fakeDocument({ webgl2: true }, { lost: true }).doc).reason).toMatch(/already lost/)
    expect(probeWebGL(fakeDocument({ webgl2: true }).doc)).toEqual({ support: 'webgl2' })
  })
})

describe('webglAvailable', () => {
  it('warns with a reason when the cached probe finds no WebGL', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(webglAvailable()).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/WebGL unavailable: getContext returned null/))
  })

  it('answers from an injected document without caching', () => {
    expect(webglAvailable(fakeDocument({ webgl: true }).doc)).toBe(true)
    expect(webglAvailable(fakeDocument({}).doc)).toBe(false)
  })

  it('probes the real document once and caches the answer until reset', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    expect(webglAvailable()).toBe(false)
    expect(webglAvailable()).toBe(false)
    // One probe: webgl2, webgl, experimental-webgl.
    expect(getContext).toHaveBeenCalledTimes(3)
    resetWebGLCache()
    getContext.mockImplementation(((id: string) => id === 'webgl2' ? { isContextLost: () => false, getExtension: () => null } : null) as unknown as typeof HTMLCanvasElement.prototype.getContext)
    expect(webglAvailable()).toBe(true)
  })
})
