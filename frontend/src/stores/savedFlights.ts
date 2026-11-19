import {
  isFlightLeg,
  type FlightCard,
  type FlightLeg,
  type TravelResult,
} from "@/types/travelResult"

export interface SavedFlight {
  id: string
  origin: string
  destination: string
  departureDate: string
  returnDate: string
  adults: number
  children: number
  outbound: FlightLeg
  returned: FlightLeg | null
  fare: number
  priceScope: FlightCard["price_scope"]
  checkedAt: string
}

function copyLeg(leg: FlightLeg): FlightLeg {
  return {
    airline: leg.airline,
    departure_time: leg.departure_time,
    arrival_time: leg.arrival_time,
    stops: leg.stops,
    duration_minutes: leg.duration_minutes,
    connections: leg.connections,
    arrival_airport: leg.arrival_airport,
  }
}

function departureDay(leg: FlightLeg | null, fallback: string) {
  return (
    /^\d{4}-\d{2}-\d{2}(?=[ T])/.exec(leg?.departure_time ?? "")?.[0] ??
    fallback
  )
}

export function createSavedFlight(
  result: TravelResult,
  flight: FlightCard,
  {
    destination = flight.arrival_airport ||
      result.destination_airport ||
      result.destination,
    fare = flight.total_usd,
    departureDate = result.start_date,
    returnDate = result.end_date,
  }: {
    destination?: string
    fare?: number | null
    departureDate?: string
    returnDate?: string
  } = {},
): SavedFlight | null {
  const quote = {
    origin: result.origin_airport || result.origin,
    destination,
    departureDate: departureDay(flight, departureDate),
    returnDate: result.is_one_way
      ? ""
      : departureDay(flight.return_flight, returnDate),
    adults: result.adults,
    children: result.children,
    outbound: copyLeg(flight),
    returned: result.is_one_way ? null : flight.return_flight,
    fare,
    priceScope: fare === flight.total_usd ? (flight.price_scope ?? null) : null,
    checkedAt: result.searched_at,
  }
  if (!isSavedQuote(quote) || (!result.is_one_way && !quote.returned))
    return null

  const snapshot = {
    ...quote,
    returned: quote.returned ? copyLeg(quote.returned) : null,
  }
  return {
    ...snapshot,
    id: JSON.stringify([
      flight.id,
      snapshot.origin,
      snapshot.destination,
      snapshot.departureDate,
      snapshot.returnDate,
      snapshot.checkedAt,
      snapshot.fare,
      snapshot.priceScope,
    ]),
  }
}

type SavedQuote = Omit<SavedFlight, "id">

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function isLeg(value: unknown): value is FlightLeg {
  return (
    isFlightLeg(value) &&
    [value.airline, value.departure_time, value.arrival_time].every(
      (field) =>
        hasText(field) &&
        !/^(?:not supplied|unavailable|unknown|n\/?a)$/i.test(field.trim()),
    )
  )
}

function isSavedQuote(value: unknown): value is SavedQuote {
  return (
    isRecord(value) &&
    hasText(value.origin) &&
    hasText(value.destination) &&
    typeof value.departureDate === "string" &&
    typeof value.returnDate === "string" &&
    isCount(value.adults) &&
    value.adults > 0 &&
    isCount(value.children) &&
    isLeg(value.outbound) &&
    (value.returned === null || isLeg(value.returned)) &&
    typeof value.fare === "number" &&
    Number.isFinite(value.fare) &&
    value.fare > 0 &&
    (value.priceScope === null ||
      value.priceScope === "per_traveler" ||
      value.priceScope === "requested_party") &&
    hasText(value.checkedAt) &&
    Number.isFinite(Date.parse(value.checkedAt))
  )
}

export function savedFlightsKey(tripId: string) {
  return `travel_saved_flights_v1:${tripId}`
}

export function readSavedFlights(tripId: string): SavedFlight[] {
  const saved = localStorage.getItem(savedFlightsKey(tripId))
  let value: unknown
  try {
    value = JSON.parse(saved || "[]")
  } catch {
    return []
  }
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is SavedFlight =>
          isRecord(entry) && hasText(entry.id) && isSavedQuote(entry),
      )
    : []
}

export function writeSavedFlights(tripId: string, flights: SavedFlight[]) {
  const key = savedFlightsKey(tripId)
  if (flights.length) localStorage.setItem(key, JSON.stringify(flights))
  else localStorage.removeItem(key)
}

export function clearSavedFlights(tripId: string) {
  try {
    localStorage.removeItem(savedFlightsKey(tripId))
  } catch {
    // Trip deletion can succeed even if browser storage is inaccessible.
  }
}
