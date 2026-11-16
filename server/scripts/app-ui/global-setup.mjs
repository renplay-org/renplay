import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** The server's dist/ is built once, before any worker starts: the checks that run the server import it, and builds that overlap write over each other. */
export default function build() {
  const server = fileURLToPath(new URL('../../', import.meta.url))
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', '.'], { cwd: server, stdio: 'inherit' })
}
