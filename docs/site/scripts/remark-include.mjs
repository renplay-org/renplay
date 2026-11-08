import { readFileSync } from 'node:fs'

// A code block written as ```yaml file=deploy/compose.yaml shows that file of the repository, so
// the docs and the files people copy never differ. The file's opening comments are left out: the
// page around the block says the same.
const root = new URL('../../../', import.meta.url)

export function includeFile(path) {
  const lines = readFileSync(new URL(path, root), 'utf8').split('\n')
  let start = 0
  while (start < lines.length && lines[start].startsWith('#')) start++
  while (start < lines.length && lines[start].trim() === '') start++
  return lines.slice(start).join('\n').trimEnd()
}

export default function remarkInclude() {
  return function transform(tree) {
    function visit(node) {
      const file = node.type === 'code' && /(?:^|\s)file=(\S+)/.exec(node.meta ?? '')
      if (file) {
        node.value = includeFile(file[1])
        node.meta = node.meta.replace(file[0], '').trim() || null
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}
