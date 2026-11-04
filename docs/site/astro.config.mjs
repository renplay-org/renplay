import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import starlightLinksValidator from 'starlight-links-validator'

export default defineConfig({
  site: 'https://docs.renplay.org',
  integrations: [
    starlight({
      title: 'Renplay docs',
      description: 'Install, run and configure Renplay, the self-hosted player for Ren’Py and HTML games.',
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
        { tag: 'meta', attributes: { name: 'theme-color', content: '#07070a' } },
      ],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/renplay-org/renplay' },
        { icon: 'heart', label: 'Support on Ko-fi', href: 'https://ko-fi.com/janpuc' },
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
        { label: 'Guides', items: ['guides/adding-games', 'guides/playing'] },
        'configuration',
        'upgrading',
        'catalog',
        'engines',
        'troubleshooting',
        'faq',
        {
          label: 'Developers',
          items: ['developers/architecture', 'developers/contributing'],
        },
      ],
    }),
  ],
})
