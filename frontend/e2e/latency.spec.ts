import { test, expect, type Page } from "@playwright/test"

const timingHeader = "X-Travel-Timing-Id"
const prompt = "Find a flight to Boston"

const flightResult = {
  version: 1,
  kind: "flight_only",
  searched_at: "2026-11-13T12:00:00Z",
  origin: "SFO",
  destination: "BOS",
  start_date: "2026-12-10",
  end_date: "2026-12-12",
  adults: 1,
  children: 0,
  rooms: 1,
  is_one_way: false,
  flights: [
    {
      id: "timing-fixture-flight",
      airline: "Timing Fixture Air",
      total_usd: 240,
      departure_time: "09:00",
      arrival_time: "17:00",
      stops: 0,
      return_flight: {
        airline: "Timing Fixture Air",
        departure_time: "10:00",
        arrival_time: "15:00",
        stops: 0,
      },
    },
  ],
  hotels: [],
  activities: [],
  total_usd: 240,
  notice: "",
}

const previewEvent = {
  type: "outbound_preview",
  flights: [
    {
      airline: "Provisional Fixture Air",
      departure_time: "08:00",
      arrival_time: "16:00",
      stops: 1,
      total_usd: 123,
      departure_token: "hidden-fixture-token",
    },
  ],
}

/** Provide a controllable streaming response so the card and terminal event
 * can be observed as separate browser milestones without external providers.
 */
async function controlledTimingStream(page: Page, holdInitialStatus = false) {
  await page.addInitScript(
    ({ header, holdInitialStatus }) => {
      const originalFetch = window.fetch.bind(window)
      window.fetch = async (input, init) => {
        if (String(input).endsWith("/auth/status"))
          return Response.json({ authenticated: true })
        if (!String(input).endsWith("/agent/prompt/stream"))
          return originalFetch(input, init)
        const requestPrompt = JSON.parse(String(init?.body)).prompt
        const encoder = new TextEncoder()
        let listener: ((event: Event) => void) | undefined
        let abort: (() => void) | undefined
        const cleanup = () => {
          if (listener)
            document.removeEventListener("travel-latency-fixture", listener)
          if (abort) init?.signal?.removeEventListener("abort", abort)
        }
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            listener = (raw) => {
              const event = (raw as CustomEvent).detail
              if (event.prompt && event.prompt !== requestPrompt) return
              if (event.close) {
                cleanup()
                controller.close()
              } else {
                controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"))
              }
            }
            abort = () => {
              cleanup()
              controller.error(new DOMException("Aborted", "AbortError"))
            }
            document.addEventListener("travel-latency-fixture", listener)
            init?.signal?.addEventListener("abort", abort)
            if (!holdInitialStatus)
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    type: "status",
                    component: "request",
                    message: "Searching fixture",
                  }) + "\n",
                ),
              )
          },
          cancel() {
            cleanup()
          },
        })
        return new Response(body, {
          headers: {
            "Content-Type": "application/x-ndjson",
            [header]: "fixture-timing-id",
          },
        })
      }
    },
    { header: timingHeader, holdInitialStatus },
  )
}

async function emit(
  page: Page,
  event: Record<string, unknown>,
  eventPrompt?: string,
) {
  await page.evaluate(
    (detail) => {
      document.dispatchEvent(
        new CustomEvent("travel-latency-fixture", { detail }),
      )
    },
    { ...event, ...(eventPrompt ? { prompt: eventPrompt } : {}) },
  )
}

async function measurements(page: Page) {
  return page.evaluate(() => {
    const api = (
      window as typeof window & {
        __travelLatency?: {
          getMeasurements(): Array<Record<string, unknown>>
        }
      }
    ).__travelLatency
    return api?.getMeasurements() ?? null
  })
}

async function latencySummary(page: Page) {
  return page.evaluate(() => {
    const api = (
      window as typeof window & {
        __travelLatency?: {
          summary(): Record<string, { count: number; medianMs: number | null }>
        }
      }
    ).__travelLatency
    return api?.summary() ?? null
  })
}

async function waitForMeasurement(
  page: Page,
  predicate: (entry: Record<string, unknown> | undefined) => boolean,
) {
  await expect
    .poll(async () => {
      const entries = await measurements(page)
      return predicate(entries?.[0])
    })
    .toBe(true)
}

async function submit(page: Page, text = prompt) {
  await page.getByRole("textbox").fill(text)
  await page.getByRole("textbox").press("Enter")
  await expect(page.getByRole("status")).toHaveText("Searching fixture")
}

test("theme switch recolors the actual trip and the compact editor stays usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await controlledTimingStream(page)
  await page.goto("/")
  await submit(page)
  await emit(page, {
    type: "done",
    result: { response: "Flight options", travel_result: flightResult },
  })
  const results = page.getByRole("region", { name: "Travel results" })
  const card = results.getByRole("article").first()
  const app = page.locator(".travel-ui").first()
  await expect(app).toHaveCSS("background-color", "rgb(23, 23, 23)")
  await expect(card).toHaveCSS("background-color", "rgb(32, 32, 32)")
  await page.getByRole("button", { name: "Switch to light mode" }).click()
  await expect(app).toHaveCSS("background-color", "rgb(247, 245, 239)")
  await expect(card).toHaveCSS("background-color", "rgb(255, 255, 255)")
  const summary = page.getByRole("region", { name: "Trip details" })
  await expect(
    summary.getByRole("button", { name: "Change dates" }),
  ).toBeHidden()
  await summary.getByRole("button", { name: "Edit trip" }).press("Enter")
  await summary.getByRole("button", { name: "Change dates" }).click()
  await expect(summary.getByLabel("Departure")).toHaveCSS(
    "color-scheme",
    "light",
  )
  await page.reload()
  await expect(
    page.getByRole("button", { name: "Switch to dark mode" }),
  ).toBeVisible()
})

test("flight cards expose the fare tradeoff and both travel days on a narrow screen", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await controlledTimingStream(page)
  await page.goto("/")
  await submit(page)
  const returnFlight = {
    airline: "Return Fixture Air",
    departure_time: "2026-12-12T22:30:00",
    arrival_time: "2026-12-13 01:10:00",
    stops: 0,
    duration_minutes: 160,
  }
  const options = [
    {
      ...flightResult.flights[0],
      id: "lowest",
      airline: "Connection Air",
      price_scope: "requested_party",
      total_usd: 240,
      stops: 1,
      duration_minutes: 345,
      connections: [{ airport: "DEN", duration_minutes: 65 }],
      return_flight: returnFlight,
    },
    {
      ...flightResult.flights[0],
      id: "nonstop",
      airline: "Nonstop Air",
      total_usd: 275,
      departure_time: "07:00",
      return_flight: returnFlight,
    },
    {
      ...flightResult.flights[0],
      id: "incomplete",
      airline: "Incomplete Air",
      total_usd: 99,
      departure_time: "2026-12-10T22:00:00Z",
      return_flight: null,
    },
  ]
  await emit(page, {
    type: "done",
    result: {
      response: "Three flight options.",
      travel_result: {
        ...flightResult,
        flights: options,
        origin_city: "San Francisco",
        destination_city: "Boston",
        origin_airport: "SFO",
        destination_airport: "BOS",
        adults: 3,
        departure_period_legs: ["return"],
      },
    },
  })
  const results = page.getByRole("region", { name: "Travel results" })
  await expect(
    results.getByText(/Nonstop .* for \$35 more than the lowest fare/),
  ).toBeVisible()
  const cards = results.getByRole("article")
  await expect(
    results.getByRole("heading", { name: "San Francisco → Boston" }),
  ).toBeVisible()
  await expect(cards).toHaveCount(2)
  await expect(
    results.getByText("2 complete round-trip quotes · 1 incomplete quote"),
  ).toBeVisible()
  await expect(cards.nth(0)).toContainText("$240")
  await expect(cards.nth(0)).toContainText("Total for 3 adults")
  await expect(
    page.getByRole("textbox", { name: "Refine this trip" }),
  ).toBeVisible()
  await expect(cards.nth(1)).toContainText("7:00 AM")
  await expect(cards.nth(1)).toContainText("10:30 PM")
  await expect(cards.nth(1)).toContainText("1:10 AM")
  await expect(cards.nth(1)).toContainText("Evening")
  await expect(cards.nth(1)).toContainText("Next day · Dec 13")
  await expect(cards.nth(1)).toContainText("2h 40m")
  await expect(cards.first()).toContainText("5h 45m")
  await cards.first().getByText("Connection details", { exact: true }).click()
  await expect(cards.first().getByText("Outbound · DEN (1h 5m)")).toBeVisible()
  await results
    .getByText("Review incomplete round-trip quote", { exact: true })
    .click()
  await expect(cards).toHaveCount(3)
  await expect(cards.nth(2)).toContainText("Return details unavailable")
  await expect(cards.nth(2)).toContainText("2026-12-10T22:00:00Z")
  await expect(cards.nth(2)).not.toContainText("Evening")
  await expect(cards.nth(2)).not.toContainText("Round trip")
  await expect(
    results.getByText("Quoted flight + full hotel stay", { exact: false }),
  ).toHaveCount(0)
  expect(await results.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(
    Math.ceil((await results.boundingBox())!.width),
  )
  const notes = page.getByRole("menuitem", {
    name: "Original response",
    exact: true,
  })
  await expect(
    page.getByText("Three flight options.", { exact: true }),
  ).toBeHidden()
  await testInfo.attach("390px flight comparison", {
    body: await page.screenshot(),
    contentType: "image/png",
  })
  await page.getByRole("button", { name: "Result actions" }).click()
  await notes.click()
  await expect(
    page.getByText("Three flight options.", { exact: true }),
  ).toBeVisible()
})

test("new chat starters prepare an editable draft and keep the agent graph optional", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 740 })
  await controlledTimingStream(page)
  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: "Plan a trip", exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Help", exact: true }).click()
  const graph = page.getByRole("button", { name: "Show agent graph" })
  await expect(graph).toHaveAttribute("aria-expanded", "false")
  await graph.click()
  await expect(
    page.getByRole("button", { name: "Hide agent graph" }),
  ).toHaveAttribute("aria-expanded", "true")
  await page.getByRole("button", { name: "Hide agent graph" }).click()
  await page.getByRole("button", { name: "Close help" }).click()

  const input = page.getByRole("textbox", {
    name: "Where would you like to go?",
  })
  const starters = page.getByRole("group", { name: "Search starters" })
  await starters.getByRole("button", { name: "Find flights" }).click()
  await expect(input).toHaveValue(
    "Find a weekend flight from Dallas to San Francisco for three adults.",
  )
  await expect(input).toBeFocused()
  await starters.getByRole("button", { name: "Find a hotel" }).click()
  await expect(input).toHaveValue(
    "Find a hotel in Boston for two adults next weekend.",
  )
  await input.fill("Find a hotel in Boston")
  await expect(
    starters.getByRole("button", { name: "Find flights" }),
  ).toBeDisabled()
  await expect(input).toHaveValue("Find a hotel in Boston")
  expect(await measurements(page)).toHaveLength(0)

  await submit(page)
  await expect(starters).toHaveCount(0)
  await expect(page.getByText(/Check the final airfare/)).toHaveCount(0)
  await emit(page, {
    type: "done",
    result: { response: "Flights found.", travel_result: flightResult },
  })
  await expect(page.getByText(/Check the final airfare/)).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Result actions" }),
  ).toHaveAttribute("aria-expanded", "false")
})

test("hotel cards keep caveats and budget details visible while the original response stays closed", async ({
  page,
}) => {
  await controlledTimingStream(page)
  await page.goto("/")
  await submit(page)
  const notice = "Confirm late arrival with the property."
  const budgetMessage =
    "Within quoted-cost budget: USD 200.00 of USD 250.00 for full hotel stay. Meals and unquoted fees are excluded."
  await emit(page, {
    type: "done",
    result: {
      response: `${budgetMessage}\n\n**Fixture Hotel**\n\nFront desk closes at midnight.\n\n${notice}`,
      travel_result: {
        ...flightResult,
        kind: "hotel_only",
        flights: [],
        hotels: [
          {
            id: "fixture-hotel",
            name: "Fixture Hotel",
            nightly_usd: 100,
            total_usd: 200,
            overall_rating: null,
            location_rating: null,
          },
        ],
        total_usd: null,
        notice,
      },
      budget_assessment: {
        status: "within",
        currency: "USD",
        limit: 250,
        quoted_total: 200,
        scope: "full hotel stay",
        message: budgetMessage,
      },
    },
  })
  const results = page.getByRole("region", { name: "Travel results" })
  await expect(
    results.getByText("Fixture Hotel", { exact: true }),
  ).toBeVisible()
  await expect(results.getByText(notice)).toBeVisible()
  const budget = page.getByRole("region", { name: "Budget assessment" })
  await expect(
    budget.getByRole("heading", { name: "Quote is $50 under budget" }),
  ).toBeVisible()
  await expect(budget).toContainText("Meals and unquoted fees are excluded.")
  await expect(budget).not.toContainText("Within quoted-cost budget:")
  const supplemental = page.getByText("Front desk closes at midnight.")
  await expect(supplemental).toBeHidden()
  await page.getByRole("button", { name: "Result actions" }).click()
  await page.getByRole("menuitem", { name: "Original response" }).click()
  await expect(supplemental).toBeVisible()
  await page.getByRole("button", { name: "Result actions" }).click()
  await page.getByRole("menuitem", { name: "Hide original response" }).click()
  await expect(page.getByText(notice, { exact: true })).toHaveCount(1)
})

test("narrow search acknowledges Send immediately and keeps Stop fixed through preview", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 740 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await controlledTimingStream(page, true)
  await page.goto("/")
  const input = page.getByRole("textbox", {
    name: "Where would you like to go?",
  })
  await input.fill(prompt)
  const send = page.getByRole("button", { name: "Send message" })
  const initial = await send.boundingBox()
  await send.click()
  const status = page.getByRole("status")
  await expect(status).toHaveText("Thinking")
  await expect(status.locator("span")).toHaveCSS("animation-name", "none")
  await expect(status).toBeInViewport()
  await page.getByRole("button", { name: "Help", exact: true }).click()
  const showGraph = page.getByRole("button", { name: "Show agent graph" })
  await expect(showGraph).toHaveAttribute("aria-expanded", "false")
  await showGraph.click()
  await expect(
    page.getByRole("button", { name: "Hide agent graph" }),
  ).toHaveAttribute("aria-expanded", "true")
  await page.getByRole("button", { name: "Hide agent graph" }).click()
  await page.getByRole("button", { name: "Close help" }).click()
  await emit(page, {
    type: "status",
    component: "flights",
    message: "Searching flights",
  })
  await expect(status).toHaveText("Searching flights")
  const draft = "Keep the same dates"
  await input.fill(draft)
  await input.press("Enter")
  await emit(page, previewEvent)
  await expect(status).toHaveText("Checking return flights")
  await expect(
    page.getByRole("region", { name: "Provisional outbound flights" }),
  ).toBeInViewport()
  const stop = page.getByRole("button", { name: "Stop", exact: true })
  await expect(stop).toBeInViewport()
  const pending = await stop.boundingBox()
  expect(pending!.width).toBeGreaterThanOrEqual(44)
  expect(pending!.height).toBeGreaterThanOrEqual(44)
  expect(pending!.x).toBeCloseTo(initial!.x, 0)
  expect(pending!.y).toBeCloseTo(initial!.y, 0)
  await emit(page, {
    type: "done",
    result: { response: "Round trip confirmed.", travel_result: flightResult },
  })
  await expect(
    page.getByRole("region", { name: "Travel results" }),
  ).toBeInViewport()
  await expect(stop).toHaveCount(0)
  await expect(
    page.getByRole("textbox", { name: "Refine this trip" }),
  ).toHaveValue(draft)
})

test("unfinished drafts stay with their trip when switching and starting over", async ({
  page,
}) => {
  await controlledTimingStream(page)
  await page.goto("/")
  await submit(page)
  await emit(page, {
    type: "done",
    result: { response: "Flight options", travel_result: flightResult },
  })
  const input = page.getByRole("textbox")
  await expect(
    page.getByRole("region", { name: "Travel results" }),
  ).toBeVisible()
  await input.fill("Change only the return flight")
  const newTrip = page.getByRole("button", { name: "New trip", exact: true })
  await newTrip.click()
  await expect(input).toBeEmpty()
  await input.fill("A hotel in Boston")
  await page.getByRole("button", { name: "SFO → BOS", exact: true }).click()
  await expect(input).toHaveValue("Change only the return flight")
  await newTrip.click()
  await expect(input).toBeEmpty()
})

test("preview and completion leave earlier messages in view when reading history", async ({
  page,
}) => {
  await controlledTimingStream(page)
  await page.addInitScript(() => {
    localStorage.setItem(
      "travel_chat_history",
      JSON.stringify([
        {
          id: "history-fixture",
          title: "Earlier trip",
          timestamp: new Date().toISOString(),
          messages: Array.from({ length: 24 }, (_, index) => ({
            role: "user",
            content: `Earlier message ${index + 1}`,
          })),
        },
      ]),
    )
  })
  await page.goto("/")
  await page.getByRole("button", { name: "Earlier trip", exact: true }).click()
  await page.getByRole("textbox").fill(prompt)
  await page.getByRole("textbox").press("Enter")
  await expect(
    page.getByText("Searching fixture", { exact: true }),
  ).toBeVisible()
  const conversation = page.getByRole("region", {
    name: "Conversation",
    exact: true,
  })
  await conversation.evaluate((element) => {
    element.scrollTop = 0
  })
  const earlier = page.getByText("Earlier message 1", { exact: true })
  await expect(earlier).toBeInViewport()
  await emit(page, previewEvent)
  await expect(
    page.getByRole("region", { name: "Provisional outbound flights" }),
  ).toBeAttached()
  await emit(page, {
    type: "done",
    result: { response: "Finished.", travel_result: flightResult },
  })
  await expect(
    page.getByRole("region", { name: "Travel results" }),
  ).toBeAttached()
  await expect(earlier).toBeInViewport()
})

test("records first useful card and terminal completion after final answer renders", async ({
  page,
}) => {
  await controlledTimingStream(page)
  await page.goto("/")
  await submit(page)

  await emit(page, {
    type: "result",
    component: "flights",
    travel_result: null,
  })
  await expect.poll(async () => (await measurements(page))?.length ?? 0).toBe(1)
  expect((await measurements(page))![0].firstUsefulCardMs).toBeUndefined()

  await emit(page, {
    type: "result",
    component: "flights",
    travel_result: flightResult,
  })
  const cards = page.getByRole("region", { name: "Travel results" })
  await expect(
    cards.getByRole("heading", { name: "Timing Fixture Air" }),
  ).toBeVisible()
  await waitForMeasurement(
    page,
    (entry) => typeof entry?.firstUsefulCardMs === "number",
  )

  await emit(page, {
    type: "done",
    result: { response: "Boston flight found." },
  })
  await expect(
    page.getByText("Boston flight found.", { exact: true }),
  ).toBeVisible()
  await waitForMeasurement(
    page,
    (entry) =>
      entry?.outcome === "success" &&
      typeof entry.finalResponseRenderedMs === "number",
  )

  const [entry] = (await measurements(page))!
  expect(entry).toMatchObject({
    backendTimingId: "fixture-timing-id",
    outcome: "success",
  })
  expect(entry.firstUsefulCardMs).toEqual(expect.any(Number))
  expect(entry.finalResponseRenderedMs).toEqual(expect.any(Number))
  expect(entry.terminalReceivedMs).toEqual(expect.any(Number))
  expect(entry.firstUsefulCardMs).toBeLessThanOrEqual(
    entry.finalResponseRenderedMs as number,
  )
  expect(JSON.stringify(entry)).not.toContain(prompt)
})

test("outbound preview renders while return is pending and yields to verified flights", async ({
  page,
}) => {
  await controlledTimingStream(page)
  await page.goto("/")
  await submit(page)
  const preview = page.getByRole("region", {
    name: "Provisional outbound flights",
  })
  const cards = page.getByRole("region", { name: "Travel results" })
  await emit(page, { ...previewEvent, flights: [{ airline: "Incomplete" }] })
  await emit(page, {
    type: "status",
    component: "flights",
    message: "Waiting on return fixture",
  })
  await expect(page.getByRole("status")).toHaveText("Waiting on return fixture")
  await expect(preview).toHaveCount(0)

  await emit(page, previewEvent)
  await expect(preview).toBeVisible()
  await expect(preview).toContainText("Return details and fare pending")
  await expect(preview).toContainText("8:00 AM")
  await expect(preview).toContainText("4:00 PM")
  await expect(preview).toContainText("1 stop")
  await expect(preview).not.toContainText("123")
  await expect(preview).not.toContainText("hidden-fixture-token")
  await expect(preview.getByRole("button")).toHaveCount(0)
  await expect(cards).toHaveCount(0)
  await waitForMeasurement(
    page,
    (entry) => typeof entry?.firstOutboundPreviewMs === "number",
  )
  expect((await measurements(page))![0].firstUsefulCardMs).toBeUndefined()
  const saved = await page.evaluate(() =>
    localStorage.getItem("travel_chat_history"),
  )
  expect(saved).toContain(prompt)
  expect(saved).not.toContain("Provisional Fixture Air")

  const roundTrip = {
    ...flightResult,
    flights: [
      {
        ...flightResult.flights[0],
        return_flight: {
          airline: "Fixture Return Air",
          departure_time: "18:00",
          arrival_time: "21:00",
          stops: 0,
        },
      },
    ],
  }
  await emit(page, {
    type: "result",
    component: "flights",
    travel_result: roundTrip,
  })
  await expect(cards).toContainText("Fixture Return Air")
  await expect(preview).toHaveCount(0)
  await waitForMeasurement(
    page,
    (entry) => typeof entry?.firstUsefulCardMs === "number",
  )
  await emit(page, previewEvent)
  await emit(page, {
    type: "done",
    result: { response: "Round trip confirmed.", travel_result: roundTrip },
  })
  await expect(cards).toContainText("Fixture Return Air")
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0)
  await expect(preview).toHaveCount(0)
  const [entry] = (await measurements(page))!
  expect(entry.firstOutboundPreviewMs).toBeLessThan(
    entry.firstUsefulCardMs as number,
  )
  expect((await latencySummary(page))!.firstOutboundPreviewMs.count).toBe(1)
})

test("first checked fare renders before ranking and stays out of saved history", async ({
  page,
}) => {
  await controlledTimingStream(page)
  await page.goto("/")
  await submit(page)
  await emit(page, previewEvent)
  const outbound = page.getByRole("region", {
    name: "Provisional outbound flights",
  })
  await expect(outbound).toBeVisible()
  const outboundCard = await outbound.getByRole("article").elementHandle()
  const early = page.getByRole("region", { name: "First checked round trip" })
  const flight = {
    outbound: previewEvent.flights[0],
    returned: {
      airline: "Return Air",
      departure_time: "18:00",
      arrival_time: "21:00",
      stops: 0,
    },
    total_usd: 275,
  }
  await emit(page, {
    type: "verified_flight_preview",
    flight: { ...flight, total_usd: -1 },
  })
  await expect(early).toHaveCount(0)
  await emit(page, { type: "verified_flight_preview", flight })
  await expect(early).toContainText("$275")
  expect(
    await outboundCard.evaluate((card) =>
      card.closest("section")?.getAttribute("aria-label"),
    ),
  ).toBe("First checked round trip")
  await expect(early).toContainText("Return Air")
  await expect(early).not.toContainText("hidden-fixture-token")
  await expect(early.getByRole("button")).toHaveCount(0)
  await expect(page.getByRole("status")).toHaveText("Checking more fares")
  await expect(outbound).toHaveCount(0)
  await waitForMeasurement(
    page,
    (entry) => typeof entry?.firstUsefulCardMs === "number",
  )
  expect((await measurements(page))![0].terminalReceivedMs).toBeUndefined()
  expect(
    await page.evaluate(() => localStorage.getItem("travel_chat_history")),
  ).not.toContain("Provisional Fixture Air")

  await emit(page, {
    type: "result",
    component: "flights",
    travel_result: flightResult,
  })
  const cards = page.getByRole("region", { name: "Travel results" })
  await expect(cards).toContainText("$240")
  await expect(early).toHaveCount(0)
  await emit(page, { type: "verified_flight_preview", flight })
  await emit(page, {
    type: "done",
    result: { response: "Ranked flight results.", travel_result: flightResult },
  })
  await expect(cards).toContainText("$240")
  await expect(early).toHaveCount(0)
  await waitForMeasurement(
    page,
    (entry) => typeof entry?.finalResponseRenderedMs === "number",
  )
})

test("flight sort and nonstop filter act locally and keep search actions separate", async ({
  page,
}) => {
  await controlledTimingStream(page)
  await page.goto("/")
  await submit(page)
  const outbound = flightResult.flights[0]
  const nonstopReturn = {
    airline: "Return Air",
    departure_time: "18:00",
    arrival_time: "21:00",
    stops: 0,
  }
  const result = {
    ...flightResult,
    flights: [
      {
        ...outbound,
        airline: "Both Ways Air",
        total_usd: 350,
        return_flight: nonstopReturn,
      },
      {
        ...outbound,
        id: "connection",
        airline: "Outbound Nonstop Air",
        total_usd: 200,
        return_flight: { ...nonstopReturn, stops: 1 },
      },
      {
        ...outbound,
        id: "unavailable",
        airline: "Unpriced Air",
        total_usd: null,
        return_flight: null,
      },
    ],
  }
  await emit(page, {
    type: "result",
    component: "flights",
    travel_result: result,
  })
  await expect(
    page.getByRole("region", { name: "Travel results" }),
  ).toBeVisible()
  await expect(
    page.getByRole("group", { name: "Compare returned flights" }),
  ).toHaveCount(0)
  await emit(page, {
    type: "done",
    result: { response: "Ranked flights.", travel_result: result },
  })
  const results = page.getByRole("region", { name: "Travel results" })
  const choices = results.getByRole("article")
  await expect(choices.first()).toContainText("Both Ways Air")
  await expect(page.getByLabel("Sort by").locator("option:checked")).toHaveText(
    "Search order",
  )
  await page.getByLabel("Sort by").selectOption("fare")
  await expect(choices.first()).toContainText("Outbound Nonstop Air")
  await expect(choices).toHaveCount(2)
  const nonstop = page.getByLabel("Nonstop both ways")
  await nonstop.check()
  await expect(choices).toHaveCount(1)
  await expect(choices.first()).toContainText("Both Ways Air")
  await nonstop.uncheck()
  await expect(choices).toHaveCount(2)
  await results
    .getByText("Review incomplete round-trip quote", { exact: true })
    .click()
  await expect(choices.last()).toContainText("Unpriced Air")
  await results
    .getByText("Review incomplete round-trip quote", { exact: true })
    .click()
  const searches = page.getByRole("group", { name: "Run another search" })
  await expect(
    searches.getByRole("button", { name: "Compare cheaper dates" }),
  ).toBeVisible()
  await expect(choices.first()).toContainText("$200")
  await expect(choices.nth(1)).toContainText("Nonstop both ways for $150 more")
  await expect(page.getByText(/\$150 more/)).toHaveCount(1)
  await expect(page.getByText("Compare fares from this search")).toHaveCount(0)
  expect(await measurements(page)).toHaveLength(1)

  await page.getByRole("button", { name: "New trip", exact: true }).click()
  await submit(page, "Find another flight to Boston")
  await emit(page, {
    type: "done",
    result: {
      response: "Other ranked flights.",
      travel_result: { ...result, origin: "LAX" },
    },
  })
  await nonstop.check()
  await expect(choices).toHaveCount(1)
  await page.getByRole("button", { name: "SFO → BOS", exact: true }).click()
  await expect(nonstop).not.toBeChecked()
  await expect(choices).toHaveCount(2)
})

test("same-fare comparison uses dated arrivals and explains matching return times", async ({
  page,
}) => {
  await controlledTimingStream(page)
  await page.goto("/")
  await submit(page)
  const outbound = {
    ...flightResult.flights[0],
    price_scope: "requested_party",
    arrival_airport: "BOS",
    stops: 1,
  }
  await emit(page, {
    type: "done",
    result: {
      response: "Flight quotes.",
      travel_result: {
        ...flightResult,
        flights: [
          { ...outbound, id: "f1", arrival_time: "2026-12-10 09:00" },
          { ...outbound, id: "f2", arrival_time: "2026-12-10 10:25" },
        ],
      },
    },
  })
  const results = page.getByRole("region", { name: "Travel results" })
  await expect(
    results.getByText(
      "Same fare · Outbound arrives 1h 25m earlier · Same return times",
    ),
  ).toBeVisible()
  await results.getByLabel("Nonstop both ways").check()
  await expect(results.getByRole("status")).toHaveText(
    "No options in these results are nonstop both ways.",
  )
  await results.getByRole("button", { name: "Clear filter" }).click()
  await expect(results.getByRole("article")).toHaveCount(2)
})

test("an all-incomplete result offers a disclosure and keeps outbound fares out of comparisons", async ({
  page,
}) => {
  await controlledTimingStream(page)
  await page.goto("/")
  await submit(page)
  await emit(page, {
    type: "done",
    result: {
      response: "Incomplete round-trip quotes.",
      travel_result: {
        ...flightResult,
        flights: [],
        incomplete_flight_count: 1,
        incomplete_flights: [
          {
            ...flightResult.flights[0],
            total_usd: null,
            return_flight: null,
          },
        ],
      },
    },
  })
  const results = page.getByRole("region", { name: "Travel results" })
  await expect(
    results.getByText("No complete round-trip quotes · 1 incomplete quote"),
  ).toBeVisible()
  await expect(results.getByLabel("Sort by")).toHaveCount(0)
  await results
    .getByText("Review incomplete round-trip quote", { exact: true })
    .click()
  await expect(results.getByText("Return details unavailable")).toBeVisible()
  await expect(
    results.getByRole("button", { name: "Save option" }),
  ).toHaveCount(0)
  await expect(results.getByText("$240", { exact: true })).toHaveCount(0)
})

test("preview stays with its pending chat, clears on Stop, and cannot reappear after reload", async ({
  page,
}) => {
  await controlledTimingStream(page)
  await page.goto("/")
  await submit(page)
  const preview = page.getByRole("region", {
    name: "Provisional outbound flights",
  })
  await emit(page, previewEvent, prompt)
  await expect(preview).toBeVisible()
  await page.getByRole("button", { name: "New trip", exact: true }).click()
  await submit(page, "Another flight")
  await expect(preview).toHaveCount(0)
  await page.getByRole("button", { name: prompt, exact: true }).click()
  await expect(preview).toBeVisible()
  await page.getByRole("button", { name: "Stop", exact: true }).click()
  await emit(page, previewEvent, prompt)
  await expect(preview).toHaveCount(0)
  await expect(page.getByText("Search stopped.", { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole("button", { name: prompt, exact: true }).click()
  await expect(preview).toHaveCount(0)
})

test("a completed render remains eligible in the latency summary after New trip", async ({
  page,
}) => {
  await controlledTimingStream(page)
  await page.goto("/")
  await submit(page)
  await emit(page, {
    type: "done",
    result: { response: "Boston flight found." },
  })
  await expect(
    page.getByText("Boston flight found.", { exact: true }),
  ).toBeVisible()
  await waitForMeasurement(
    page,
    (entry) => typeof entry?.finalResponseRenderedMs === "number",
  )

  await page.getByRole("button", { name: "New trip", exact: true }).click()
  const [entry] = (await measurements(page))!
  expect(entry.finalResponseRenderedMs).toEqual(expect.any(Number))
  expect(entry.renderExcluded).not.toBe(true)

  const summary = (await latencySummary(page))!
  expect(summary.finalResponseRenderedMs.count).toBe(1)
  expect(summary.finalResponseRenderedMs.medianMs).toEqual(expect.any(Number))
})

test("clarification without a card records no useful-card milestone", async ({
  page,
}) => {
  await controlledTimingStream(page)
  await page.goto("/")
  await submit(page)
  await emit(page, { type: "text", text: "Which dates would you prefer?" })
  await emit(page, {
    type: "done",
    result: { response: "Which dates would you prefer?" },
  })
  await expect(
    page.getByText("Which dates would you prefer?", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("region", { name: "Travel results" }),
  ).toHaveCount(0)
  await expect.poll(async () => (await measurements(page))?.length ?? 0).toBe(1)
  await waitForMeasurement(
    page,
    (entry) => typeof entry?.finalResponseRenderedMs === "number",
  )
  const [entry] = (await measurements(page))!
  expect(entry).toMatchObject({
    outcome: "success",
    terminalReceivedMs: expect.any(Number),
    finalResponseRenderedMs: expect.any(Number),
  })
  expect(entry.firstUsefulCardMs).toBeUndefined()
})

test("a stream that finishes in a background chat never gets render timings on return", async ({
  page,
}) => {
  await controlledTimingStream(page)
  await page.goto("/")
  await submit(page, "Background flight")
  await page.getByRole("button", { name: "New trip", exact: true }).click()
  await submit(page, "Visible flight")

  await emit(
    page,
    {
      type: "result",
      component: "flights",
      travel_result: flightResult,
    },
    "Background flight",
  )
  await emit(
    page,
    {
      type: "done",
      result: {
        response: "Background flight done.",
        travel_result: flightResult,
      },
    },
    "Background flight",
  )
  await waitForMeasurement(page, (entry) => entry?.outcome === "success")
  const [entry] = (await measurements(page))!
  expect(entry.firstUsefulCardMs).toBeUndefined()
  expect(entry.finalResponseRenderedMs).toBeUndefined()
  expect(entry.renderExcluded).toBe(true)

  await page.getByRole("button", { name: "SFO → BOS", exact: true }).click()
  await expect(
    page.getByText("Background flight done.", { exact: true }),
  ).toBeHidden()
  await expect(
    page.getByRole("region", { name: "Travel results" }).getByRole("heading", {
      name: "Timing Fixture Air",
    }),
  ).toBeVisible()
  const [returnedEntry] = (await measurements(page))!
  expect(returnedEntry.firstUsefulCardMs).toBeUndefined()
  expect(returnedEntry.finalResponseRenderedMs).toBeUndefined()
  expect(returnedEntry.renderExcluded).toBe(true)
})

test("request errors and Stop are recorded as terminal failures, never successes", async ({
  page,
}) => {
  await controlledTimingStream(page)
  await page.goto("/")
  await submit(page)
  await emit(page, previewEvent)
  const preview = page.getByRole("region", {
    name: "Provisional outbound flights",
  })
  await expect(preview).toBeVisible()
  await emit(page, {
    type: "error",
    component: "request",
    message: "Fixture request failed. Please retry.",
  })
  await expect(
    page.getByText("Fixture request failed. Please retry."),
  ).toBeVisible()
  await expect(preview).toHaveCount(0)
  await waitForMeasurement(page, (entry) => entry?.outcome === "error")

  await page.getByRole("button", { name: "New trip", exact: true }).click()
  await submit(page)
  await page.getByRole("button", { name: "Stop", exact: true }).click()
  await expect(page.getByText("Search stopped.", { exact: true })).toBeVisible()
  await expect.poll(async () => (await measurements(page))?.length ?? 0).toBe(2)
  const entries = (await measurements(page))!
  expect(entries.map((entry) => entry.outcome)).toEqual(["error", "cancelled"])
  expect(entries[0].endedMs).toEqual(expect.any(Number))
  expect(entries[1].endedMs).toEqual(expect.any(Number))
})

test("measurements stay in memory, omit prompt data, and do not reappear after reload", async ({
  page,
}) => {
  await controlledTimingStream(page)
  await page.goto("/")
  await submit(page)
  await emit(page, { type: "done", result: { response: "Fixture complete." } })
  await expect(
    page.getByText("Fixture complete.", { exact: true }),
  ).toBeVisible()
  await expect.poll(async () => (await measurements(page))?.length ?? 0).toBe(1)
  const entry = (await measurements(page))![0]
  expect(JSON.stringify(entry)).not.toContain(prompt)
  const savedHistory = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("travel_chat_history") || "[]"),
  )
  expect(JSON.stringify(savedHistory[0])).toContain(prompt)
  expect(JSON.stringify(savedHistory[0])).not.toContain("fixture-timing-id")

  await page.reload()
  await expect
    .poll(async () => (await measurements(page))?.length ?? null)
    .toBe(0)
})
