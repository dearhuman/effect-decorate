import { Effect, Logger, LogLevel } from 'effect'
import { getExtensionConfiguration } from './extension'
import * as vscode from 'vscode'

/**
 * Logger is not a real service thus we need this shenanigan
 */
const getUnsafeLoggingConfiguration = () =>
  Effect.runSync(getExtensionConfiguration)

/**
 * The actual logger instance
 */
export const logger = (name: string) =>
  Logger.replaceScoped(
    Logger.defaultLogger,
    Effect.gen(function* () {
      const channel = yield* Effect.acquireRelease(
        Effect.sync(() => vscode.window.createOutputChannel(name)),
        (channel) => Effect.sync(() => channel.dispose())
      )
      return Logger.make((options) => {
        const config = getUnsafeLoggingConfiguration()

        const shouldLog =
          options.logLevel === LogLevel.Debug ? config.isDebugActive : true

        if (!shouldLog) {
          return
        }
        const message = Logger.logfmtLogger.log(options)

        channel.appendLine(message)
      })
    })
  )
