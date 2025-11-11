import { Effect, Layer, Logger, LogLevel } from 'effect'
import * as vscode from 'vscode'
import { logger } from './services/logger'
import { launch, VSCodeContext } from './services/VSCode'
import { Decorate } from './services/decorate'
import { Commands } from './services/commands'

const LoggerLive: Layer.Layer<never, never, never> = Layer.mergeAll(
  logger('effect-decorate'),
  Logger.minimumLogLevel(LogLevel.Trace)
)

const MainLive: Layer.Layer<never, never, VSCodeContext> = Layer.mergeAll(
  Decorate,
  Commands,
  LoggerLive
)

const program = launch(MainLive).pipe(
  Effect.andThen(Effect.logInfo('🚀 Initializing effect-decorate extension. '))
)

/**
 * The main entry point to the extension.
 * If the extension is enabled it will be called at startup or right after installation.
 */
export function activate(context: vscode.ExtensionContext) {
  Effect.runFork(program.pipe(Effect.provideService(VSCodeContext, context)))
}
