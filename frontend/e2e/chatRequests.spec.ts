import { test, expect } from "@playwright/test"
import { ChatRequests } from "../src/stores/chatRequests"

test("late completion after stop cannot release a newer request", () => {
  const requests = new ChatRequests()
  const old = requests.start("chat", "conversation")!
  expect(requests.stop("chat")).toBe(old)
  const next = requests.start("chat", "conversation")!
  expect(requests.finish(old, "failed")).toBe(false)
  expect(requests.isPending("chat")).toBe(true)
  expect(requests.start("chat", "conversation")).toBeNull()
  expect(requests.isCurrent(next)).toBe(true)
  expect(requests.finish(next, "succeeded")).toBe(true)
  expect(requests.isCurrent(next)).toBe(false)
})

test("independent chats retain ownership when the visible chat changes", () => {
  const requests = new ChatRequests()
  const first = requests.start("first", "one")!
  const second = requests.start("second", "two")!
  expect(requests.finish(first, "succeeded")).toBe(true)
  expect(requests.isCurrent(second)).toBe(true)
  expect(requests.stop("second")).toBe(second)
  expect(requests.isCurrent(second)).toBe(false)
})

test("failed deletion preserves a stopped chat and permits retry", () => {
  const requests = new ChatRequests()
  const token = requests.start("chat", "conversation")!
  expect(requests.beginDelete("chat")).toBe(false)
  requests.stop("chat")
  expect(requests.beginDelete("chat")).toBe(true)
  expect(requests.start("chat", "conversation")).toBeNull()
  expect(requests.beginDelete("chat")).toBe(false)
  expect(requests.finish(token, "succeeded")).toBe(false)
  requests.finishDelete("chat", false)
  expect(requests.phase("chat")).toBe("stopped")
  expect(requests.start("chat", "conversation")).not.toBeNull()
})

test("successful deletion is terminal and cannot be undone by stale callbacks", () => {
  const requests = new ChatRequests()
  const token = requests.start("chat", "conversation")!
  requests.stop("chat")
  requests.beginDelete("chat")
  requests.finishDelete("chat", true)
  requests.finishDelete("chat", false)
  expect(requests.finish(token, "succeeded")).toBe(false)
  expect(requests.start("chat", "conversation")).toBeNull()
  expect(requests.beginDelete("chat")).toBe(false)
  expect(requests.phase("chat")).toBe("deleted")
})

for (const outcome of ["succeeded", "failed"] as const) {
  test(`${outcome} requests complete once and allow a subsequent turn`, () => {
    const requests = new ChatRequests()
    expect(requests.phase("chat")).toBe("idle")
    const token = requests.start("chat", "conversation")!
    expect(requests.finish(token, outcome)).toBe(true)
    expect(requests.finish(token, outcome)).toBe(false)
    expect(requests.stop("chat")).toBeNull()
    requests.beginDelete("chat")
    requests.finishDelete("chat", false)
    expect(requests.phase("chat")).toBe(outcome)
    expect(requests.start("chat", "conversation")).not.toBeNull()
  })
}
