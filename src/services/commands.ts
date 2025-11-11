import { Effect, Layer } from 'effect'
import * as vscode from 'vscode'
import { registerCommand, VSCodeContext } from './VSCode'

export const Commands: Layer.Layer<never, never, VSCodeContext> =
  Layer.scopedDiscard(
    registerCommand('effect-decorate.openSettings', () =>
      Effect.sync(() =>
        vscode.commands.executeCommand(
          'workbench.action.openSettings',
          '@ext:dearhumandev.effect-decorate'
        )
      )
    )
  )
