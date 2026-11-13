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
      return_flight: null,
    },
  ],
  hotels: [],
  activities: [],
  total_usd: 240,
  notice: "",
}

/** Provide a controllable streaming response so the card and terminal event
 * can be observed as separate browser milestones without external providers.
 */
async function controlledTimingStream(page: Page) {
  await page.addInitScript((header) => {
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
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
  }, timingHeader)
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

test("a completed render remains eligible in the latency summary after New chat", async ({
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

  await page.getByRole("button", { name: "New chat", exact: true }).click()
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
  await page.getByRole("button", { name: "New chat", exact: true }).click()
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

  await page
    .getByRole("button", { name: "Background flight", exact: true })
    .click()
  await expect(
    page.getByText("Background flight done.", { exact: true }),
  ).toBeVisible()
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
  await emit(page, {
    type: "error",
    component: "request",
    message: "Fixture request failed. Please retry.",
  })
  await expect(
    page.getByText("Fixture request failed. Please retry."),
  ).toBeVisible()
  await waitForMeasurement(page, (entry) => entry?.outcome === "error")

  await page.getByRole("button", { name: "New chat", exact: true }).click()
  await submit(page)
  await page.getByRole("button", { name: "Stop", exact: true }).click()
  await expect(
    page.getByText("Search stopped. Late results will be ignored."),
  ).toBeVisible()
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
