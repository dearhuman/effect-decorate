import { Effect, Schema } from 'effect'
import * as vscode from 'vscode'

export type ExtensionConfiguration = {
  areDecorationsActive: boolean
  isDebugActive: boolean
  isNamespaceDecorationActive: boolean
  isYieldDecorationActive: boolean
  yieldableColor: 'none' | 'default' | 'custom'
  yieldableCustomColor: string
  yieldableTextDecoration: 'none' | 'underline'
  yieldStyling: 'hide' | 'thunder' | 'none'
}

const decodeWithDefault = <A>(
  schema: Schema.Schema<A>,
  value: unknown,
  defaultValue: A
): Effect.Effect<A> =>
  Schema.decodeUnknown(schema)(value).pipe(
    Effect.catchAll((err) =>
      Effect.logWarning(err).pipe(Effect.andThen(Effect.succeed(defaultValue)))
    )
  )

const getConfigValue =
  (configuration: vscode.WorkspaceConfiguration) =>
  <A>(
    key: string,
    schema: Schema.Schema<A>,
    defaultValue: A
  ): Effect.Effect<A> =>
    Effect.gen(function* () {
      const value = configuration.get(key)

      return yield* decodeWithDefault<A>(schema, value, defaultValue)
    })

/**
 * Retrieves and parses the extension configuration
 */
export const getExtensionConfiguration: Effect.Effect<ExtensionConfiguration> =
  Effect.gen(function* () {
    const config = vscode.workspace.getConfiguration(
      'effect-decorate.extension'
    )

    const getValue = getConfigValue(config)

    const areDecorationsActive = yield* getValue(
      'areDecorationsActive',
      Schema.Boolean,
      true
    )

    const isDebugActive = yield* getValue('isDebugActive', Schema.Boolean, true)
    const isNamespaceDecorationActive = yield* getValue(
      'isNamespaceDecorationActive',
      Schema.Boolean,
      true
    )
    const isYieldDecorationActive = yield* getValue(
      'isYieldDecorationActive',
      Schema.Boolean,
      true
    )
    const yieldableColor = yield* getValue(
      'yieldableColor',
      Schema.Literal('none', 'default', 'custom'),
      'default'
    )
    const yieldableCustomColor = yield* getValue(
      'yieldableCustomColor',
      Schema.String,
      '#ffffff'
    )
    const yieldableTextDecoration = yield* getValue(
      'yieldableTextDecoration',
      Schema.Literal('none', 'underline'),
      'underline'
    )
    const yieldStyling = yield* getValue(
      'yieldStyling',
      Schema.Literal('hide', 'thunder', 'none'),
      'hide'
    )

    return {
      areDecorationsActive,
      isDebugActive,
      isNamespaceDecorationActive,
      isYieldDecorationActive,
      yieldableColor,
      yieldableCustomColor,
      yieldableTextDecoration,
      yieldStyling,
    }
  })
