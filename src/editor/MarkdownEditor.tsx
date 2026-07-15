import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useLayoutEffect, useRef } from 'react'

import { codeMirrorPhrases, useWorkspaceLocale } from '../i18n/workspaceLocale'

export interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  onSave?: () => void
}

const markdownHighlightStyle = HighlightStyle.define(
  [
    {
      tag: [tags.meta, tags.punctuation, tags.contentSeparator],
      color: 'var(--color-text-muted)',
    },
    { tag: tags.heading, color: 'var(--color-text)', fontWeight: '700' },
    { tag: [tags.link, tags.url], color: 'var(--color-accent)' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strong, fontWeight: '700' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    {
      tag: [tags.keyword, tags.atom, tags.bool],
      color: 'var(--color-accent)',
    },
    {
      tag: [tags.string, tags.literal, tags.inserted],
      color: 'color-mix(in oklch, var(--color-accent) 72%, var(--color-text))',
    },
    {
      tag: [tags.comment, tags.quote],
      color: 'var(--color-text-muted)',
    },
    { tag: tags.invalid, textDecoration: 'underline wavy var(--color-accent)' },
  ],
  { all: { color: 'var(--color-text)' } },
)

const editorThemeRules = {
  '&': {
    height: '100%',
    color: 'var(--color-text)',
    backgroundColor: 'var(--color-surface)',
  },
  '.cm-content': {
    caretColor: 'var(--color-text)',
    fontFamily: 'var(--font-mono)',
  },
  '.cm-gutters': {
    color: 'var(--color-text-muted)',
    backgroundColor: 'var(--color-canvas)',
    borderRight: '1px solid var(--color-border)',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'color-mix(in oklch, var(--color-accent) 8%, transparent)',
  },
  '.cm-panels, .cm-tooltip': {
    color: 'var(--color-text)',
    backgroundColor: 'var(--color-surface)',
    borderColor: 'var(--color-border)',
  },
  '.cm-button, .cm-textfield': {
    color: 'var(--color-text)',
    backgroundColor: 'var(--color-canvas)',
    border: '1px solid var(--color-border)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    color: 'var(--color-text)',
    backgroundColor: 'color-mix(in oklch, var(--color-accent) 16%, var(--color-surface))',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in oklch, var(--color-accent) 24%, transparent)',
    outline: '1px solid var(--color-accent)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--color-text)',
  },
  '&.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklch, var(--color-accent) 25%, transparent)',
  },
}

function createEditorTheme(dark: boolean) {
  return EditorView.theme(editorThemeRules, { dark })
}

function usesDarkTheme(mediaQuery?: MediaQueryList) {
  const explicitTheme = document.documentElement.dataset.theme
  if (explicitTheme === 'dark') return true
  if (explicitTheme === 'light') return false
  return mediaQuery?.matches ?? false
}

export function MarkdownEditor({
  value,
  onChange,
  ariaLabel,
  onSave,
}: MarkdownEditorProps) {
  const { locale } = useWorkspaceLocale()
  const parentRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const ariaLabelRef = useRef(ariaLabel)
  const localeRef = useRef(locale)
  const phrasesCompartmentRef = useRef(new Compartment())
  const replaceValueRef = useRef<(nextValue: string) => void>(() => undefined)

  onChangeRef.current = onChange
  onSaveRef.current = onSave
  ariaLabelRef.current = ariaLabel
  localeRef.current = locale

  useLayoutEffect(() => {
    const parent = parentRef.current
    if (!parent) return

    const themeCompartment = new Compartment()
    const phrasesCompartment = phrasesCompartmentRef.current
    const mediaQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : undefined
    let dark = usesDarkTheme(mediaQuery)

    const createState = (doc: string) =>
      EditorState.create({
        doc,
        extensions: [
          basicSetup,
          markdown(),
          syntaxHighlighting(markdownHighlightStyle),
          themeCompartment.of(createEditorTheme(dark)),
          phrasesCompartment.of(
            EditorState.phrases.of(codeMirrorPhrases(localeRef.current)),
          ),
          EditorView.contentAttributes.of({
            'aria-label': ariaLabelRef.current,
            'aria-multiline': 'true',
            spellcheck: 'true',
          }),
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                onSaveRef.current?.()
                return true
              },
            },
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString())
            }
          }),
        ],
      })

    const view = new EditorView({
      parent,
      state: createState(value),
    })

    viewRef.current = view
    replaceValueRef.current = (nextValue) => {
      if (view.state.doc.toString() !== nextValue) {
        view.setState(createState(nextValue))
      }
    }

    const syncTheme = () => {
      const nextDark = usesDarkTheme(mediaQuery)
      if (nextDark === dark) return
      dark = nextDark
      view.dispatch({
        effects: themeCompartment.reconfigure(createEditorTheme(dark)),
      })
    }
    const themeObserver = new MutationObserver(syncTheme)
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    mediaQuery?.addEventListener('change', syncTheme)

    return () => {
      themeObserver.disconnect()
      mediaQuery?.removeEventListener('change', syncTheme)
      replaceValueRef.current = () => undefined
      viewRef.current = null
      view.destroy()
    }
  }, [])

  useLayoutEffect(() => {
    replaceValueRef.current(value)
  }, [value])

  useLayoutEffect(() => {
    viewRef.current?.contentDOM.setAttribute('aria-label', ariaLabel)
  }, [ariaLabel])

  useLayoutEffect(() => {
    viewRef.current?.dispatch({
      effects: phrasesCompartmentRef.current.reconfigure(
        EditorState.phrases.of(codeMirrorPhrases(locale)),
      ),
    })
  }, [locale])

  return <div className="markdown-editor" ref={parentRef} />
}
