/** Per-chat request ownership. UI selection is independent of execution.
 * Only the current pending token may publish events or complete a turn.
 * Stop/delete invalidate ownership synchronously, before network cleanup.
 */
type SettledPhase = "idle" | "succeeded" | "failed" | "stopped"

export type ChatRequestPhase = SettledPhase | "pending" | "deleting" | "deleted"

export interface ChatRequestToken {
  readonly chatId: string
  readonly conversationId: string
}

type ChatRequestState =
  | { phase: SettledPhase | "deleted" }
  | { phase: "pending"; token: ChatRequestToken }
  | { phase: "deleting"; beforeDelete: SettledPhase }

export class ChatRequests {
  private readonly states = new Map<string, ChatRequestState>()

  phase(chatId: string): ChatRequestPhase {
    return this.states.get(chatId)?.phase ?? "idle"
  }

  isPending(chatId: string): boolean {
    return this.phase(chatId) === "pending"
  }

  start(chatId: string, conversationId: string): ChatRequestToken | null {
    if (["pending", "deleting", "deleted"].includes(this.phase(chatId)))
      return null
    const token = Object.freeze({ chatId, conversationId })
    this.states.set(chatId, { phase: "pending", token })
    return token
  }

  isCurrent(token: ChatRequestToken): boolean {
    const state = this.states.get(token.chatId)
    return state?.phase === "pending" && state.token === token
  }

  finish(token: ChatRequestToken, outcome: "succeeded" | "failed"): boolean {
    if (!this.isCurrent(token)) return false
    this.states.set(token.chatId, { phase: outcome })
    return true
  }

  stop(chatId: string): ChatRequestToken | null {
    const state = this.states.get(chatId)
    if (state?.phase !== "pending") return null
    this.states.set(chatId, { phase: "stopped" })
    return state.token
  }

  beginDelete(chatId: string): boolean {
    const phase = this.phase(chatId)
    if (phase === "pending" || phase === "deleting" || phase === "deleted")
      return false
    this.states.set(chatId, { phase: "deleting", beforeDelete: phase })
    return true
  }

  finishDelete(chatId: string, succeeded: boolean): void {
    const state = this.states.get(chatId)
    if (state?.phase !== "deleting") return
    this.states.set(chatId, {
      phase: succeeded ? "deleted" : state.beforeDelete,
    })
  }
}
