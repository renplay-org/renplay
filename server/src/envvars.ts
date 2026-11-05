/**
 * Every environment variable Renplay reads, in one table. config.ts reads its defaults from here,
 * and docs/site/scripts/gen-config.mjs writes the configuration page of the docs from it. Keep
 * the descriptions short, in plain words for the person running the server. Only erasable
 * TypeScript here: the docs script loads this file with Node directly.
 */
export interface EnvVar {
  name: string
  group: 'Folders' | 'Games and catalog' | 'Images and saves' | 'Behind a proxy' | 'Server'
  kind: 'text' | 'number' | 'yes/no' | 'choice'
  /** The value used when the variable is unset or empty. */
  fallback: string | number | boolean
  /** What the page shows as the default when it is worked out from other variables. */
  shown?: string
  description: string
}

export const ENV_VARS: readonly EnvVar[] = [
  { name: 'RENPLAY_AUTH', group: 'Server', kind: 'choice', fallback: '', shown: 'on for new installs, off after an upgrade', description: '`on` requires sign-in. `off` lets everyone play as one account. Saves always stay separate per account. Upgraded installs show an admin reminder while sign-in is off.' },
  { name: 'RENPLAY_AUTH_USER', group: 'Server', kind: 'number', fallback: 1, description: 'Account id used without sign-in. The owner is 1; other accounts and their saves stay untouched.' },
  { name: 'RENPLAY_AUTH_LOCAL', group: 'Server', kind: 'yes/no', fallback: true, description: 'Enable username and password sign-in. With sign-in on, disabling the only provider refuses startup.' },
  { name: 'RENPLAY_ADMIN_USERNAME', group: 'Server', kind: 'text', fallback: '', shown: 'not set', description: 'Claim the owner account at first start with this username and RENPLAY_ADMIN_PASSWORD. Otherwise use the setup code printed in the server log.' },
  { name: 'RENPLAY_ADMIN_PASSWORD', group: 'Server', kind: 'text', fallback: '', shown: 'not set', description: 'Initial owner password (at least 10 characters). Only used while the owner is unclaimed. Prefer RENPLAY_ADMIN_PASSWORD_FILE.' },
  { name: 'RENPLAY_ADMIN_PASSWORD_FILE', group: 'Server', kind: 'text', fallback: '', shown: 'not set', description: 'Read the initial owner password from this secret file. Set this or RENPLAY_ADMIN_PASSWORD, not both.' },
  { name: 'RENPLAY_PUBLIC_URL', group: 'Behind a proxy', kind: 'text', fallback: '', shown: 'not set', description: 'Public address, such as https://play.example.org. Used to check request origins and secure cookies. Plain HTTP works too, but HTTPS protects passwords and saves in transit.' },
  { name: 'RENPLAY_TRUSTED_HOPS', group: 'Behind a proxy', kind: 'number', fallback: 1, description: 'Trusted proxy hops for client addresses and HTTPS detection. The included nginx is one hop. Use 0 when exposing Node directly; never trust arbitrary forwarded headers.' },
  { name: 'RENPLAY_ADULT_DEFAULT', group: 'Games and catalog', kind: 'choice', fallback: 'block', description: '`allow` gives newly created accounts access to adult games. `block` (and any other value) does not. The first admin always has access; admins can change access per account.' },
  {
    name: 'PORT',
    group: 'Server',
    kind: 'number',
    fallback: 3000,
    description:
      'Port of the Renplay server inside the container. nginx listens on 8080 and forwards to it, so you rarely change this.',
  },
  {
    name: 'GAMES_DIR',
    group: 'Folders',
    kind: 'text',
    fallback: '/games',
    description: 'Where installed games live. Put this on a big disk.',
  },
  {
    name: 'DATA_DIR',
    group: 'Folders',
    kind: 'text',
    fallback: '/data',
    description: 'Saves and their history, the library database, mods, covers and walkthroughs. Back this up.',
  },
  {
    name: 'ARCHIVES_DIR',
    group: 'Folders',
    kind: 'text',
    fallback: '',
    shown: '`$GAMES_DIR/_archives`',
    description: 'The drop folder for game downloads (zip, 7z, rar), and the source for reinstalls.',
  },
  {
    name: 'RENPLAY_DIR',
    group: 'Folders',
    kind: 'text',
    fallback: '',
    shown: '`$GAMES_DIR/_renplay`',
    description: 'Engines and scratch space. Keep it on the same filesystem as `GAMES_DIR`.',
  },
  {
    name: 'SAVES_DIR',
    group: 'Folders',
    kind: 'text',
    fallback: '',
    shown: '`$DATA_DIR/saves`',
    description: 'Where saves are stored, laid out like desktop Ren’Py does.',
  },
  {
    name: 'SAVE_HISTORY_DIR',
    group: 'Folders',
    kind: 'text',
    fallback: '',
    shown: '`$DATA_DIR/save-history`',
    description: 'Earlier versions of saves that were overwritten or deleted.',
  },
  {
    name: 'OVERLAYS_DIR',
    group: 'Folders',
    kind: 'text',
    fallback: '',
    shown: '`$DATA_DIR/overlays`',
    description: 'Mods: your files, layered over a game.',
  },
  {
    name: 'RENPLAY_DELETE_ARCHIVES',
    group: 'Games and catalog',
    kind: 'yes/no',
    fallback: true,
    description:
      'Delete a download once its game installed. `false` keeps it, so the game can be reinstalled without uploading again.',
  },
  {
    name: 'RENPLAY_ADULT_GAMES',
    group: 'Games and catalog',
    kind: 'choice',
    fallback: '',
    shown: 'not set',
    description:
      '`allow` or `block` adult games for the whole install, and lock the choice. Not set: an existing library keeps showing adult games, a new install asks once in the empty library, and admins can change an unlocked choice in Settings. `block` reads the catalog’s safe-for-work index and hides adult games already in the library without deleting them. Any other value counts as `block`.',
  },
  {
    name: 'RENPLAY_CATALOG_URLS',
    group: 'Games and catalog',
    kind: 'text',
    fallback: 'https://catalog.renplay.org/index.v3.json',
    description: 'Catalog indexes, separated by commas. The first one that defines a tag wins.',
  },
  {
    name: 'RENPLAY_ENGINES_URL',
    group: 'Games and catalog',
    kind: 'text',
    fallback: 'https://engines.renplay.org/index.json',
    description: 'Where the Ren’Py web engines come from.',
  },
  {
    name: 'RENPLAY_ENGINE',
    group: 'Games and catalog',
    kind: 'text',
    fallback: '',
    shown: 'newest for the game',
    description: 'Build every game with this one engine version, such as one the engines index lists. A game’s recipe still wins.',
  },
  {
    name: 'RENPLAY_IMAGE_QUALITY',
    group: 'Images and saves',
    kind: 'number',
    fallback: 88,
    description: 'WebP quality (1 to 100) for converted images.',
  },
  {
    name: 'RENPLAY_IMAGE_CONCURRENCY',
    group: 'Images and saves',
    kind: 'number',
    fallback: 0,
    shown: 'CPU count (at most 16)',
    description: 'Images converted in parallel during an install. `0` picks the CPU count.',
  },
  {
    name: 'RENPLAY_SAVE_HISTORY',
    group: 'Images and saves',
    kind: 'number',
    fallback: 20,
    description: 'Earlier versions kept per save file.',
  },
  {
    name: 'RENPLAY_KEEPALIVE_URL',
    group: 'Behind a proxy',
    kind: 'text',
    fallback: '',
    shown: 'not set',
    description:
      'For scale-to-zero setups: a public URL that routes back to this server. While an install runs, Renplay keeps requesting it so the proxy does not stop the server.',
  },
  {
    name: 'RENPLAY_KEEPALIVE_HOST',
    group: 'Behind a proxy',
    kind: 'text',
    fallback: '',
    shown: 'not set',
    description: 'The `Host` header to send with the keep-alive requests, if the proxy routes by host name.',
  },
]

const byName = new Map(ENV_VARS.map((v) => [v.name, v]))

/** The default of a variable from the table. */
export function fallbackOf<T extends string | number | boolean>(name: string): T {
  const v = byName.get(name)
  if (!v) throw new Error(`${name} is not in ENV_VARS`)
  return v.fallback as T
}
