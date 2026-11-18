import type { BudgetAssessment } from "../types/budget"
import type { TravelResult } from "../types/travelResult"
import type { TripContext } from "../types/tripContext"
import type {
  OutboundPreviewFlight,
  VerifiedFlightPreview,
} from "../utils/travelStream"
import type { ChatRequestToken } from "./chatRequests"

export interface ConversationMessage {
  role: "user" | "assistant"
  content: string
  budget_assessment?: BudgetAssessment | null
  travel_result?: TravelResult | null
  trip_state?: TripContext | null
  retry_hotels?: boolean
}

export interface ChatHistoryItem {
  id: string
  conversationId?: string
  title: string
  timestamp: Date
  messages: ConversationMessage[]
  pendingRequest?: { id: string; prompt: string }
  recoveryError?: string
  outcome?: "succeeded" | "failed" | "stopped"
}

type SettledView = {
  phase: "idle" | "succeeded" | "failed" | "stopped" | "interrupted"
}
export type ChatView =
  | SettledView
  | {
      phase: "pending"
      token: ChatRequestToken
      status: string
      partial: TravelResult | null
      outboundPreview?: OutboundPreviewFlight[] | null
      verifiedFlightPreview?: VerifiedFlightPreview | null
      text: string
      animate: boolean
    }
  | { phase: "deleting"; previous: SettledView }

export interface ChatDisplay {
  history: ChatHistoryItem[]
  views: ReadonlyMap<string, ChatView>
}

export const idleView: ChatView = { phase: "idle" }

export type ChatDisplayEvent =
  | { type: "start"; token: ChatRequestToken; entry: ChatHistoryItem }
  | { type: "status" | "error"; token: ChatRequestToken; message: string }
  | {
      type: "outbound_preview"
      token: ChatRequestToken
      flights: OutboundPreviewFlight[]
    }
  | {
      type: "verified_flight_preview"
      token: ChatRequestToken
      flight: VerifiedFlightPreview
    }
  | { type: "partial"; token: ChatRequestToken; result: TravelResult | null }
  | { type: "text"; token: ChatRequestToken; text: string }
  | { type: "animated"; token: ChatRequestToken }
  | {
      type: "finish"
      token: ChatRequestToken
      message: ConversationMessage
      outcome: "succeeded" | "failed"
    }
  | { type: "stop"; token: ChatRequestToken }
  | { type: "interrupt"; token: ChatRequestToken; message: string }
  | { type: "delete-start"; chatId: string }
  | { type: "delete-failed"; chatId: string }
  | { type: "delete-done"; chatId: string }

/** Selection never mutates a chat's view. Async events must own its pending token. */
export function chatDisplayReducer(
  state: ChatDisplay,
  event: ChatDisplayEvent,
): ChatDisplay {
  const chatId = "token" in event ? event.token.chatId : event.chatId
  const view = state.views.get(chatId) ?? idleView
  const views = new Map(state.views)
  let history = state.history
  if (event.type === "start") {
    if (view.phase === "pending" || view.phase === "deleting") return state
    views.set(chatId, {
      phase: "pending",
      token: event.token,
      status: "Starting search",
      partial: null,
      text: "",
      animate: true,
    })
    history = [event.entry, ...history.filter((chat) => chat.id !== chatId)]
  } else if (event.type === "delete-start") {
    if (view.phase === "pending" || view.phase === "deleting") return state
    views.set(chatId, { phase: "deleting", previous: view })
  } else if (event.type === "delete-failed") {
    if (view.phase !== "deleting") return state
    views.set(chatId, view.previous)
  } else if (event.type === "delete-done") {
    if (view.phase !== "deleting") return state
    views.delete(chatId)
    history = history.filter((chat) => chat.id !== chatId)
  } else {
    if (view.phase !== "pending" || view.token !== event.token) return state
    switch (event.type) {
      case "status":
        views.set(chatId, { ...view, status: event.message })
        break
      case "error":
        views.set(chatId, {
          ...view,
          status: event.message,
          outboundPreview: null,
          verifiedFlightPreview: null,
        })
        break
      case "partial":
        views.set(chatId, {
          ...view,
          partial: event.result,
          outboundPreview: null,
          verifiedFlightPreview: null,
        })
        break
      case "outbound_preview":
        // Undefined means a snapshot can still arrive. Null closes the preview.
        if (view.outboundPreview !== undefined) return state
        views.set(chatId, { ...view, outboundPreview: event.flights })
        break
      case "verified_flight_preview":
        if (view.verifiedFlightPreview !== undefined) return state
        views.set(chatId, {
          ...view,
          outboundPreview: null,
          verifiedFlightPreview: event.flight,
        })
        break
      case "text":
        views.set(chatId, { ...view, text: view.text + event.text })
        break
      case "animated":
        views.set(chatId, { ...view, animate: false })
        break
      case "interrupt":
        views.set(chatId, { phase: "interrupted" })
        history = history.map((chat) =>
          chat.id === chatId ? { ...chat, recoveryError: event.message } : chat,
        )
        break
      case "stop":
      case "finish": {
        const outcome = event.type === "stop" ? "stopped" : event.outcome
        const message: ConversationMessage =
          event.type === "stop"
            ? {
                role: "assistant",
                content: "Search stopped.",
              }
            : event.message
        views.set(chatId, { phase: outcome })
        history = history.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: [...chat.messages, message],
                pendingRequest: undefined,
                recoveryError: undefined,
                outcome,
              }
            : chat,
        )
        break
      }
    }
  }
  return { history, views }
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Legacy history is supported. An unanswered user turn is interrupted, never loading.
 * Only durable history/request identity is restored, not transient cards or text.
 */
export function restoreChatDisplay(saved: unknown): ChatDisplay {
  const history: ChatHistoryItem[] = []
  const views = new Map<string, ChatView>()
  if (!Array.isArray(saved)) return { history, views }
  for (const chat of saved) {
    if (
      !object(chat) ||
      typeof chat.id !== "string" ||
      !chat.id ||
      views.has(chat.id) ||
      typeof chat.title !== "string" ||
      !Array.isArray(chat.messages) ||
      !chat.messages.every(
        (message) =>
          object(message) &&
          (message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string",
      )
    )
      continue
    const messages = chat.messages as ConversationMessage[]
    const last = messages.at(-1)
    const pending = chat.pendingRequest
    const pendingRequest =
      object(pending) &&
      typeof pending.id === "string" &&
      /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(pending.id) &&
      last?.role === "user" &&
      pending.prompt === last.content
        ? { id: pending.id, prompt: last.content }
        : undefined
    const outcome =
      chat.outcome === "failed" ||
      chat.outcome === "stopped" ||
      chat.outcome === "succeeded"
        ? chat.outcome
        : undefined
    const timestamp = new Date(
      typeof chat.timestamp === "string" ? chat.timestamp : 0,
    )
    history.push({
      id: chat.id,
      title: chat.title,
      messages,
      pendingRequest,
      recoveryError:
        last?.role === "user" && typeof chat.recoveryError === "string"
          ? chat.recoveryError
          : undefined,
      outcome,
      conversationId:
        typeof chat.conversationId === "string"
          ? chat.conversationId
          : undefined,
      timestamp: Number.isNaN(timestamp.getTime()) ? new Date(0) : timestamp,
    })
    views.set(chat.id, {
      phase:
        last?.role === "user"
          ? "interrupted"
          : (outcome ?? (last ? "succeeded" : "idle")),
    })
  }
  return { history, views }
}
