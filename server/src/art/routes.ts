import express, { Router, type Request } from 'express'
import type { GameRow } from '../db.js'
import { ART_KINDS, type ArtKind } from '../shared/recipe.js'
import { EVERYONE } from './store.js'
import type { Services } from '../services.js'
import { HttpError } from '../util/paths.js'
import type { ArtCandidates, ArtUploaded } from '../shared/api.js'

/** A game's pictures: the choices and uploads for each format, and the made pictures themselves. */
export function createArtRouter(s: Services): Router {
  const { accounts, art, catalog, content, telemetry } = s
  const router = Router({ caseSensitive: true, strict: true })

  /** The game, when this person may see its pictures: below Shown an adult game's art does not exist. */
  const withArt = (req: Request): GameRow => {
    const g = content.game(req.params.id)
    if (content.blurs(g)) throw new HttpError(404, 'Not found')
    return g
  }
  const kindOf = (value: unknown): ArtKind => {
    if (typeof value !== 'string' || !ART_KINDS.includes(value as ArtKind)) throw new HttpError(400, 'Choose grid, wide, hero, logo or icon')
    return value as ArtKind
  }
  /** Me: this person's own view. Everyone: the admin's default for the instance. */
  const scopeOf = (value: unknown): number => {
    const me = accounts.current()
    if (value === 'everyone') {
      if (me.role !== 'admin') throw new HttpError(403, 'Only an admin can choose art for everyone')
      return EVERYONE
    }
    if (value !== undefined && value !== 'me') throw new HttpError(400, 'Scope must be me or everyone')
    return me.id
  }

  router.get('/games/:id/art', async (req, res) => {
    const g = withArt(req)
    const subject = catalog.gameSubject(g)
    const scope = scopeOf(undefined)
    if (req.query['kind'] === undefined) {
      res.json({ art: art.forSubject(subject), counts: Object.fromEntries(ART_KINDS.map((k) => [k, subject.pictures.filter((p) => p.kind === k).length])) })
      return
    }
    const kind = kindOf(req.query['kind'])
    res.json({ kind, candidates: await art.candidates(subject, kind, scope) } satisfies ArtCandidates)
  })

  router.put('/games/:id/art', async (req, res) => {
    const g = withArt(req)
    const kind = kindOf(req.body?.kind)
    const scope = scopeOf(req.body?.scope)
    const subject = catalog.gameSubject(g)
    const picture = subject.pictures.find((p) => p.kind === kind && p.id === req.body?.candidate)
    if (!picture) throw new HttpError(404, 'That picture is not a choice for this game')
    // For everyone: a catalog picture or one uploaded for everyone. A personal upload is not on the others' lists.
    if (scope === EVERYONE && picture.upload && !art.isShared(picture.id, g.id))
      throw new HttpError(409, 'Upload this picture for everyone first, then choose it for everyone.')
    art.choose(g.id, kind, req.body.candidate, scope)
    telemetry.feature('artChoices')
    await art.ready(subject, scope)
    res.json({ art: art.forSubject(subject) })
  })

  router.delete('/games/:id/art', async (req, res) => {
    const g = withArt(req)
    const kind = kindOf(req.query['kind'])
    const scope = scopeOf(req.query['scope'])
    art.clearChoice(g.id, kind, scope)
    const subject = catalog.gameSubject(g)
    await art.ready(subject, scope)
    res.json({ art: art.forSubject(subject) })
  })

  router.post('/games/:id/art/upload', express.raw({ type: () => true, limit: '16mb' }), async (req, res) => {
    const g = withArt(req)
    const kind = kindOf(req.query['kind'])
    const scope = scopeOf(req.query['scope'])
    const focalText = typeof req.query['focal'] === 'string' ? req.query['focal'] : ''
    const focal = /^(0(\.\d+)?|1(\.0+)?),(0(\.\d+)?|1(\.0+)?)$/.test(focalText) ? (focalText.split(',').map(Number) as [number, number]) : null
    if (focalText && !focal) throw new HttpError(400, 'The focal point is two numbers from 0 to 1, like 0.5,0.3')
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'No picture uploaded')
    const { id, warning } = await art.upload(g.id, kind, req.body, focal, scope)
    // An upload is made to be used: it becomes the choice at the scope it was uploaded for.
    art.choose(g.id, kind, id, scope)
    telemetry.feature('artChoices')
    const subject = catalog.gameSubject(g)
    await art.ready(subject, scope)
    res.json({ id, warning, art: art.forSubject(subject) } satisfies ArtUploaded)
  })

  /** Deletes one's own upload (scope me), or an admin's upload for everyone (scope everyone). */
  router.delete('/games/:id/art/uploads/:upload', async (req, res) => {
    const g = withArt(req)
    const kind = kindOf(req.query['kind'])
    const scope = scopeOf(req.query['scope'])
    if (!/^[0-9a-f]{64}$/.test(req.params.upload)) throw new HttpError(404, 'Picture not found')
    if (!art.removeUpload(g.id, kind, req.params.upload, scope)) throw new HttpError(404, 'Picture not found')
    const subject = catalog.gameSubject(g)
    await art.ready(subject, scope)
    res.json({ art: art.forSubject(subject) })
  })

  // Made pictures are named by their content, so they never change: browsers keep them.
  router.get('/art/:file', (req, res, next) => {
    if (!art.canRead(req.params.file)) return next(new HttpError(404, 'Not found'))
    res.sendFile(art.file(req.params.file), { headers: { 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Type': 'image/webp', 'X-Content-Type-Options': 'nosniff' } }, (err) => err && next(new HttpError(404, 'Not found')))
  })

  return router
}
