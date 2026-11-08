import { availableParallelism } from 'node:os'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { log, logLevel, parseLogLevel, routeConsole } from './util/log.js'

// sharp and zlib run on libuv's thread pool, which defaults to 4 threads.
process.env['UV_THREADPOOL_SIZE'] ??= String(Math.max(8, Math.min(32, availableParallelism() + 2)))

async function main() {
  routeConsole()
  if (process.env['RENPLAY_LOG_LEVEL'] && !parseLogLevel(process.env['RENPLAY_LOG_LEVEL'])) console.warn(`config: RENPLAY_LOG_LEVEL=${process.env['RENPLAY_LOG_LEVEL']} is not error, warn, info or debug. Using info.`)
  const cfg = loadConfig()
  const { app, close, summary } = await createApp(cfg, { runtimePath: process.env['RENPLAY_RUNTIME_PATH'] })
  const server = app.listen(cfg.port, '127.0.0.1', () => {
    for (const item of summary()) log('server', item)
    log('server', `Ready, logging at ${logLevel()}`)
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
  // A demo starts fresh: after 4 hours of running, once nobody has asked anything for a minute, the
  // server stops and the host starts it again from its image.
  if (cfg.demo) {
    let lastRequest = Date.now()
    server.on('request', () => {
      lastRequest = Date.now()
    })
    const started = Date.now()
    setInterval(() => {
      if (Date.now() - started < 4 * 3600_000 || Date.now() - lastRequest < 60_000) return
      log('server', 'The demo ran for 4 hours. Stopping, to start again fresh.')
      stop()
    }, 30_000).unref()
  }
}

main().catch((err) => {
  console.error('Renplay could not start:', err)
  process.exit(1)
})
