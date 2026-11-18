import type { BudgetAssessment } from "../types/budget"
import { parseTravelResult, type TravelResult } from "../types/travelResult"

export interface ApiResponse {
  response: string
  session_id?: string
  conversation_id?: string
  trip_state?: Record<string, unknown>
  budget_assessment?: BudgetAssessment | null
  travel_result?: TravelResult | null
  retry_hotels?: boolean
}

export interface OutboundPreviewFlight {
  airline: string
  departure_time: string
  arrival_time: string
  stops: number
}

export interface VerifiedFlightPreview {
  outbound: OutboundPreviewFlight
  returned: OutboundPreviewFlight
  total_usd: number
}

export type TravelStreamEvent =
  | { type: "status"; component: string; message: string }
  | { type: "result"; component: string; travel_result: TravelResult }
  | { type: "outbound_preview"; flights: OutboundPreviewFlight[] }
  | { type: "verified_flight_preview"; flight: VerifiedFlightPreview }
  | { type: "error"; component: string; message: string }
  | { type: "text"; text: string }

type StreamState =
  | { phase: "pending" }
  | { phase: "completed"; result: ApiResponse }
  | { phase: "failed"; error: TravelStreamError }

export class TravelStreamError extends Error {
  constructor(
    message: string,
    options?: ErrorOptions,
    readonly retryable = true,
  ) {
    super(message, options)
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

function previewText(value: unknown, limit: number): string | null {
  if (typeof value !== "string" || value.length > limit) return null
  const text = value.trim()
  return text && !/[\p{Cc}\p{Cf}]/u.test(text) ? text : null
}

function outboundPreview(value: unknown): OutboundPreviewFlight[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3)
    return null
  const flights: OutboundPreviewFlight[] = []
  for (const item of value) {
    if (!record(item)) return null
    const airline = previewText(item.airline, 200)
    const departure_time = previewText(item.departure_time, 64)
    const arrival_time = previewText(item.arrival_time, 64)
    const stops = item.stops
    if (
      !airline ||
      !departure_time ||
      !arrival_time ||
      typeof stops !== "number" ||
      !Number.isSafeInteger(stops) ||
      stops < 0 ||
      stops > 20
    )
      return null
    flights.push({ airline, departure_time, arrival_time, stops })
  }
  return flights
}

function verifiedPreview(value: unknown): VerifiedFlightPreview | null {
  if (!record(value)) return null
  const legs = outboundPreview([value.outbound, value.returned])
  const fare = value.total_usd
  if (!legs || typeof fare !== "number" || !Number.isFinite(fare) || fare <= 0)
    return null
  return { outbound: legs[0], returned: legs[1], total_usd: fare }
}

function budget(value: unknown): BudgetAssessment | null {
  if (
    !record(value) ||
    (value.status !== "within" &&
      value.status !== "over" &&
      value.status !== "unknown") ||
    value.currency !== "USD" ||
    typeof value.limit !== "number" ||
    !Number.isFinite(value.limit) ||
    value.limit <= 0 ||
    !(
      value.quoted_total === null ||
      (typeof value.quoted_total === "number" &&
        Number.isFinite(value.quoted_total) &&
        value.quoted_total > 0)
    ) ||
    typeof value.scope !== "string" ||
    typeof value.message !== "string"
  )
    return null
  return {
    status: value.status,
    currency: "USD",
    limit: value.limit,
    quoted_total: value.quoted_total,
    scope: value.scope,
    message: value.message,
  }
}

/** Required narrative is strict; optional/future card data falls back to it. */
function result(value: unknown): ApiResponse {
  if (!record(value) || typeof value.response !== "string") {
    throw new TravelStreamError(
      "The travel service returned an invalid result. Please retry your last message.",
    )
  }
  return {
    response: value.response,
    ...(typeof value.session_id === "string"
      ? { session_id: value.session_id }
      : {}),
    ...(typeof value.conversation_id === "string"
      ? { conversation_id: value.conversation_id }
      : {}),
    ...(record(value.trip_state) ? { trip_state: value.trip_state } : {}),
    budget_assessment: budget(value.budget_assessment),
    travel_result: parseTravelResult(value.travel_result),
    ...(typeof value.retry_hotels === "boolean"
      ? { retry_hotels: value.retry_hotels }
      : {}),
  }
}

/** First terminal event wins. No later event can publish or replace the answer.
 * Unknown named events and unsupported partial cards are ignored for compatibility.
 */
export class TravelStream {
  private state: StreamState = { phase: "pending" }

  get pending(): boolean {
    return this.state.phase === "pending"
  }

  accept(line: string, onEvent: (event: TravelStreamEvent) => void): void {
    if (!this.pending || !line.trim()) return
    try {
      let event: unknown
      try {
        event = JSON.parse(line)
      } catch {
        throw new TravelStreamError(
          "The travel service sent unreadable data. Please retry your last message.",
        )
      }
      if (!record(event) || typeof event.type !== "string" || !event.type) {
        throw new TravelStreamError(
          "The travel service sent an invalid event. Please retry your last message.",
        )
      }
      switch (event.type) {
        case "done":
          this.state = { phase: "completed", result: result(event.result) }
          break
        case "text":
          if (typeof event.text !== "string") throw this.invalidEvent()
          onEvent({ type: "text", text: event.text })
          break
        case "status":
        case "error":
          if (
            typeof event.component !== "string" ||
            !event.component.trim() ||
            typeof event.message !== "string"
          )
            throw this.invalidEvent()
          if (event.type === "error" && event.component === "request") {
            this.state = {
              phase: "failed",
              error: new TravelStreamError(
                event.message ||
                  "Travel search failed. Please retry your last message.",
                undefined,
                false,
              ),
            }
          } else {
            onEvent({
              type: event.type,
              component: event.component,
              message: event.message,
            })
          }
          break
        case "result": {
          if (typeof event.component !== "string" || !event.component.trim())
            throw this.invalidEvent()
          const partial = parseTravelResult(event.travel_result)
          if (partial)
            onEvent({
              type: "result",
              component: event.component,
              travel_result: partial,
            })
          break
        }
        case "outbound_preview": {
          const flights = outboundPreview(event.flights)
          if (flights) onEvent({ type: "outbound_preview", flights })
          break
        }
        case "verified_flight_preview": {
          const flight = verifiedPreview(event.flight)
          if (flight) onEvent({ type: "verified_flight_preview", flight })
          break
        }
      }
    } catch (error) {
      if (error instanceof TravelStreamError)
        this.state = { phase: "failed", error }
      throw error
    }
  }

  finish(): ApiResponse {
    if (this.state.phase === "pending") {
      this.state = {
        phase: "failed",
        error: new TravelStreamError(
          "The travel connection ended before sending a complete result. Please retry your last message.",
        ),
      }
    }
    if (this.state.phase === "failed") throw this.state.error
    return this.state.result
  }

  private invalidEvent(): TravelStreamError {
    return new TravelStreamError(
      "The travel service sent an invalid event. Please retry your last message.",
    )
  }
}

/** NDJSON framing is independent of chunk boundaries, including UTF-8 characters.
 * Completion does not wait for EOF; cancellation releases a lingering response.
 */
export async function readTravelStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: TravelStreamEvent) => void,
): Promise<ApiResponse> {
  const reader = body.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  const stream = new TravelStream()
  let buffer = ""
  try {
    while (stream.pending) {
      const { value, done } = await reader.read()
      // Decode only through the next record boundary. Trailing bytes cannot
      // invalidate a terminal record even when they share a network chunk.
      let offset = 0
      while (value && offset < value.length && stream.pending) {
        const newline = value.indexOf(10, offset)
        const end = newline === -1 ? value.length : newline + 1
        buffer += decoder.decode(value.subarray(offset, end), { stream: true })
        offset = end
        if (newline !== -1) {
          stream.accept(buffer, onEvent)
          buffer = ""
        }
      }
      if (done) {
        if (stream.pending) {
          buffer += decoder.decode()
          if (buffer.trim()) stream.accept(buffer, onEvent)
        }
        break
      }
    }
    return stream.finish()
  } catch (error) {
    if (
      error instanceof TravelStreamError ||
      (error instanceof Error && error.name === "AbortError")
    )
      throw error
    throw new TravelStreamError(
      "The travel connection was interrupted. Please retry your last message.",
      { cause: error },
    )
  } finally {
    // Cleanup failure must not overwrite a valid result or the original error.
    try {
      void reader.cancel().catch(() => {})
    } catch {
      /* Already errored or aborted. */
    }
    reader.releaseLock()
  }
}
