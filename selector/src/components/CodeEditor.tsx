import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { python } from '@codemirror/lang-python'
import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { useEffect, useRef } from 'react'

/** CodeMirror editor; Ren'Py script is close enough to Python for highlighting. */
export default function CodeEditor({ value, onChange, onSave, language }: { value: string; onChange: (v: string) => void; onSave: () => void; language: 'python' | 'text' }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const saveRef = useRef(onSave)
  saveRef.current = onSave

  useEffect(() => {
    if (!host.current) return
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          indentUnit.of('    '),
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => (saveRef.current(), true) },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          language === 'python' ? python() : [],
          oneDark,
          EditorView.theme({ '&': { height: '100%', fontSize: '13px' }, '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }),
          EditorView.updateListener.of((u) => u.docChanged && onChange(u.state.doc.toString())),
        ],
      }),
    })
    return () => view.current?.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={host} className="h-full overflow-hidden rounded-xl ring-1 ring-white/10" />
}
