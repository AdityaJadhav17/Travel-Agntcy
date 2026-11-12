import { test, expect } from "@playwright/test"
import {
  TravelStream,
  readTravelStream,
  type TravelStreamEvent,
} from "../src/utils/travelStream"
import { parseTravelResult } from "../src/types/travelResult"

const done = (response = "Finished") =>
  JSON.stringify({ type: "done", result: { response } })
const encode = (text: string) => new TextEncoder().encode(text)
function body(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

test("framing accepts every byte boundary, UTF-8, CRLF, blank lines and final line without newline", async () => {
  const events: TravelStreamEvent[] = []
  const bytes = encode(
    '\r\n{"type":"text","text":"東京 ✈"}\r\n' + done("Paris café"),
  )
  const result = await readTravelStream(
    body(Array.from(bytes, (byte) => new Uint8Array([byte]))),
    (event) => events.push(event),
  )
  expect(events).toEqual([{ type: "text", text: "東京 ✈" }])
  expect(result.response).toBe("Paris café")
})

for (const [name, line] of [
  ["invalid JSON", "{"],
  ["null", "null"],
  ["array", "[]"],
  ["missing type", "{}"],
  ["numeric type", '{"type":7}'],
  ["object text", '{"type":"text","text":{}}'],
  ["object message", '{"type":"status","component":"flights","message":{}}'],
  ["missing component", '{"type":"error","message":"Oops"}'],
  ["invalid result envelope", '{"type":"done","result":{"response":{}}}'],
]) {
  test(`rejects ${name} before rendering it`, async () => {
    const events: TravelStreamEvent[] = []
    await expect(
      readTravelStream(body([encode(line + "\n")]), (event) =>
        events.push(event),
      ),
    ).rejects.toThrow(/Please retry your last message/)
    expect(events).toEqual([])
  })
}

test("first completion wins over duplicate results, late errors, text and malformed suffixes", () => {
  const stream = new TravelStream()
  const events: TravelStreamEvent[] = []
  const receive = (event: TravelStreamEvent) => events.push(event)
  stream.accept(done("First answer"), receive)
  for (const line of [
    done("Wrong answer"),
    '{"type":"text","text":"late"}',
    '{"type":"error","component":"request","message":"late failure"}',
    "{",
  ])
    stream.accept(line, receive)
  expect(stream.finish().response).toBe("First answer")
  expect(events).toEqual([])
})

test("request error is terminal and cannot be replaced by a later done", () => {
  const stream = new TravelStream()
  stream.accept(
    '{"type":"error","component":"request","message":"Please start a new chat","status":409}',
    () => {},
  )
  stream.accept(done(), () => {})
  expect(() => stream.finish()).toThrow("Please start a new chat")
})

test("component errors are progress and do not discard partial success", async () => {
  const events: TravelStreamEvent[] = []
  const response = await readTravelStream(
    body([
      encode(
        '{"type":"error","component":"hotels","message":"Unavailable"}\n' +
          done("Flights are available") +
          "\n",
      ),
    ]),
    (event) => events.push(event),
  )
  expect(events).toEqual([
    { type: "error", component: "hotels", message: "Unavailable" },
  ])
  expect(response.response).toBe("Flights are available")
})

test("unknown events and unsupported optional cards preserve narrative fallback", async () => {
  const events: TravelStreamEvent[] = []
  const response = await readTravelStream(
    body([
      encode(
        [
          JSON.stringify({ type: "future-event", payload: {} }),
          JSON.stringify({
            type: "result",
            component: "flights",
            travel_result: { version: 2 },
          }),
          JSON.stringify({
            type: "done",
            result: {
              response: "Readable narrative",
              travel_result: { version: 2 },
              budget_assessment: { message: {} },
              retry_hotels: "true",
              trip_state: [],
              session_id: 42,
            },
          }),
        ].join("\n"),
      ),
    ]),
    (event) => events.push(event),
  )
  expect(response).toEqual({
    response: "Readable narrative",
    travel_result: null,
    budget_assessment: null,
  })
  expect(events).toEqual([])
})

test("valid optional final fields survive validation", async () => {
  const result = {
    response: "Done",
    session_id: "session",
    conversation_id: "chat",
    trip_state: { origin: "DFW" },
    retry_hotels: true,
    budget_assessment: {
      status: "within",
      currency: "USD",
      limit: 600,
      quoted_total: 540,
      scope: "quoted_total",
      message: "Within budget",
    },
    travel_result: null,
  }
  expect(
    await readTravelStream(
      body([encode(JSON.stringify({ type: "done", result }))]),
      () => {},
    ),
  ).toEqual(result)
})

test("travel result parser accepts legacy hotel cards and validates optional evidence fields", () => {
  const legacy = {
    version: 1,
    kind: "hotel_only",
    searched_at: "2026-11-10T00:00:00Z",
    origin: "",
    destination: "New York",
    start_date: "2026-12-10",
    end_date: "2026-12-12",
    adults: 1,
    children: 0,
    rooms: 1,
    is_one_way: false,
    flights: [],
    hotels: [
      {
        id: "hotel-legacy",
        name: "Legacy Hotel",
        nightly_usd: 100,
        total_usd: 200,
        overall_rating: null,
        location_rating: null,
      },
    ],
    activities: [],
    total_usd: null,
    notice: "",
  }
  expect(parseTravelResult(legacy)?.hotels[0]).toMatchObject({
    name: "Legacy Hotel",
  })
  expect(
    parseTravelResult({
      ...legacy,
      hotels: [
        {
          ...legacy.hotels[0],
          room_type: "private room",
          accommodation_status: "matched",
          accommodation_evidence: {
            property_type: "hotel",
            room_type: "private room",
            source: "provider room details",
          },
          check_in_date: "2026-12-10",
          check_out_date: "2026-12-12",
          timing_status: "needs_confirmation",
          timing_message: "Late arrival retention needs confirmation.",
          provisional: true,
        },
      ],
      hotel_check_in_date: "2026-12-10",
      hotel_check_out_date: "2026-12-12",
      hotel_result_count: 3,
    })?.hotels[0].provisional,
  ).toBe(true)
  expect(
    parseTravelResult({
      ...legacy,
      hotels: [{ ...legacy.hotels[0], timing_status: "certain" }],
    }),
  ).toBeNull()
})

test("EOF without done fails even after text; failure remains terminal", async () => {
  await expect(
    readTravelStream(
      body([encode('{"type":"text","text":"Not final"}\n')]),
      () => {},
    ),
  ).rejects.toThrow("ended before sending a complete result")
  const stream = new TravelStream()
  expect(() => stream.finish()).toThrow("ended before")
  stream.accept(done(), () => {})
  expect(() => stream.finish()).toThrow("ended before")
})

test("completion cancels an open body without waiting for EOF", async () => {
  let canceled = false
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encode(done() + "\n"))
    },
    cancel() {
      canceled = true
    },
  })
  expect((await readTravelStream(source, () => {})).response).toBe("Finished")
  expect(canceled).toBe(true)
  expect(source.locked).toBe(false)
})

test("malformed input cancels its reader and cleanup cannot hide the error", async () => {
  let canceled = false
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encode("null\n"))
    },
    cancel() {
      canceled = true
      throw new Error("cleanup failed")
    },
  })
  await expect(readTravelStream(source, () => {})).rejects.toThrow(
    "invalid event",
  )
  expect(canceled).toBe(true)
  expect(source.locked).toBe(false)
})

test("network failure is actionable while intentional abort stays an abort", async () => {
  for (const error of [
    new Error("Network failed"),
    new DOMException("Stopped", "AbortError"),
  ]) {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(error)
      },
    })
    const promise = readTravelStream(source, () => {})
    if (error.name === "AbortError") await expect(promise).rejects.toBe(error)
    else await expect(promise).rejects.toThrow("connection was interrupted")
    expect(source.locked).toBe(false)
  }
})

test("invalid UTF-8 after done is ignored at every chunk boundary", async () => {
  const terminal = encode(done() + "\n")
  const bytes = new Uint8Array([...terminal, 255, 254])
  for (let split = 0; split <= bytes.length; split++) {
    const result = await readTravelStream(
      body([bytes.slice(0, split), bytes.slice(split)]),
      () => {},
    )
    expect(result.response).toBe("Finished")
  }
  await expect(
    readTravelStream(body([new Uint8Array([255, ...terminal])]), () => {}),
  ).rejects.toThrow("interrupted")
})

test("unresolved cleanup cannot delay success or failure and releases the lock", async () => {
  for (const line of [done() + "\n", "null\n"]) {
    let finishCleanup!: () => void
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encode(line))
      },
      cancel() {
        return new Promise<void>((resolve) => {
          finishCleanup = resolve
        })
      },
    })
    const received = readTravelStream(source, () => {}).then(
      (result) => result.response,
      (error: Error) => error.message,
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const outcome = await Promise.race([
        received,
        new Promise<string>((resolve) => {
          timer = setTimeout(() => resolve("blocked on cleanup"), 100)
        }),
      ])
      expect(outcome).not.toBe("blocked on cleanup")
      expect(outcome).toContain(
        line.startsWith("null") ? "invalid event" : "Finished",
      )
      expect(source.locked).toBe(false)
    } finally {
      clearTimeout(timer)
      finishCleanup()
      await received
    }
  }
})
