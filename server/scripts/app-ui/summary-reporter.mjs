import { appendFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export default class SummaryReporter {
  onBegin(_config, suite) { this.suite = suite }
  onEnd(result) {
    const tests = this.suite.allTests()
    const failed = tests.filter((t) => t.outcome() === 'unexpected')
    const flaky = tests.filter((t) => t.outcome() === 'flaky')
    const lines = [
      '## Browser tests',
      `${tests.length} tests, ${failed.length} failed, ${flaky.length} flaky, ${tests.filter((t) => t.outcome() === 'skipped').length} skipped.`,
      `Total wall time: ${(result.duration / 1000).toFixed(1)} s.`,
    ]
    for (const project of this.suite.suites) {
      const ms = project.allTests().flatMap((t) => t.results).reduce((n, r) => n + r.duration, 0)
      lines.push(`${project.title}: ${(ms / 1000).toFixed(1)} s of test time.`)
    }
    for (const [kind, list] of [['Failed', failed], ['Flaky', flaky]]) {
      for (const test of list) lines.push(`${kind}: ${test.titlePath().filter(Boolean).join(' > ')}`)
    }
    if (flaky.length) lines.push('WARNING: Tests passed only on retry. CI treats this as a failure.')
    if (failed.length || flaky.length) lines.push('Download this job\'s artifact for the JSON report and retained failure traces. No PR screenshots are published.')
    const text = lines.join('\n') + '\n'
    console.log(text)
    writeFileSync(fileURLToPath(new URL('../../../ui-test-results/summary.md', import.meta.url)), text)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
  }
}
