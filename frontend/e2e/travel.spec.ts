import { randomUUID } from "node:crypto"
import { test, expect, type Page, type Response } from "@playwright/test"

const api = process.env.E2E_API_URL || "http://localhost:8000"
const start = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10)
const end = new Date(Date.now() + 63 * 86400000).toISOString().slice(0, 10)

async function send(page: Page, prompt: string) {
  const response = page.waitForResponse(
    (reply) =>
      reply.url().endsWith("/agent/prompt/stream") &&
      reply.request().method() === "POST",
  )
  await page.getByRole("textbox").fill(prompt)
  await page.getByRole("textbox").press("Enter")
  const result = await response
  expect(result.status()).toBe(200)
  return streamResult(result)
}

async function streamResult(response: Response) {
  const events = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  const done = events.find((event) => event.type === "done")
  expect(done, JSON.stringify(events)).toBeTruthy()
  return done.result
}

test("structured cards survive rewritten narrative and reload", async ({
  page,
}) => {
  await page.route("**/agent/prompt/stream", async (route) => {
    const response = await route.fetch()
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    const hasResult = events.some(
      (event) => event.type === "done" && event.result.travel_result,
    )
    await route.fulfill({
      response,
      body:
        events
          .map((event) =>
            hasResult && event.type === "done"
              ? {
                  ...event,
                  result: {
                    ...event.result,
                    response: "Narrative wording changed after search.",
                  },
                }
              : hasResult && event.type === "text"
                ? { ...event, text: "" }
                : event,
          )
          .map((event) => JSON.stringify(event))
          .join("\n") + "\n",
    })
  })
  await page.goto("/")
  await send(page, "Plan Dallas to New York")
  const result = await send(page, `${start} to ${end}`)
  expect(result.travel_result).toMatchObject({
    version: 1,
    kind: "full_trip",
    total_usd: 540,
  })
  const cards = page.getByRole("region", { name: "Travel results" })
  await expect(
    cards.getByRole("heading", { name: "Fixture Air" }),
  ).toBeVisible()
  await expect(cards.getByText("Fixture Central Hotel")).toBeVisible()
  await expect(
    page.getByText("Narrative wording changed after search."),
  ).toBeVisible()
  await page.reload()
  await page.getByRole("button", { name: "Plan Dallas to New York" }).click()
  await expect(cards.getByText("Fixture Central Hotel")).toBeVisible()
})

test("unknown result versions fall back to the narrative", async ({ page }) => {
  await page.route("**/agent/prompt/stream", async (route) => {
    const response = await route.fetch()
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    await route.fulfill({
      response,
      body:
        events
          .map((event) =>
            event.type === "done" && event.result.travel_result
              ? {
                  ...event,
                  result: {
                    ...event.result,
                    travel_result: {
                      ...event.result.travel_result,
                      version: 2,
                    },
                    response: "A future version result is still readable.",
                  },
                }
              : event,
          )
          .map((event) => JSON.stringify(event))
          .join("\n") + "\n",
    })
  })
  await page.goto("/")
  await send(page, "Plan Dallas to New York")
  await send(page, `${start} to ${end}`)
  await expect(
    page.getByText("A future version result is still readable."),
  ).toBeVisible()
  await expect(
    page.getByRole("region", { name: "Travel results" }),
  ).toHaveCount(0)
})

test("nearby arrival airports compare real fares and ground distance", async ({
  page,
}) => {
  await page.goto("/")
  const initial = await send(
    page,
    `Flights only from Dallas to SBP ${start} to ${end}`,
  )
  expect(initial.travel_result.kind).toBe("flight_only")
  await expect(
    page.getByRole("button", { name: "Compare nearby arrival airports" }),
  ).toBeVisible()

  const compared = await send(
    page,
    "Can you find cheaper flights to nearby airports to SBP?",
  )
  expect(compared.trip_state.destination).toBe("SBP")
  expect(compared.travel_result).toMatchObject({
    kind: "airport_comparison",
    requested_airport: "SBP",
    requested_fare_usd: 529,
  })
  const lax = compared.travel_result.airport_alternatives.find(
    (option: { arrival_airport: string }) => option.arrival_airport === "LAX",
  )
  expect(lax).toMatchObject({ fare_usd: 300, savings_usd: 229 })
  expect(lax.driving_miles).toBeGreaterThan(0)
  const cards = page.getByRole("region", { name: "Travel results" })
  await expect(cards.getByText(/LAX · Los Angeles/)).toBeVisible()
  await expect(cards.getByText(/driving miles/).first()).toBeVisible()
  await expect(cards.getByText(/lower airfare than SBP/).first()).toBeVisible()
  await page.reload()
  await page
    .getByRole("button", { name: /Flights only from Dallas to SBP/ })
    .click()
  await expect(cards.getByText(/LAX · Los Angeles/)).toBeVisible()
})

test("flight explanation and nearby dates remain grounded after reload", async ({
  page,
}) => {
  await page.goto("/")
  const initial = await send(
    page,
    `Flights only from Dallas to New York ${start} to ${end}`,
  )
  expect(initial.travel_result.kind).toBe("flight_only")
  expect(initial.recommendation.version).toBe(3)
  const response = page.waitForResponse((reply) =>
    reply.url().endsWith("/agent/prompt/stream"),
  )
  await page.getByRole("button", { name: "Compare cheaper dates" }).click()
  const compared = await streamResult(await response)
  expect(compared.travel_result.kind).toBe("date_comparison")
  expect(compared.travel_result.base_fare_usd).toBe(240)
  expect(compared.travel_result.date_alternatives).toHaveLength(7)
  expect(compared.trip_state.start_date).toBe(start)
  expect(compared.recommendation).toEqual(initial.recommendation)
  await expect(page.getByText("Nearby travel dates")).toBeVisible()

  const why = await send(page, "Why this flight?")
  expect(why.response).toContain("Option 1")
  expect(why.response).toContain("USD 240.00")
  await page.reload()
  await page
    .getByRole("button", { name: /Flights only from Dallas to New Yor/ })
    .click()
  await expect(page.getByText("Nearby travel dates")).toBeVisible()
})

test("hotel failure keeps flights and retries hotels after reload", async ({
  page,
}) => {
  const marker = randomUUID()
  const prompt = `Plan Dallas to New York with transient hotel ${marker}`
  await page.goto("/")
  await send(page, prompt)
  const partial = await send(page, `${start} to ${end}`)
  expect(partial.travel_result.kind).toBe("flight_only")
  expect(partial.retry_hotels).toBe(true)
  expect(partial.partial_search.flights).toHaveLength(1)
  await expect(page.getByRole("button", { name: "Retry hotels" })).toBeVisible()
  await page.reload()
  await page
    .getByRole("button", { name: /Plan Dallas to New York with transi/ })
    .click()
  const response = page.waitForResponse((reply) =>
    reply.url().endsWith("/agent/prompt/stream"),
  )
  await page.getByRole("button", { name: "Retry hotels" }).click()
  const completed = await streamResult(await response)
  expect(completed.travel_result.kind).toBe("full_trip")
  expect(completed.travel_result.total_usd).toBe(540)
  expect(completed.partial_search).toBeNull()
  await expect(page.getByRole("button", { name: "Retry hotels" })).toHaveCount(
    0,
  )
})

test("Stop ignores late hotel results", async ({ page }) => {
  const marker = randomUUID()
  await page.goto("/")
  await send(page, `Plan Dallas to New York with slow hotel ${marker}`)
  await page.getByRole("textbox").fill(`${start} to ${end}`)
  await page.getByRole("textbox").press("Enter")
  await expect(page.getByRole("status")).toContainText("Searching hotels")
  await expect(
    page.getByRole("region", { name: "Travel results" }).getByRole("heading", {
      name: "Fixture Air",
    }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Stop", exact: true }).click()
  await expect(
    page.getByText("Search stopped. Late results will be ignored."),
  ).toBeVisible()
  await page.waitForTimeout(3500)
  await expect(page.getByText("Fixture Central Hotel")).toHaveCount(0)
})

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
    page.getByText(/don't have a saved flight or full-trip recommendation/),
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
    reply.url().endsWith("/agent/prompt/stream"),
  )
  await page.getByRole("textbox").fill("Plan Tokyo.")
  await page.getByRole("textbox").press("Enter")
  await page
    .getByRole("button", { name: "Plan New York.", exact: true })
    .click()
  const tokyo = await streamResult(await response)
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
