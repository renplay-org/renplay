// What cloudflare:workers gives the tests: the D1 binding of wrangler.toml and the Worker's exports.
declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import('../src/index')
  }
  interface Env {
    DB: D1Database
  }
}
