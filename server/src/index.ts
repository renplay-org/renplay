import { availableParallelism } from 'node:os'
import { createApp } from './app.js'
import { loadConfig } from './config.js'

// sharp and zlib run on libuv's thread pool, which defaults to 4 threads.
process.env['UV_THREADPOOL_SIZE'] ??= String(Math.max(8, Math.min(32, availableParallelism() + 2)))

async function main() {
  const cfg = loadConfig()
  const { app, close } = await createApp(cfg, { runtimePath: process.env['RENPLAY_RUNTIME_PATH'] })
  const server = app.listen(cfg.port, '127.0.0.1', () => {
    console.log(`renplay server listening on 127.0.0.1:${cfg.port}`)
    console.log(`  games=${cfg.gamesDir} downloads=${cfg.archivesDir} data=${cfg.dataDir} internal=${cfg.internalDir}`)
  })
  server.requestTimeout = 0
  server.headersTimeout = 65_000
  const stop = () => {
    server.close()
    close()
    process.exit(0)
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

main().catch((err) => {
  console.error('Failed to start:', err)
  process.exit(1)
})
