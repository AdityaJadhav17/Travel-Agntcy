import { randomUUID } from "node:crypto"
import { test, expect, type Page } from "@playwright/test"
import { observeTravelStreams, observedStreamResult } from "./streamObserver"

const api = process.env.E2E_API_URL || "http://localhost:8000"
const historyKey = "travel_chat_history"

// Control event ordering without sleeps or live providers. Other requests still
// reach the test stack. Closing/reloading the page aborts the mocked stream.
async function controlledStreams(page: Page) {
  await page.addInitScript(() => {
    const fetchOriginal = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      if (!String(input).endsWith("/agent/prompt/stream"))
        return fetchOriginal(input, init)
      const { prompt } = JSON.parse(String(init?.body))
      const encoder = new TextEncoder()
      let cleanup = () => {}
      return new Response(
        new ReadableStream({
          start(controller) {
            const listener = (event: Event) => {
              const detail = (event as CustomEvent).detail
              if (detail.prompt !== prompt) return
              controller.enqueue(
                encoder.encode(JSON.stringify(detail.event) + "\n"),
              )
              if (detail.event.type === "done") {
                cleanup()
                controller.close()
              }
            }
            const abort = () => {
              cleanup()
              controller.error(new DOMException("Aborted", "AbortError"))
            }
            cleanup = () => {
              document.removeEventListener("travel-test-event", listener)
              init?.signal?.removeEventListener("abort", abort)
            }
            document.addEventListener("travel-test-event", listener)
            init?.signal?.addEventListener("abort", abort)
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "status",
                  component: "request",
                  message: `Searching ${prompt}`,
                }) + "\n",
              ),
            )
          },
          cancel() {
            cleanup()
          },
        }),
        { headers: { "Content-Type": "application/x-ndjson" } },
      )
    }
  })
}

async function submit(page: Page, text: string) {
  await page.getByRole("textbox").fill(text)
  await page.getByRole("textbox").press("Enter")
  await expect(page.getByRole("status")).toHaveText(`Searching ${text}`)
}

async function emit(
  page: Page,
  prompt: string,
  event: Record<string, unknown>,
) {
  await page.evaluate(
    (detail) =>
      document.dispatchEvent(new CustomEvent("travel-test-event", { detail })),
    { prompt, event },
  )
}

test("background chats keep progress, partial cards, and text through selection changes", async ({
  page,
}) => {
  await controlledStreams(page)
  await page.goto("/")
  await submit(page, "First trip")
  await page.getByRole("button", { name: "New trip", exact: true }).click()
  await submit(page, "Second trip")
  await emit(page, "First trip", {
    type: "status",
    component: "hotels",
    message: "Hotels still searching",
  })
  await emit(page, "First trip", {
    type: "text",
    text: "Retained partial text",
  })
  await emit(page, "First trip", {
    type: "result",
    component: "flights",
    travel_result: {
      version: 1,
      kind: "flight_only",
      searched_at: new Date().toISOString(),
      origin: "DFW",
      destination: "JFK",
      start_date: "2027-01-10",
      end_date: "2027-01-13",
      adults: 1,
      children: 0,
      rooms: 1,
      is_one_way: false,
      flights: [
        {
          id: "one",
          airline: "Retained Air",
          total_usd: 100,
          departure_time: "10:00",
          arrival_time: "12:00",
          stops: 0,
          return_flight: {
            airline: "Retained Air",
            departure_time: "15:00",
            arrival_time: "18:00",
            stops: 0,
          },
        },
      ],
      hotels: [],
      activities: [],
      total_usd: 100,
      notice: "Partial flight result",
    },
  })
  await expect(page.getByText("Retained partial text")).toHaveCount(0)
  await page.getByRole("button", { name: "First trip", exact: true }).click()
  await expect(page.getByRole("status")).toHaveText("Hotels still searching")
  await expect(page.getByText("Retained partial text")).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Retained Air" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Second trip", exact: true }).click()
  await emit(page, "First trip", {
    type: "done",
    result: { response: "First trip finished" },
  })
  await expect(page.getByRole("status")).toHaveText("Searching Second trip")
  await expect(page.getByText("First trip finished")).toHaveCount(0)
  await page.getByRole("button", { name: "First trip", exact: true }).click()
  await expect(page.getByText("First trip finished")).toBeVisible()
  await expect(page.getByText("Retained partial text")).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0)
})

test("reload exposes recovery without auto-starting, and replays the saved request once", async ({
  page,
  request,
}) => {
  const conversationId = randomUUID(),
    requestId = randomUUID(),
    chatId = randomUUID()
  const prompt = "Plan Dallas to New York"
  const savedResponse = await request.post(`${api}/agent/prompt`, {
    data: { prompt, conversation_id: conversationId, request_id: requestId },
  })
  expect(savedResponse.ok()).toBe(true)
  const savedResult = await savedResponse.json()
  try {
    await observeTravelStreams(page)
    // The server committed, but the browser lost its response before reload.
    // Seed before React reads or persists history, and only on the first load.
    await page.addInitScript(
      ({ key, chat }) => {
        if (sessionStorage.getItem("recoveryFixtureSeeded")) return
        localStorage.setItem(key, JSON.stringify([chat]))
        sessionStorage.setItem("recoveryFixtureSeeded", "true")
      },
      {
        key: historyKey,
        chat: {
          id: chatId,
          conversationId,
          title: prompt,
          timestamp: new Date().toISOString(),
          messages: [{ role: "user", content: prompt }],
          pendingRequest: { id: requestId, prompt },
        },
      },
    )
    const requests: Record<string, unknown>[] = []
    page.on("request", (outgoing) => {
      if (outgoing.url().endsWith("/agent/prompt/stream"))
        requests.push(outgoing.postDataJSON())
    })
    await page.goto("/")
    await page.getByRole("button", { name: prompt, exact: true }).click()
    await expect(page.getByRole("status")).toContainText(
      "Your search was interrupted",
    )
    await expect(page.getByRole("textbox")).toBeEnabled()
    expect(requests).toHaveLength(0)
    await page.route(
      "**/agent/prompt/stream",
      (route) => route.abort("failed"),
      { times: 1 },
    )
    await page
      .getByRole("button", { name: "Retry search", exact: true })
      .click()
    await expect(page.getByRole("status")).toContainText(
      "The travel connection was interrupted",
    )
    await page.reload()
    await page.getByRole("button", { name: prompt, exact: true }).click()
    await expect(
      page.getByRole("button", { name: "Retry search", exact: true }),
    ).toBeVisible()
    const replay = page.waitForResponse((reply) =>
      reply.url().endsWith("/agent/prompt/stream"),
    )
    const retry = page.getByRole("button", {
      name: "Retry search",
      exact: true,
    })
    await retry.focus()
    await retry.press("Enter")
    expect(await observedStreamResult(page, await replay)).toEqual(savedResult)
    await expect(
      page.getByRole("button", { name: "Retry search", exact: true }),
    ).toHaveCount(0)
    expect(requests).toEqual([
      { prompt, conversation_id: conversationId, request_id: requestId },
      { prompt, conversation_id: conversationId, request_id: requestId },
    ])
    const history = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) || "[]"),
      historyKey,
    )
    expect(
      history[0].messages.map((message: { role: string }) => message.role),
    ).toEqual(["user", "assistant"])
    expect(history[0].pendingRequest).toBeUndefined()
    await page.reload()
    await page.getByRole("button", { name: "DFW → JFK", exact: true }).click()
    await expect(
      page.getByRole("button", { name: "Retry search", exact: true }),
    ).toHaveCount(0)
  } finally {
    await request.delete(`${api}/conversations/${conversationId}`)
  }
})

test("reload of a live stream shows recovery, while stopped chats stay stopped", async ({
  page,
}) => {
  await controlledStreams(page)
  await page.goto("/")
  await submit(page, "Interrupted trip")
  await page.reload()
  await page
    .getByRole("button", { name: "Interrupted trip", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "Retry search", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0)
  await page.getByRole("button", { name: "New trip", exact: true }).click()
  await submit(page, "Stopped trip")
  await page.getByRole("button", { name: "Stop", exact: true }).click()
  await expect(page.getByText("Search stopped.", { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole("button", { name: "Stopped trip", exact: true }).click()
  await expect(page.getByText("Search stopped.", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Retry search", exact: true }),
  ).toHaveCount(0)
})

test("failed deletion of a running chat restores an editable stopped view", async ({
  page,
}) => {
  await controlledStreams(page)
  await page.route("**/conversations/*", (route) =>
    route.fulfill({ status: 500, body: "Delete failed" }),
  )
  await page.goto("/")
  await submit(page, "Delete retry")
  await page.getByRole("button", { name: "Delete retry", exact: true }).hover()
  await page.getByRole("button", { name: "Trip actions: Delete retry" }).click()
  await page.getByRole("menuitem", { name: "Delete trip" }).click()
  const confirmation = page.getByRole("alertdialog", { name: "Delete trip?" })
  await expect(confirmation).toHaveAccessibleDescription(/Delete retry/)
  await expect(
    confirmation.getByRole("button", { name: "Cancel" }),
  ).toBeFocused()
  await confirmation.getByRole("button", { name: "Cancel" }).click()
  await expect(
    page.getByRole("button", { name: "Trip actions: Delete retry" }),
  ).toBeFocused()
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Trip actions: Delete retry" }).click()
  await page.getByRole("menuitem", { name: "Delete trip" }).click()
  await confirmation.getByRole("button", { name: "Delete trip" }).click()
  await expect(
    page.getByText(
      "Could not delete the saved conversation. Please try again.",
    ),
  ).toBeVisible()
  await expect(page.getByRole("textbox")).toBeEnabled()
  await expect(page.getByText("Search stopped.", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0)
  await submit(page, "Try again")
})

test("mobile trips drawer confines focus, dismisses, and preserves the conversation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await controlledStreams(page)
  await page.goto("/")
  await submit(page, "Mobile trip")
  const toggle = page.getByRole("button", { name: "Open sidebar" })
  const drawer = page.getByRole("dialog", { name: "Trips" })
  const close = drawer.getByRole("button", { name: "Close sidebar" })
  const actions = drawer.getByRole("button", {
    name: "Trip actions: Mobile trip",
  })

  await toggle.click()
  await expect(close).toBeFocused()
  await page.keyboard.press("Shift+Tab")
  await expect(actions).toBeFocused()
  await actions.press("Enter")
  await expect(
    drawer.getByRole("menuitem", { name: "Delete trip" }),
  ).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(actions).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(close).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(drawer).toHaveCount(0)
  await expect(toggle).toBeFocused()

  await toggle.click()
  await page.mouse.click(370, 120)
  await expect(drawer).toHaveCount(0)
  await expect(toggle).toBeFocused()

  await toggle.click()
  await close.click()
  await expect(drawer).toHaveCount(0)
  await expect(toggle).toBeFocused()

  await toggle.click()
  await drawer.getByRole("button", { name: "Mobile trip", exact: true }).click()
  await expect(drawer).toHaveCount(0)
  await expect(toggle).toBeFocused()
  await expect(page.getByText("Searching Mobile trip")).toBeVisible()

  await toggle.click()
  await drawer.getByRole("button", { name: "New trip" }).click()
  await expect(drawer).toHaveCount(0)
  await expect(toggle).toBeFocused()
  await expect(page.getByRole("textbox")).toBeEditable()
})

test("recent trips show saved routes and group longer history by calendar day", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date(2027, 0, 31, 1))
  await page.addInitScript(
    ({ key }) => {
      const dates = [31, 30, 28, 24, 1, 0]
      const trips = dates.map((day, index) => ({
        id: `saved-${index}`,
        title: `Saved prompt ${index}`,
        timestamp: new Date(2027, 0, day, index === 0 ? 0 : 23).toISOString(),
        messages: [
          { role: "user", content: `Saved prompt ${index}` },
          {
            role: "assistant",
            content: `Saved answer ${index}`,
            ...(index === 0
              ? {
                  trip_state: {
                    search_type: "flight_only",
                    origin: "DFW",
                    destination: "JFK",
                    start_date: "2027-03-01",
                    is_one_way: true,
                  },
                }
              : {}),
          },
        ],
      }))
      localStorage.setItem(key, JSON.stringify(trips))
    },
    { key: historyKey },
  )
  await page.goto("/")

  const recent = page.getByRole("navigation", { name: "Recent trips" })
  const route = recent.getByRole("button", { name: "DFW → JFK", exact: true })
  await expect(
    recent
      .getByRole("region", { name: "Today" })
      .getByRole("button", { name: "DFW → JFK", exact: true }),
  ).toBeVisible()
  await expect(route).toHaveAccessibleDescription(
    "Mar 1, 2027 Flights · One-way",
  )
  for (const [group, index] of [
    ["Yesterday", 1],
    ["Previous 7 days", 2],
    ["Previous 7 days", 3],
    ["Previous 30 days", 4],
    ["Older", 5],
  ] as const) {
    await expect(
      recent
        .getByRole("region", { name: group })
        .getByRole("button", { name: `Saved prompt ${index}`, exact: true }),
    ).toBeVisible()
  }
  await route.click()
  await expect(route).toHaveAttribute("aria-current", "true")
  await expect(page.getByText("Saved answer 0", { exact: true })).toBeVisible()
})
