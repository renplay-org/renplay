import { appendFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const name = (test) => test.titlePath().filter(Boolean).join(' > ')

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
    for (const test of failed) lines.push(`Failed: ${name(test)}`)
    if (flaky.length) {
      lines.push('', '## Flaky, to fix from the flake hunt', 'Each of these failed, then passed on its retry. They do not fail the pull request.')
      for (const test of flaky) lines.push(`- ${name(test)}`)
      // One warning on the run for each, so a pass that needed a retry is seen without opening the summary.
      if (process.env.GITHUB_ACTIONS) for (const test of flaky) console.log(`::warning title=Flaky test::${name(test).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`)
    }
    if (failed.length || flaky.length) lines.push('Download this job\'s artifact for the JSON report and retained failure traces. No PR screenshots are published.')
    const text = lines.join('\n') + '\n'
    console.log(text)
    writeFileSync(fileURLToPath(new URL('../../../ui-test-results/summary.md', import.meta.url)), text)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
  }
}
