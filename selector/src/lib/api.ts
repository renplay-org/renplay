import { deviceLevel } from './device'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init
  // This device's adult games level: the server applies it to everything it answers. It can only narrow.
  const device = deviceLevel()
  const res = await fetch(path, {
    ...rest,
    headers: { ...(device ? { 'x-renplay-adult': device } : {}), ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(rest.headers as Record<string, string> | undefined ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/') && path !== '/api/me') window.dispatchEvent(new Event('renplay:signed-out'))
    let msg = `${res.status} ${res.statusText}`
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
    } catch {}
    throw new ApiError(res.status, msg)
  }
  const ct = res.headers.get('content-type') ?? ''
  return (ct.includes('application/json') ? res.json() : res.text()) as Promise<T>
}

export const post = <T,>(path: string, json?: unknown) => api<T>(path, { method: 'POST', json: json ?? {} })
export const put = <T,>(path: string, json?: unknown) => api<T>(path, { method: 'PUT', json: json ?? {} })
export const del = <T,>(path: string) => api<T>(path, { method: 'DELETE' })
