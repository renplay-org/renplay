/** Minimal concurrency limiter with a bounded backlog for backpressure. */
export class Limiter {
  private active = 0
  private waiting: Array<() => void> = []
  private errors: unknown[] = []
  private idleWaiters: Array<() => void> = []

  constructor(private readonly concurrency: number) {}

  /** Resolves once a slot is free. Call `release()` when done. */
  async acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++
      return
    }
    await new Promise<void>((r) => this.waiting.push(r))
    this.active++
  }

  release(): void {
    this.active--
    const next = this.waiting.shift()
    if (next) next()
    else if (this.active === 0) this.idleWaiters.splice(0).forEach((r) => r())
  }

  /** Waits for a slot, then runs `fn` in the background. Errors surface in `drain()`. */
  async run(fn: () => Promise<void>): Promise<void> {
    if (this.errors.length) throw this.errors[0]
    await this.acquire()
    fn()
      .catch((e) => this.errors.push(e))
      .finally(() => this.release())
  }

  /** Runs `fn` in a slot obtained earlier with `acquire()`; releases it when done. */
  spawn(fn: () => Promise<void>): void {
    fn()
      .catch((e) => this.errors.push(e))
      .finally(() => this.release())
  }

  async drain(): Promise<void> {
    if (this.active > 0) await new Promise<void>((r) => this.idleWaiters.push(r))
    if (this.errors.length) throw this.errors[0]
  }
}
