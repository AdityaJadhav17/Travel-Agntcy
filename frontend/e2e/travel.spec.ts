import { randomUUID } from "node:crypto"
import { test, expect, type Page } from "@playwright/test"

const api = process.env.E2E_API_URL || "http://localhost:8000"
const start = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10)
const end = new Date(Date.now() + 63 * 86400000).toISOString().slice(0, 10)

async function send(page: Page, prompt: string) {
  const response = page.waitForResponse(
    (reply) =>
      reply.url().endsWith("/agent/prompt") &&
      reply.request().method() === "POST",
  )
  await page.getByRole("textbox").fill(prompt)
  await page.getByRole("textbox").press("Enter")
  const result = await response
  expect(result.status()).toBe(200)
  return result.json()
}

test("clarifies, searches real agents, reloads and corrects the destination", async ({
  page,
}) => {
  await page.goto("/")
  const first = await send(page, "Plan a trip to New York.")
  await expect(page.getByText(/Where will you be flying from/)).toBeVisible()
  await send(page, "Dallas.")
  await expect(
    page.getByText(/What date would you like to leave/),
  ).toBeVisible()
  const result = await send(page, `${start} to ${end}`)
  expect(result.trip_state).toMatchObject({
    origin: "DFW",
    destination: "JFK",
    start_date: start,
    end_date: end,
  })
  await expect(page.getByText(/Fixture Central Hotel/).first()).toBeVisible()
  await expect(page.getByText(/Fixture City Museum/).first()).toBeVisible()
  await page.reload()
  await page
    .getByRole("button", { name: "Plan a trip to New York.", exact: true })
    .click()
  const corrected = await send(page, "Actually Boston.")
  expect(corrected.conversation_id).toBe(first.conversation_id)
  expect(corrected.trip_state).toMatchObject({
    origin: "DFW",
    destination: "BOS",
    start_date: start,
    end_date: end,
  })
  await expect(page.getByText(/Fixture Central Hotel/).last()).toBeVisible()
})

test("a late answer stays with its chat and new chats start without trip context", async ({
  page,
}) => {
  await page.goto("/")
  await send(page, "Plan New York.")
  await send(page, "Dallas.")
  await page.getByRole("button", { name: "New chat", exact: true }).click()
  const response = page.waitForResponse((reply) =>
    reply.url().endsWith("/agent/prompt"),
  )
  await page.getByRole("textbox").fill("Plan Tokyo.")
  await page.getByRole("textbox").press("Enter")
  await page
    .getByRole("button", { name: "Plan New York.", exact: true })
    .click()
  const tokyo = await (await response).json()
  expect(tokyo.trip_state.destination).toBe("NRT")
  expect(tokyo.trip_state.origin).toBeFalsy()
  await expect(
    page.getByText(/What date would you like to leave/),
  ).toBeVisible()
  await page.getByRole("button", { name: "Plan Tokyo.", exact: true }).click()
  await expect(page.getByText(/Where will you be flying from/)).toBeVisible()
  await expect(page.getByText(/What date would you like to leave/)).toHaveCount(
    0,
  )
})

test("deleting a chat clears the browser and permanently deletes its server memory", async ({
  page,
  request,
}) => {
  await page.goto("/")
  const result = await send(page, "Plan Tokyo.")
  await page
    .getByRole("button", { name: "Delete chat: Plan Tokyo.", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "Plan Tokyo.", exact: true }),
  ).toHaveCount(0)
  await page.reload()
  await expect(page.getByText("No conversation history")).toBeVisible()
  const retry = await request.post(`${api}/agent/prompt`, {
    data: {
      prompt: "Dallas",
      conversation_id: result.conversation_id,
      request_id: randomUUID(),
    },
  })
  expect(retry.status()).toBe(409)
})

test("invalid requests are rejected and completed retries return the same turn", async ({
  request,
}) => {
  expect(
    (
      await request.post(`${api}/agent/prompt`, { data: { prompt: " " } })
    ).status(),
  ).toBe(422)
  expect(
    (
      await request.post(`${api}/agent/prompt`, {
        data: { prompt: "Hello", conversation_id: "invalid" },
      })
    ).status(),
  ).toBe(422)
  const data = {
    prompt: "Plan New York",
    conversation_id: randomUUID(),
    request_id: randomUUID(),
  }
  try {
    const [first, overlappingRetry] = await Promise.all([
      request.post(`${api}/agent/prompt`, { data }),
      request.post(`${api}/agent/prompt`, { data }),
    ])
    expect(first.status()).toBe(200)
    expect(overlappingRetry.status()).toBe(200)
    expect(await overlappingRetry.json()).toEqual(await first.json())
    const retry = await request.post(`${api}/agent/prompt`, { data })
    expect(retry.status()).toBe(200)
    expect(await retry.json()).toEqual(await first.json())
    expect(
      (
        await request.post(`${api}/agent/prompt`, {
          data: { ...data, prompt: "Different" },
        })
      ).status(),
    ).toBe(409)
  } finally {
    await request.delete(`${api}/conversations/${data.conversation_id}`)
  }
})

test("past dates and unavailable providers give actionable replies", async ({
  page,
}) => {
  await page.goto("/")
  const invalid = await send(
    page,
    "Hotels only in New York from 2020-01-01 to 2020-01-04",
  )
  expect(invalid.response).toMatch(/past/i)
  const failure = await send(
    page,
    `Hotels only failure from ${start} to ${end}`,
  )
  expect(failure.response).toMatch(
    /unavailable|failed|error|couldn't|could not/i,
  )
  await expect(page.getByRole("textbox")).toBeEnabled()
})
