import { defineRouteMiddleware } from '@astrojs/starlight/route-data'

const SITE = 'Renplay docs'

/** Titles read "<Page> · Renplay docs"; the home page is just "Renplay docs". */
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute
  const home = route.id === ''
  const title = home ? SITE : `${route.entry.data.title} · ${SITE}`
  for (const tag of route.head) {
    if (tag.tag === 'title') tag.content = title
    if (tag.tag === 'meta' && tag.attrs?.property === 'og:title') tag.attrs.content = title
  }
})
