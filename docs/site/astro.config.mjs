import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import starlightLinksValidator from 'starlight-links-validator'
import remarkInclude from './scripts/remark-include.mjs'
import remarkVersion from './scripts/remark-version.mjs'
import { unified } from '@astrojs/markdown-remark'

export default defineConfig({
  site: 'https://docs.renplay.org',
  markdown: { processor: unified({ remarkPlugins: [remarkInclude, remarkVersion] }) },
  integrations: [
    starlight({
      title: 'Renplay docs',
      titleDelimiter: '·',
      routeMiddleware: './src/routeData.ts',
      components: {
        Header: './src/components/Header.astro',
        Footer: './src/components/Footer.astro',
        Hero: './src/components/Hero.astro',
        PageTitle: './src/components/PageTitle.astro',
      },
      expressiveCode: {
        themes: ['github-dark', 'github-light'],
        styleOverrides: {
          borderRadius: '14px',
          borderColor: 'var(--sl-color-hairline)',
          codeBackground: 'var(--sl-color-gray-6)',
          codeFontSize: '0.85rem',
          codePaddingBlock: '1.1rem',
          frames: { shadowColor: 'transparent' },
        },
        defaultProps: { frame: 'none' },
      },
      description: 'Renplay is a self-hosted player for Ren’Py games in the browser, with saves on your own server.',
      logo: { src: './src/assets/logo.svg', alt: '' },
      favicon: '/favicon.svg',
      defaultLocale: 'root',
      locales: { root: { label: 'English', lang: 'en' } },
      editLink: { baseUrl: 'https://github.com/renplay-org/renplay/edit/dev/docs/site/' },
      lastUpdated: false,
      customCss: ['./src/styles/renplay.css'],
      head: [
        // Dark unless the reader picked a theme before.
        {
          tag: 'script',
          content: "try{if(!localStorage.getItem('starlight-theme'))localStorage.setItem('starlight-theme','dark')}catch(e){}",
        },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#07070a' } },
        { tag: 'meta', attrs: { property: 'og:site_name', content: 'Renplay docs' } },
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://renplay.org/img/og.jpg' } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
        { tag: 'meta', attrs: { property: 'og:image:alt', content: 'Renplay: your Ren’Py games on every screen' } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://renplay.org/img/og.jpg' } },
        { tag: 'link', attrs: { rel: 'icon', href: '/favicon.ico', sizes: '16x16 32x32 48x48' } },
        { tag: 'link', attrs: { rel: 'icon', href: '/favicon-48.png', type: 'image/png', sizes: '48x48' } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } },
        // The search button's visible text holds the shortcut, so its name must too.
        { tag: 'script', content: "addEventListener('DOMContentLoaded',()=>document.querySelectorAll('button[data-open-modal]').forEach((b)=>{const k=b.querySelector('kbd');if(k&&k.textContent.trim())b.setAttribute('aria-label','Search '+[...k.querySelectorAll('kbd')].map((x)=>x.textContent.trim()).join(' '))}))" },
      ],
      social: [
        { icon: 'external', label: 'Website', href: 'https://renplay.org' },
        { icon: 'external', label: 'Catalog', href: 'https://renplay.org/catalog' },
        { icon: 'github', label: 'GitHub', href: 'https://renplay.org/github' },
        { icon: 'heart', label: 'Support', href: 'https://renplay.org/support' },
      ],
      plugins: [starlightLinksValidator({ errorOnRelativeLinks: false })],
      sidebar: [
        {
          label: 'Start here',
          items: [
            'start-here/what-is-renplay',
            'start-here/quick-start',
            'start-here/adult-games',
          ],
        },
        {
          label: 'Install',
          items: [
            'install/docker',
            'install/kubernetes',
            'install/reverse-proxy',
            'install/truenas',
            'install/unraid',
            'install/synology',
            'install/ugreen',
            'install/qnap',
            'install/other-platforms',
          ],
        },
        { label: 'Guides', items: ['guides/adding-games', 'guides/playing', 'guides/dashboards'] },
        'accounts',
        'configuration',
        'telemetry',
        'upgrading',
        'stability',
        'catalog',
        'engines',
        'troubleshooting',
        'faq',
        {
          label: 'Developers',
          items: ['developers/architecture', 'developers/accounts-api', 'developers/contributing'],
        },
      ],
    }),
  ],
})
