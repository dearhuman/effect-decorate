import { Context, Effect, Exit, Layer, Runtime, Scope } from 'effect'
import { layerCurrentZone } from 'effect/DateTime'
import { never } from 'effect/Fiber'
import * as vscode from 'vscode'

/**
 * Tracks the VSCode-specific context created for this very extension.
 * It contains extension-related data such as subscriptions.
 */
export class VSCodeContext extends Context.Tag('vscode/ExtensionContext')<
  VSCodeContext,
  vscode.ExtensionContext
>() {}

export const launch: (
  layer: Layer.Layer<never, never, VSCodeContext>
) => Effect.Effect<void, never, VSCodeContext> = (layer) =>
  Effect.gen(function* () {
    /**
     * 1. Create a scope for this effect
     * 2. Add a new VSCode disposable subscription.
     * This is going to be responsible for cleaning up the resources
     * when deactivating the extension.
     * 3. Tie the layer's lifetime to the scope's lifetime via `buildWithScope`.
     */
    const scope = yield* Scope.make()
    const context = yield* VSCodeContext

    /** Add the disposable _before_ `buildWithScope`, so if anything goes wrong
     * while building the layer, the disposal is already registered.
     */
    context.subscriptions.push({
      dispose() {
        Effect.runFork(Scope.close(scope, Exit.void))
      },
    })
    yield* Layer.buildWithScope(layer, scope)
  }).pipe(Effect.catchAllCause(Effect.logFatal))

export const registerCommand = <A, E, R>(
  command: string,
  callback: (...args: Array<unknown>) => Effect.Effect<A, E, R>
): Effect.Effect<void, never, R | VSCodeContext> =>
  Effect.gen(function* () {
    const context = yield* VSCodeContext
    const runtime = yield* Effect.runtime<R>()

    const run = Runtime.runFork(runtime)

    context.subscriptions.push(
      vscode.commands.registerCommand(command, (...args) =>
        callback(...args).pipe(
          Effect.scoped,
          Effect.catchAllCause(Effect.logWarning),
          Effect.annotateLogs({ command }),
          run
        )
      )
    )
  })

const listen = <A, R>(
  event: vscode.Event<A>,
  callback: (data: A) => Effect.Effect<void, never, R>
): Effect.Effect<never, never, R> =>
  Effect.flatMap(Effect.runtime<R>(), (runtime) =>
    Effect.async(() => {
      const run = Runtime.runFork(runtime)
      const disposable = event((data) =>
        run(
          callback(data).pipe(
            Effect.scoped,
            Effect.catchAllCause((err) =>
              Effect.logWarning('unhandled defect in event listener: ', err)
            )
          )
        )
      )
      return Effect.sync(() => {
        disposable.dispose()
      })
    })
  )

export const listenFork = <A, R>(
  event: vscode.Event<A>,
  callback: (data: A) => Effect.Effect<void, never, R>
) => Effect.forkScoped(listen(event, callback))

export const registerHoverProvider = <R>(
  selector: vscode.DocumentSelector,
  callback: (
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ) => Effect.Effect<vscode.Hover | null, never, R>
): Effect.Effect<void, never, R | VSCodeContext> =>
  Effect.gen(function* () {
    const context = yield* VSCodeContext
    const runtime = yield* Effect.runtime<R>()

    const run = Runtime.runPromise(runtime)

    const disposable = vscode.languages.registerHoverProvider(
      selector,
      {
        provideHover(document, position, token) {
          return run(
            callback(document, position, token).pipe(
              Effect.catchAllCause((cause) =>
                Effect.logWarning(cause).pipe(Effect.as(null))
              )
            )
          )
        },
      }
    )
    context.subscriptions.push(disposable)
  })
