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

test("explains a retained trip after reload and does not leak it to a new chat", async ({
  page,
}) => {
  await page.goto("/")
  const prompt = "Plan Dallas to New York"
  await send(page, prompt)
  const found = await send(page, `${start} to ${end}`)
  expect(found.recommendation.version).toBe(2)
  await page.reload()
  await page.getByRole("button", { name: prompt, exact: true }).click()
  const explained = await send(page, "Why this one?")
  expect(explained.recommendation).toEqual(found.recommendation)
  await expect(page.getByText("Why this trip?", { exact: true })).toBeVisible()
  await expect(
    page.getByText(/prices and availability have not been refreshed/),
  ).toBeVisible()
  await expect(
    page.getByText(/USD 240.00 flight fare \+ USD 300.00 full hotel stay/),
  ).toBeVisible()
  await page.getByRole("button", { name: "New chat", exact: true }).click()
  const empty = await send(page, "Why this trip?")
  expect(empty.recommendation).toBeNull()
  await expect(
    page.getByText(/don't have a saved full-trip recommendation/),
  ).toBeVisible()
})

test("keeps the selected flight while changing only the hotel after reload", async ({
  page,
}) => {
  await page.goto("/")
  await send(page, "Plan Dallas to New York")
  const first = await send(page, `${start} to ${end}`)
  expect(first.recommendation.hotel.name).toBe("Fixture Central Hotel")
  const flightId = first.recommendation.flight.id
  await page.reload()
  await page.getByRole("button", { name: "Plan Dallas to New York" }).click()
  const swapped = await send(page, "Keep the flights, change the hotel")
  expect(swapped.recommendation.flight.id).toBe(flightId)
  expect(swapped.recommendation.hotel.name).toBe("Fixture Riverside Hotel")
  expect(swapped.recommendation.hotel.id).not.toBe(
    first.recommendation.hotel.id,
  )
  await expect(
    page.getByText(/I kept your selected flight and found a different hotel/),
  ).toBeVisible()
  await expect(page.getByText(/Activities were not refreshed/)).toBeVisible()
  const explained = await send(page, "Why this one?")
  expect(explained.recommendation.hotel.id).toBe(
    swapped.recommendation.hotel.id,
  )
})

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

test("budget survives corrections and reload, can be revised and removed", async ({
  page,
}) => {
  await page.goto("/")
  await send(page, "Plan New York. Budget USD 500")
  await send(page, "Dallas.")
  const over = await send(page, `${start} to ${end}`)
  expect(over.budget_assessment).toMatchObject({
    status: "over",
    limit: 500,
    quoted_total: 540,
  })
  await expect(
    page.getByRole("region", { name: "Budget assessment" }).last(),
  ).toContainText("USD 40.00 over")
  await page.reload()
  await page
    .getByRole("button", { name: "Plan New York. Budget USD 500", exact: true })
    .click()
  await expect(
    page.getByRole("region", { name: "Budget assessment" }).last(),
  ).toContainText("USD 40.00 over")
  const changed = await send(page, "Actually Boston. Budget USD 600")
  expect(changed.trip_state).toMatchObject({
    origin: "DFW",
    destination: "BOS",
    budget_amount: 600,
  })
  expect(changed.budget_assessment.status).toBe("within")
  await expect(
    page.getByRole("region", { name: "Budget assessment" }).last(),
  ).toContainText("USD 60.00 remaining")
  await expect(page.getByText(/Fixture Central Hotel/).last()).toBeVisible()
  const foreign = await send(page, "Budget EUR 600")
  expect(foreign.budget_assessment).toBeNull()
  await expect(page.getByText(/cannot convert your EUR budget/)).toBeVisible()
  const cleared = await send(page, "Remove budget")
  expect(cleared.trip_state.budget_amount).toBeNull()
  expect(cleared.budget_assessment).toBeNull()
  await page.getByRole("button", { name: "New chat", exact: true }).click()
  const separate = await send(page, "Plan Tokyo.")
  expect(separate.trip_state.budget_amount).toBeNull()
})

test("family counts survive clarification and reload and change quoted totals", async ({
  page,
}) => {
  await page.goto("/")
  const first = await send(
    page,
    `Plan New York from Dallas ${start} to ${end}. 2 adults 1 child 2 rooms. Budget USD 1100`,
  )
  expect(first.response).toMatch(/ages/)
  expect(first.trip_state).toMatchObject({ adults: 2, children: 1, rooms: 2 })
  const ages = await send(page, "Age 7")
  expect(ages.response).toMatch(/supports one room only/)
  expect(ages.trip_state.children_ages).toEqual([7])
  expect(ages.budget_assessment).toBeNull()
  const family = await send(page, "1 room")
  expect(family.budget_assessment).toMatchObject({
    status: "within",
    quoted_total: 1080,
  })
  await expect(
    page.getByText(/Travelers: 2 adults, 1 child/).last(),
  ).toBeVisible()
  await page.reload()
  await page.getByRole("button", { name: /Plan New York from Dallas/ }).click()
  const correction = await send(page, "Actually Boston")
  expect(correction.trip_state).toMatchObject({
    destination: "BOS",
    adults: 2,
    children: 1,
    children_ages: [7],
    rooms: 1,
  })
  expect(correction.budget_assessment.quoted_total).toBe(1080)
  const solo = await send(page, "Just me")
  expect(solo.trip_state).toMatchObject({
    adults: 1,
    children: 0,
    children_ages: [],
  })
  expect(solo.budget_assessment.quoted_total).toBe(540)
  await page.getByRole("button", { name: "New chat", exact: true }).click()
  const separate = await send(page, "Plan Tokyo")
  expect(separate.trip_state).toMatchObject({
    adults: 1,
    children: 0,
    children_ages: [],
    rooms: 1,
  })
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
