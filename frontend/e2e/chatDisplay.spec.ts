import { randomUUID } from "node:crypto"
import { test, expect } from "@playwright/test"
import {
  chatDisplayReducer as reduce,
  restoreChatDisplay,
  type ChatHistoryItem,
} from "../src/stores/chatDisplay"
import type { ChatRequestToken } from "../src/stores/chatRequests"

function entry(id = "first"): ChatHistoryItem {
  return {
    id,
    conversationId: randomUUID(),
    title: id,
    timestamp: new Date(),
    messages: [{ role: "user", content: "Find flights" }],
    pendingRequest: { id: randomUUID(), prompt: "Find flights" },
  }
}
const tokenFor = (chat: ChatHistoryItem): ChatRequestToken => ({
  chatId: chat.id,
  conversationId: chat.conversationId!,
})

test("background progress and text remain independent and do not rewrite history", () => {
  const first = entry(),
    second = entry("second")
  const one = tokenFor(first),
    two = tokenFor(second)
  let state = reduce(restoreChatDisplay([]), {
    type: "start",
    token: one,
    entry: first,
  })
  state = reduce(state, { type: "start", token: two, entry: second })
  const history = state.history
  state = reduce(state, {
    type: "status",
    token: one,
    message: "Searching hotels",
  })
  state = reduce(state, { type: "text", token: one, text: "First " })
  state = reduce(state, { type: "text", token: one, text: "answer" })
  expect(state.history).toBe(history)
  expect(state.views.get(first.id)).toMatchObject({
    phase: "pending",
    status: "Searching hotels",
    text: "First answer",
  })
  expect(state.views.get(second.id)).toMatchObject({
    phase: "pending",
    text: "",
    status: "Starting search",
  })
  state = reduce(state, {
    type: "finish",
    token: one,
    outcome: "succeeded",
    message: { role: "assistant", content: "Done" },
  })
  expect(state.views.get(first.id)).toEqual({ phase: "succeeded" })
  expect(
    state.history.find((chat) => chat.id === first.id)?.pendingRequest,
  ).toBeUndefined()
  expect(state.views.get(second.id)?.phase).toBe("pending")
})

test("stop and replacement reject stale progress, animation, and completion", () => {
  const chat = entry(),
    old = tokenFor(chat),
    next = tokenFor(chat)
  let state = reduce(restoreChatDisplay([]), {
    type: "start",
    token: old,
    entry: chat,
  })
  state = reduce(state, { type: "stop", token: old })
  expect(state.history[0].outcome).toBe("stopped")
  state = reduce(state, { type: "start", token: next, entry: chat })
  expect(reduce(state, { type: "text", token: old, text: "late" })).toBe(state)
  expect(reduce(state, { type: "animated", token: old })).toBe(state)
  expect(
    reduce(state, {
      type: "finish",
      token: old,
      outcome: "failed",
      message: { role: "assistant", content: "late" },
    }),
  ).toBe(state)
})

test("reload restores interrupted turns with request identity, never transient loading", () => {
  const chat = entry(),
    token = tokenFor(chat)
  const state = reduce(restoreChatDisplay([]), {
    type: "start",
    token,
    entry: chat,
  })
  const restored = restoreChatDisplay(JSON.parse(JSON.stringify(state.history)))
  expect(restored.views.get(chat.id)).toEqual({ phase: "interrupted" })
  expect(restored.history[0].pendingRequest).toEqual(chat.pendingRequest)
  const retried = reduce(restored, {
    type: "start",
    token: tokenFor(chat),
    entry: restored.history[0],
  })
  expect(retried.history[0].messages).toHaveLength(1)
})

test("legacy history and malformed entries recover without inventing pending requests", () => {
  const chat = entry()
  const saved = JSON.parse(JSON.stringify(chat))
  delete saved.pendingRequest
  const restored = restoreChatDisplay([
    null,
    {},
    { ...saved, messages: [null] },
    saved,
    saved,
  ])
  expect(restored.history).toHaveLength(1)
  expect(restored.views.get(chat.id)?.phase).toBe("interrupted")
  expect(restored.history[0].pendingRequest).toBeUndefined()
  const invalid = restoreChatDisplay([
    { ...saved, pendingRequest: { id: randomUUID(), prompt: "different" } },
  ])
  expect(invalid.history[0].pendingRequest).toBeUndefined()
})

test("finished and stopped turns stay terminal after reload", () => {
  for (const outcome of ["succeeded", "failed", "stopped"] as const) {
    const chat = entry()
    chat.outcome = outcome
    chat.pendingRequest = undefined
    chat.messages.push({ role: "assistant", content: "Finished" })
    expect(
      restoreChatDisplay(JSON.parse(JSON.stringify([chat]))).views.get(chat.id)
        ?.phase,
    ).toBe(outcome)
  }
})

test("failed deletion restores recovery view and deleted history ignores late events", () => {
  const chat = entry(),
    token = tokenFor(chat)
  let state = restoreChatDisplay(JSON.parse(JSON.stringify([chat])))
  state = reduce(state, { type: "delete-start", chatId: chat.id })
  expect(reduce(state, { type: "start", token, entry: chat })).toBe(state)
  state = reduce(state, { type: "delete-failed", chatId: chat.id })
  expect(state.views.get(chat.id)?.phase).toBe("interrupted")
  state = reduce(state, { type: "delete-start", chatId: chat.id })
  state = reduce(state, { type: "delete-done", chatId: chat.id })
  expect(state.history).toHaveLength(0)
  expect(reduce(state, { type: "text", token, text: "late" })).toBe(state)
})

test("repeated recoverable failures retain request identity across reload and clear it on success", () => {
  const chat = entry()
  let state = restoreChatDisplay(JSON.parse(JSON.stringify([chat])))
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = tokenFor(chat)
    state = reduce(state, { type: "start", token, entry: state.history[0] })
    state = reduce(state, {
      type: "interrupt",
      token,
      message: "Connection interrupted",
    })
    state = restoreChatDisplay(JSON.parse(JSON.stringify(state.history)))
    expect(state.views.get(chat.id)?.phase).toBe("interrupted")
    expect(state.history[0].pendingRequest).toEqual(chat.pendingRequest)
    expect(state.history[0].messages).toHaveLength(1)
    expect(state.history[0].recoveryError).toBe("Connection interrupted")
  }
  const token = tokenFor(chat)
  state = reduce(state, { type: "start", token, entry: state.history[0] })
  state = reduce(state, {
    type: "finish",
    token,
    outcome: "succeeded",
    message: { role: "assistant", content: "Saved answer" },
  })
  expect(state.history[0].pendingRequest).toBeUndefined()
  expect(state.history[0].recoveryError).toBeUndefined()
  expect(state.history[0].messages).toHaveLength(2)
})
