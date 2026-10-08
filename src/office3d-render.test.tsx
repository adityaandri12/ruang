// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivitySnapshot, ChannelSnapshot, OfficeSnapshot, OfficeStation } from './types.ts'

// jsdom has no WebGL, so the R3F Canvas is replaced by a stand-in that renders its fallback.
// Everything outside the Canvas (labels, tools, the wrapper) is real.
const canvas = vi.hoisted(() => ({ throwOnRender: false }))
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ fallback }: { fallback?: ReactNode; children?: ReactNode }) => {
    if (canvas.throwOnRender) throw new Error('Error creating WebGL context.')
    return <div data-testid="r3f-canvas">{fallback}</div>
  },
  useFrame: () => undefined,
  useThree: () => ({}),
}))
const webgl = vi.hoisted(() => ({ available: true }))
vi.mock('./webgl.ts', async (importOriginal) => ({ ...await importOriginal<typeof import('./webgl.ts')>(), webglAvailable: () => webgl.available, resetWebGLCache: () => undefined }))

const { default: Office3D } = await import('./pages/Office3D.tsx')
const { Office, Office3DFallback } = await import('./pages/Office.tsx')

const testEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
testEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const station: OfficeStation = {
  name: 'Lead Agent', role: 'Lead Agent', avatar: 'lead-agent', workstation: 'Command desk', room: 'Workspace', roomPosition: 'assigned-desk',
  state: 'Working', currentTask: 'Ship it', recentActivity: 'None', activity: 'Kanban: Ship it', seat: 1, provenance: 'Test', freshness: 'Current',
}
const office: OfficeSnapshot = { stations: [station], summary: { declared: 1, active: 1, idle: 0, offline: 0, unknown: 0, gatewaysReachable: 1, gatewaysDeclared: 1 }, fetchedAt: '2026-10-01T00:00:00.000Z' }
const activity: ActivitySnapshot = { sessions: { availability: 'available', data: [] }, fetchedAt: office.fetchedAt }
const channels: ChannelSnapshot = { channels: { availability: 'available', data: [] }, fetchedAt: office.fetchedAt }

let root: Root | undefined
async function render(node: ReactNode) {
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => { root!.render(node); await Promise.resolve() })
  return host
}
/** Lets the lazy Office3D chunk and the polling fetches settle. */
async function settle() { for (let index = 0; index < 5; index += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }) }

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  canvas.throwOnRender = false
  webgl.available = true
  vi.unstubAllGlobals()
  window.localStorage?.clear()
  document.body.replaceChildren()
})

describe('Office3D', () => {
  it('renders the canvas, an accessible label per agent and desk, and the view tools', async () => {
    const onSelect = vi.fn()
    const host = await render(<Office3D stations={[station]} onSelect={onSelect}/>)
    expect(host.querySelector('[role="region"][aria-label^="3D office"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="r3f-canvas"]')?.textContent).toContain('3D view unavailable')
    const tag = host.querySelector<HTMLButtonElement>('.agent-tag-3d')!
    expect(tag.getAttribute('aria-label')).toContain('Lead Agent. Working.')
    expect(host.querySelectorAll('.desk-label-3d')).toHaveLength(5)
    expect(host.querySelector('.desk-label-3d')?.textContent).toBe('Command desk')
    expect([...host.querySelectorAll('.office-3d-tools button')].map((button) => button.textContent)).toEqual(['✥ Geser', '↺ Reset view'])
    await act(async () => { tag.click() })
    expect(onSelect).toHaveBeenCalledWith(station, tag)
  })
})

describe('Office 3D fallback', () => {
  function stubApi() {
    vi.stubGlobal('fetch', vi.fn((path: string) => Promise.resolve(new Response(JSON.stringify(path === '/api/office' ? office : path === '/api/activity' ? activity : channels)))))
  }

  it('explains missing WebGL, disables the 3D toggle and shows the 2D office', async () => {
    webgl.available = false
    stubApi()
    const host = await render(<Office/>)
    await settle()
    expect(host.querySelector('.office-3d-fallback')?.textContent).toContain('WebGL is not supported')
    expect(host.querySelector<HTMLButtonElement>('.view-toggle button:last-child')!.disabled).toBe(true)
    expect(host.querySelector('.office-stage')!.className).toContain('view-2d')
    expect(host.querySelector('.pixel-room')).not.toBeNull()
  })

  it('falls back to 2D with a retry when the 3D scene throws', async () => {
    canvas.throwOnRender = true
    stubApi()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const host = await render(<Office/>)
    await settle()
    expect(host.querySelector('.office-3d-fallback')?.textContent).toContain('3D view stopped')
    expect(host.querySelector('.pixel-room')).not.toBeNull()

    canvas.throwOnRender = false
    await act(async () => { host.querySelector<HTMLButtonElement>('.office-3d-fallback button')!.click() })
    await settle()
    expect(host.textContent).not.toContain('3D view stopped')
    expect(host.querySelector('.office-3d')).not.toBeNull()
    expect(host.querySelector('.pixel-room')).toBeNull()
  })

  it('renders both fallback messages as status regions', async () => {
    const host = await render(<><Office3DFallback reason="no-webgl"/><Office3DFallback reason="failed" onRetry={() => undefined}/></>)
    const notices = host.querySelectorAll('[role="status"]')
    expect(notices).toHaveLength(2)
    expect(notices[0].querySelector('button')).toBeNull()
    expect(notices[1].querySelector('button')?.textContent).toBe('Try 3D again')
  })
})
