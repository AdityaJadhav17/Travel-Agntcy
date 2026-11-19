import { randomUUID } from "node:crypto"
import { expect, test } from "@playwright/test"
import type { TravelResult } from "../src/types/travelResult"

test("saved fares stay with their trip through later searches and reload", async ({
  page,
}) => {
  const checkedAt = "2026-11-18T20:15:00Z"
  const result: TravelResult = {
    version: 1,
    kind: "flight_only",
    searched_at: checkedAt,
    origin: "SFO",
    destination: "JFK",
    start_date: "2027-03-05",
    end_date: "2027-03-10",
    adults: 2,
    children: 1,
    rooms: 1,
    is_one_way: false,
    flights: [
      {
        id: "first-quote",
        airline: "Snapshot Air",
        total_usd: 413,
        price_scope: "requested_party",
        departure_time: "2027-03-05 08:30",
        arrival_time: "2027-03-05 18:00",
        arrival_airport: "JFK",
        duration_minutes: 390,
        connections: [{ airport: "ORD", duration_minutes: 55 }],
        stops: 1,
        return_flight: {
          airline: "Return Air",
          departure_time: "2027-03-10 22:15",
          arrival_time: "2027-03-11 01:15",
          arrival_airport: "OAK",
          stops: 0,
        },
      },
      {
        id: "missing-return",
        airline: "Incomplete Air",
        total_usd: 359,
        departure_time: "2027-03-05 11:10",
        arrival_time: "2027-03-05 19:00",
        stops: 0,
        return_flight: null,
      },
    ],
    hotels: [],
    activities: [],
    total_usd: null,
    notice: "",
  }

  const later: TravelResult = {
    ...result,
    searched_at: "2026-11-18T21:15:00Z",
    flights: [{ ...result.flights[0], airline: "Later Air", total_usd: 525 }],
  }

  const tripId = randomUUID()
  await page.addInitScript(
    ({ tripId, result, later }) => {
      const historyKey = "travel_chat_history"
      if (!localStorage.getItem(historyKey)) {
        localStorage.setItem(
          historyKey,
          JSON.stringify([
            {
              id: tripId,
              conversationId: tripId,
              title: "New York trip",
              timestamp: new Date().toISOString(),
              messages: [
                {
                  role: "assistant",
                  content: "Found a round trip",
                  travel_result: result,
                },
              ],
            },
            {
              id: "other-trip",
              title: "Other trip",
              timestamp: new Date().toISOString(),
              messages: [{ role: "user", content: "Another trip" }],
            },
          ]),
        )
      }
      const realFetch = window.fetch.bind(window)
      window.fetch = (input, init) => {
        const url = String(input)
        if (url.endsWith("/auth/status"))
          return Promise.resolve(Response.json({ authenticated: true }))
        if (url.endsWith("/agent/prompt/stream"))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                type: "done",
                result: { response: "Later fares", travel_result: later },
              }) + "\n",
              { headers: { "Content-Type": "application/x-ndjson" } },
            ),
          )
        return realFetch(input, init)
      }
    },
    { tripId, result, later },
  )

  await page.goto("/")
  const trips = page.getByRole("navigation", { name: "Recent trips" })
  const trip = trips.getByRole("button", { name: "SFO → JFK", exact: true })
  const entry = page.getByText("Saved flights (1)", { exact: true })
  const saved = page.getByRole("region", { name: "Saved flights" })

  await trip.click()
  const option = page.getByRole("button", { name: "Save option", exact: true })
  await page.getByText("Review incomplete round-trip quote").click()
  await expect(page.getByText("Incomplete Air")).toBeVisible()
  await expect(option).toHaveCount(1)
  await option.click()
  const unsave = page.getByRole("button", {
    name: "Unsave option",
    exact: true,
  })
  await expect(unsave).toBeEnabled()
  await page.reload()
  await trip.click()
  await unsave.press("Enter")
  await expect(entry).toHaveCount(0)
  await page.reload()
  await trip.click()
  await expect(unsave).toHaveCount(0)
  await option.click()
  await expect(entry).toBeVisible()

  await trips.getByRole("button", { name: "Other trip", exact: true }).click()
  await expect(entry).toHaveCount(0)
  await trip.click()
  await page.getByRole("textbox").fill("Search again")
  await page.getByRole("textbox").press("Enter")
  await expect(page.getByRole("heading", { name: "Later Air" })).toBeVisible()

  await page.reload()
  await trip.click()
  await entry.click()
  const snapshot = saved.getByRole("article")
  for (const detail of [
    "SFO → JFK",
    "JFK → OAK",
    "3 travelers",
    "Round trip",
    "Quoted $413",
    "Snapshot Air",
    "Return Air",
    "8:30 AM",
    "10:15 PM",
    "Next day · Mar 11",
    "Fare checked",
  ]) {
    await expect(snapshot).toContainText(detail)
  }
  await expect(snapshot.locator("time")).toHaveAttribute("datetime", checkedAt)
  await snapshot.getByText("Connection details", { exact: true }).click()
  await expect(snapshot.getByText("Outbound · ORD (55m)")).toBeVisible()
  await snapshot.getByRole("button", { name: "Remove saved option" }).click()
  await expect(entry).toHaveCount(0)
  await expect(option).toHaveCount(2)
  await page.reload()
  await trip.click()
  await expect(entry).toHaveCount(0)
})
