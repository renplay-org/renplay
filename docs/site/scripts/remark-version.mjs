import { readFileSync } from 'node:fs'

// Keep copyable image tags in step with releases without rewriting the guides.
const { version } = JSON.parse(readFileSync(new URL('../../../server/package.json', import.meta.url), 'utf8'))

export default function remarkVersion() {
  return function transform(tree) {
    function visit(node) {
      if (['text', 'code', 'inlineCode'].includes(node.type)) {
        node.value = node.value.replaceAll('__RENPLAY_VERSION__', version)
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}
