export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
export const fail = (status: number, error: string) => json({ error }, status)

/** A request the stand-in refuses with the answer the server would give. */
export class Refusal extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export const sha1 = async (data: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-1', data))].map((b) => b.toString(16).padStart(2, '0')).join('')
