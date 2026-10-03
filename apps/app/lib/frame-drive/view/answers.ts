import type { CanvasAnswer } from "@/lib/frame-drive/mac/protocol"

/**
 * Where the asker's canvas leaves its answers on hosted (#1391), for the turn
 * waiting on them. The turn and the answer route run in separate functions,
 * so they meet here: the turn says which answer it expects and from whom, the
 * route accepts only that person's answer, and the turn takes it.
 */
export interface FrameDriveAnswers {
  /** Expect an answer to `id` from `viewer`'s canvas in `roomId`. */
  expect(id: string, from: AnswerFrom): Promise<void>
  /**
   * Keep an answer a canvas posted: false when nobody expects it from that
   * person in that Room. The first answer stands.
   */
  accept(answer: CanvasAnswer, from: AnswerFrom): Promise<boolean>
  /** The answer, once a canvas posted it. */
  take(id: string): Promise<CanvasAnswer | null>
  /** Done with `id`: drop what's kept for it. */
  forget(id: string): Promise<void>
}

export type AnswerFrom = { roomId: string; viewer: string }

/** Long enough to outlive any op's wait; the keys clean themselves up. */
const ANSWER_TTL_SEC = 60

/** The minimal KV the answers need (`lib/kv.ts`). */
export interface AnswersKV {
  get<T>(key: string): Promise<T | null>
  set(key: string, value: unknown, options?: { ex?: number }): Promise<unknown>
  del(key: string): Promise<void>
}

const expectKey = (id: string) => `frame-drive:expect:${id}`
const answerKey = (id: string) => `frame-drive:answer:${id}`

/** The answers over a KV, shared by every function of the deployment. */
export function kvFrameDriveAnswers(kv: AnswersKV): FrameDriveAnswers {
  return {
    async expect(id, from) {
      await kv.set(expectKey(id), from, { ex: ANSWER_TTL_SEC })
    },
    async accept(answer, from) {
      if (typeof answer?.id !== "string") return false
      const expected = await kv.get<AnswerFrom>(expectKey(answer.id))
      if (
        !expected ||
        expected.roomId !== from.roomId ||
        expected.viewer !== from.viewer
      )
        return false
      if (await kv.get(answerKey(answer.id))) return true
      await kv.set(answerKey(answer.id), answer, { ex: ANSWER_TTL_SEC })
      return true
    },
    take: (id) => kv.get<CanvasAnswer>(answerKey(id)),
    async forget(id) {
      await Promise.all([kv.del(expectKey(id)), kv.del(answerKey(id))])
    },
  }
}

/** The answers in memory, for tests. */
export function memoryFrameDriveAnswers(): FrameDriveAnswers {
  const store = new Map<string, unknown>()
  return kvFrameDriveAnswers({
    async get<T>(key: string) {
      return (store.get(key) as T | undefined) ?? null
    },
    async set(key, value) {
      store.set(key, value)
    },
    async del(key) {
      store.delete(key)
    },
  })
}
