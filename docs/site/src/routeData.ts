import { defineRouteMiddleware } from '@astrojs/starlight/route-data'

const SITE = 'Renplay docs'
const HOME_TITLE = 'Renplay docs · Install and use Renplay'

/** Titles read "<Page> · Renplay docs"; the home page is just "Renplay docs". */
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute
  const home = route.id === ''
  const title = home ? HOME_TITLE : `${route.entry.data.title} · ${SITE}`
  for (const tag of route.head) {
    if (tag.tag === 'title') tag.content = title
    if (tag.tag === 'meta' && tag.attrs?.property === 'og:title') tag.attrs.content = title
    if (tag.tag === 'meta' && tag.attrs?.name === 'twitter:title') tag.attrs.content = title
    // The home is a website, every other page an article.
    if (tag.tag === 'meta' && tag.attrs?.property === 'og:type' && home) tag.attrs.content = 'website'
  }
  const url = new URL(route.id ? `${route.id}/` : '', 'https://docs.renplay.org/').href
  const crumbs = [{ name: 'Renplay docs', url: 'https://docs.renplay.org/' }, ...(home ? [] : [{ name: route.entry.data.title, url }])]
  route.head.push(
    {
      tag: 'script',
      attrs: { type: 'application/ld+json' },
      content: JSON.stringify(home
        ? { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE, url, description: route.entry.data.description, publisher: { '@type': 'Organization', name: 'Renplay', url: 'https://renplay.org' } }
        : { '@context': 'https://schema.org', '@type': 'TechArticle', headline: route.entry.data.title, description: route.entry.data.description, url, inLanguage: 'en', isPartOf: { '@type': 'WebSite', name: SITE, url: 'https://docs.renplay.org/' }, publisher: { '@type': 'Organization', name: 'Renplay', url: 'https://renplay.org' } }),
    },
    {
      tag: 'script',
      attrs: { type: 'application/ld+json' },
      content: JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url })) }),
    },
  )
})
