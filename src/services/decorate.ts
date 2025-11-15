import {
  Effect,
  Layer,
  Metric,
  Option,
  pipe,
  Ref,
  Stream,
  SubscriptionRef,
} from 'effect'
import * as vscode from 'vscode'
import { ExtensionConfiguration, getExtensionConfiguration } from './extension'
import { listenFork } from './VSCode'

const fromBoolean: (bool: boolean) => <A>(a: A) => Option.Option<A> =
  (bool) => (a) => (bool ? Option.some(a) : Option.none())

/**
 * Returns the editors that are relevant for decoration purposes.
 */
const getEditors = () =>
  vscode.window.visibleTextEditors.filter(
    (editor) =>
      editor.document.uri.scheme === 'file' &&
      editor.document.languageId === 'typescript'
  )

const getRanges = (options: {
  document: vscode.TextDocument
  text: string
  regexp: RegExp
}) => {
  const { document, text, regexp } = options
  const ranges: vscode.Range[] = []

  for (const match of text.matchAll(regexp)) {
    if (!match[0]) {
      continue
    }
    const index = match.index
    const start = document.positionAt(index)
    const end = document.positionAt(index + match[0].length)

    ranges.push(new vscode.Range(start, end))
  }
  return ranges
}

const areRangesIntersecting = (
  range: vscode.Range,
  ranges: readonly vscode.Range[]
): boolean => {
  for (const r of ranges) {
    if (range.intersection(r)) {
      return true
    }
  }
  return false
}

const singleLineCommentRegex = /\/\/.*/g
const multiLineCommentRegex = /\/\*[\s\S]*?\*\//g

// Note, this return two matches: the whole pattern `yield* foo` and `foo` on its own.
const yieldRegex = /yield\*\s(\w+)/g

const getCommentRanges = (document: vscode.TextDocument, text: string) => {
  const singleLineComments = getRanges({
    document,
    text,
    regexp: singleLineCommentRegex,
  })

  const multiLineComments = getRanges({
    document,
    text,
    regexp: multiLineCommentRegex,
  })

  return [...singleLineComments, ...multiLineComments]
}

const getYieldRanges = (params: {
  document: vscode.TextDocument
  text: string
  commentRanges: readonly vscode.Range[]
}): {
  yields: vscode.Range[]
  yieldables: vscode.Range[]
} => {
  const { document, text, commentRanges } = params
  const yields: vscode.Range[] = []
  const yieldables: vscode.Range[] = []

  let match

  while ((match = yieldRegex.exec(text)) !== null) {
    const yieldStart = document.positionAt(match.index)
    const yieldableEnd = document.positionAt(match.index + match[0].length)
    const matchRange = new vscode.Range(yieldStart, yieldableEnd)

    if (areRangesIntersecting(matchRange, commentRanges)) {
      continue
    }

    const yieldEnd = document.positionAt(
      match.index + match[0].length - match[1]!.length
    )
    const yieldRange = new vscode.Range(yieldStart, yieldEnd)
    const yieldableStart = yieldEnd
    const yieldableRange = new vscode.Range(yieldableStart, yieldableEnd)

    yields.push(yieldRange)
    yieldables.push(yieldableRange)
  }

  return { yieldables, yields }
}
const getNamespaceRanges = (params: {
  document: vscode.TextDocument
  text: string
  commentRanges: readonly vscode.Range[]
}): {
  namespaces: vscode.Range[]
  types: vscode.Range[]
} => {
  const { document, text, commentRanges } = params
  const namespaces: vscode.Range[] = []
  const types: vscode.Range[] = []

  const regex = /\b([A-Z]\w*)\.([A-Z]\w*)\b/g
  let match

  while ((match = regex.exec(text)) !== null) {
    if (match[1] !== match[2]) {
      continue
    }

    const matchStart = document.positionAt(match.index)
    const matchEnd = document.positionAt(match.index + match[0].length)
    const matchRange = new vscode.Range(matchStart, matchEnd)

    if (areRangesIntersecting(matchRange, commentRanges)) {
      continue
    }

    const namespaceEnd = document.positionAt(match.index + match[1]!.length + 1)
    const namespaceRange = new vscode.Range(matchStart, namespaceEnd)

    const typeStart = namespaceEnd
    const typeRange = new vscode.Range(typeStart, matchEnd)

    namespaces.push(namespaceRange)
    types.push(typeRange)
  }

  return { namespaces, types }
}

type DecorationTypes = {
  yieldDecoration: Option.Option<vscode.TextEditorDecorationType>
  yieldableDecoration: Option.Option<vscode.TextEditorDecorationType>
  namespaceDecoration: Option.Option<vscode.TextEditorDecorationType>
}

/**
 * Alias for readibility
 */
const createDecoration = vscode.window.createTextEditorDecorationType

const hideDecoration: vscode.DecorationRenderOptions = {
  opacity: '0',
  letterSpacing: '-0.6em',
}

const getDecorations = (config: ExtensionConfiguration): DecorationTypes => {
  const getYieldDecoration = () => {
    if (!config.isYieldDecorationActive || config.yieldStyling === 'none') {
      return Option.none()
    }
    if (config.yieldStyling === 'hide') {
      return Option.some(createDecoration(hideDecoration))
    }
    // thunder
    return Option.some(
      createDecoration({
        before: {
          contentText: '⚡',
        },
        opacity: '0',
        letterSpacing: '-0.6em',
      })
    )
  }

  const yieldDecoration = getYieldDecoration()

  const getYieldableDecoration = () => {
    if (!config.isYieldDecorationActive) {
      return Option.none()
    } else {
      const hasColor = config.yieldableColor !== 'none'

      const color =
        config.yieldableColor === 'default'
          ? new vscode.ThemeColor('editorInfo.foreground')
          : config.yieldableCustomColor

      if (hasColor) {
        return Option.some(
          createDecoration({
            color,
            textDecoration: config.yieldableTextDecoration,
          })
        )
      } else {
        return Option.some(
          createDecoration({
            textDecoration: config.yieldableTextDecoration,
          })
        )
      }
    }
  }

  const yieldableDecoration = getYieldableDecoration()

  const namespaceDecoration = fromBoolean(config.isNamespaceDecorationActive)(
    createDecoration(hideDecoration)
  )

  return {
    yieldableDecoration,
    yieldDecoration,
    namespaceDecoration,
  }
}

/**
 * Core part of the extension.
 */
export const Decorate: Layer.Layer<never, never, never> = Layer.scopedDiscard(
  Effect.gen(function* () {
    // setup a reactive ref we can subscribe to
    const configRef: SubscriptionRef.SubscriptionRef<ExtensionConfiguration> =
      yield* getExtensionConfiguration.pipe(
        Effect.andThen(SubscriptionRef.make)
      )

    // listen to configuration changes and update the config ref
    yield* listenFork(vscode.workspace.onDidChangeConfiguration, () =>
      getExtensionConfiguration.pipe(
        Effect.andThen((config) => SubscriptionRef.set(configRef, config))
      )
    )

    /**
     * Tracks the decoration types.
     * These can change when the user changes the extension configuration.
     */
    const decorationTypes = yield* pipe(
      configRef.get,
      Effect.andThen(getDecorations),
      Effect.andThen(Ref.make)
    )

    // In order to avoid duplicate work we cache as many calculations
    // as possible. Those include the positions of the current comments and
    // the positions of the current decorations.

    /**
     * Type alias for a string representing the uri of a file
     */
    type Uri = string

    /**
     * Caches the comments positions for every editor.
     */
    const commentsCache = yield* Ref.make<
      Map<Uri, { version: number; ranges: vscode.Range[] }>
    >(new Map())

    /**
     * Caches the `Namespace.Namespace` pattern positions for every editor.
     */
    const namespacesCache = yield* Ref.make<
      Map<
        Uri,
        { version: number; namespaces: vscode.Range[]; types: vscode.Range[] }
      >
    >(new Map())

    /**
     * Caches the `yield* foo` pattern positions for every editor.
     */
    const yieldsCache = yield* Ref.make<
      Map<
        string,
        {
          version: number
          yields: vscode.Range[]
          yieldables: vscode.Range[]
        }
      >
    >(new Map())

    // NOTE: all functions take text along the editor for performance reasons
    // editor exposes APIs to get the positions in the document
    // but we compute the text only once

    /**
     * Returns all the comments in a text editor.
     * Returns cached results if the file hasn't changed.
     */
    const getComments = (editor: vscode.TextEditor, text: string) =>
      Effect.gen(function* () {
        const cache = yield* commentsCache
        const uri = editor.document.uri.path
        const version = editor.document.version

        const cached = cache.get(uri)
        if (cached && cached.version === version) {
          return cached.ranges
        }

        const ranges = getCommentRanges(editor.document, text)

        yield* Ref.update(commentsCache, (map) =>
          new Map(map).set(uri, { version, ranges })
        )
        return ranges
      })

    /**
     * Returns all the `yield* foo` patterns in a text editor.
     * Returns cached results if the file hasn't changed.
     */
    const getYields = (
      editor: vscode.TextEditor,
      text: string,
      selections: readonly vscode.Selection[]
    ) =>
      Effect.gen(function* () {
        const cache = yield* yieldsCache
        const uri = editor.document.uri.path
        const version = editor.document.version

        const cached = cache.get(uri)

        const comments = yield* getComments(editor, text)

        const ranges =
          cached && cached.version === version
            ? { yields: cached.yields, yieldables: cached.yieldables }
            : getYieldRanges({
                document: editor.document,
                text,
                commentRanges: comments,
              })

        yield* Ref.update(yieldsCache, (map) =>
          new Map(map).set(uri, {
            version,
            yields: ranges.yields,
            yieldables: ranges.yieldables,
          })
        )
        const yields: vscode.Range[] = []
        const yieldables: vscode.Range[] = []

        for (let i = 0; i < ranges.yields.length; i++) {
          const _yield = ranges.yields[i]
          const _yieldable = ranges.yieldables[i]

          if (!_yield || !_yieldable) {
            continue
          }

          // if our symbols intersect selections, we don't decorate them
          const shouldSkip =
            areRangesIntersecting(_yieldable, selections) ||
            areRangesIntersecting(_yield, selections)

          if (!shouldSkip) {
            yields.push(_yield)
            yieldables.push(_yieldable)
          }
        }

        return { yields, yieldables }
      })

    const getNamespaces = (
      editor: vscode.TextEditor,
      text: string,
      selections: readonly vscode.Selection[]
    ) =>
      Effect.gen(function* () {
        const cache = yield* namespacesCache
        const uri = editor.document.uri.path
        const version = editor.document.version

        const cached = cache.get(uri)

        const comments = yield* getComments(editor, text)

        const ranges =
          cached && cached.version === version
            ? { namespaces: cached.namespaces, types: cached.types }
            : getNamespaceRanges({
                document: editor.document,
                text,
                commentRanges: comments,
              })

        yield* Ref.update(namespacesCache, (map) =>
          new Map(map).set(uri, {
            version,
            namespaces: ranges.namespaces,
            types: ranges.types,
          })
        )

        const namespaces: vscode.Range[] = []
        const types: vscode.Range[] = []

        for (let i = 0; i < ranges.namespaces.length; i++) {
          const namespace = ranges.namespaces[i]
          const type = ranges.types[i]

          if (!namespace || !type) {
            continue
          }

          const shouldSkip =
            areRangesIntersecting(namespace, selections) ||
            areRangesIntersecting(type, selections)

          if (!shouldSkip) {
            namespaces.push(namespace)
            types.push(type)
          }
        }

        return { namespaces, types }
      })

    const cleanDecorations = (editor: vscode.TextEditor) =>
      Effect.gen(function* () {
        const decorations = yield* decorationTypes
        if (Option.isSome(decorations.namespaceDecoration)) {
          editor.setDecorations(decorations.namespaceDecoration.value, [])
        }
        if (Option.isSome(decorations.yieldableDecoration)) {
          editor.setDecorations(decorations.yieldableDecoration.value, [])
        }
        if (Option.isSome(decorations.namespaceDecoration)) {
          editor.setDecorations(decorations.namespaceDecoration.value, [])
        }
      })

    const decorateCounter = Metric.counter('decorate_count', {
      description: 'Counts how many times `decorate` has run',
      incremental: true,
    })

    const decorate = Effect.gen(function* () {
      const config = yield* configRef

      // nothing to decorate if the decorations aren't activated via config
      if (!config.areDecorationsActive) {
        return
      }

      const textEditors = getEditors()

      // nothing to decorate if there's no suitable text editors
      if (textEditors.length === 0) {
        return
      }

      // Track how many times are we decorating for performance tuning
      const count = yield* Metric.value(decorateCounter)
      yield* decorateCounter(Effect.succeed(1))

      const { yieldDecoration, yieldableDecoration, namespaceDecoration } =
        yield* decorationTypes

      for (const editor of textEditors) {
        // TODO: This can likely be improved and avoided
        // We shouldn't always clean all in order to redecorate
        yield* cleanDecorations(editor)
        const selections = editor.selections

        const text = editor.document.getText()

        const yields = yield* getYields(editor, text, selections)

        const namespaces = yield* getNamespaces(editor, text, selections)

        if (Option.isSome(yieldDecoration)) {
          editor.setDecorations(yieldDecoration.value, yields.yields)
        }
        if (Option.isSome(yieldableDecoration)) {
          editor.setDecorations(yieldableDecoration.value, yields.yieldables)
        }
        if (Option.isSome(namespaceDecoration)) {
          editor.setDecorations(
            namespaceDecoration.value,
            namespaces.namespaces
          )
        }
      }
      yield* Effect.logTrace(`count: ${count.count})`)
    }).pipe(Effect.withLogSpan('decorate'))

    /**
     * Reactively sync the config with the decoration types.
     * If the user changes decoration settings, we update the decorationTypes ref.
     * Then we update the decorations by triggering `decorate`,
     * which will use the updated decoration types.
     */
    yield* Effect.forkScoped(
      configRef.changes.pipe(
        Stream.runForEach((newConfig) =>
          Effect.gen(function* () {
            const old = yield* Ref.get(decorationTypes)

            if (Option.isSome(old.yieldDecoration)) {
              old.yieldDecoration.value.dispose()
            }

            if (Option.isSome(old.yieldableDecoration)) {
              old.yieldableDecoration.value.dispose()
            }

            if (Option.isSome(old.namespaceDecoration)) {
              old.namespaceDecoration.value.dispose()
            }

            yield* Ref.set(decorationTypes, getDecorations(newConfig))

            yield* decorate.pipe(
              Effect.annotateLogs({ trigger: 'configChange' })
            )
          })
        )
      )
    )

    // Last step: listen to selection changes
    yield* listenFork(vscode.window.onDidChangeTextEditorSelection, (event) =>
      event.textEditor.document.languageId === 'typescript'
        ? decorate.pipe(Effect.annotateLogs({ trigger: 'selectionChange' }))
        : Effect.void
    )

    // and trigger the first decoration at startup
    yield* decorate
  })
)
