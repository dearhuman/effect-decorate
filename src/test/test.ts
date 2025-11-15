import { Effect, Ref } from 'effect'

declare const someProgram: Effect.Effect<void>

declare const thisIsAFunction: () => void

declare const thisIsAnEffect: Effect.Effect<void>

declare const someValue: number

declare const someYieldedValue: Effect.Effect<number>

const program: Effect.Effect<void> = Effect.gen(function* () {
  thisIsAFunction()

  yield* thisIsAnEffect

  const foo = someValue

  const bar = yield* someYieldedValue

  const someRef = yield* Ref.make('someRef')

  const notYieldedRef = Ref.make('someRef')
})
