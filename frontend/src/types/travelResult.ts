export interface FlightCard {
  id: string
  airline: string
  total_usd: number | null
  departure_time: string
  arrival_time: string
  stops: number
  return_flight: {
    airline: string
    departure_time: string
    arrival_time: string
    stops: number
  } | null
}

export interface HotelCard {
  id: string
  name: string
  nightly_usd: number | null
  total_usd: number | null
  overall_rating: number | null
  location_rating: number | null
}

export interface ActivityCard {
  id: string
  name: string
  type: string
  rating: number | null
}

export interface TravelResult {
  version: 1
  kind: "full_trip" | "flight_only" | "hotel_only" | "activity_only"
  searched_at: string
  origin: string
  destination: string
  start_date: string
  end_date: string
  adults: number
  children: number
  rooms: number
  is_one_way: boolean
  flights: FlightCard[]
  hotels: HotelCard[]
  activities: ActivityCard[]
  total_usd: number | null
  notice: string
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const text = (value: unknown): value is string => typeof value === "string"

const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0

const price = (value: unknown): value is number | null =>
  value === null ||
  (typeof value === "number" && Number.isFinite(value) && value > 0)

const rating = (value: unknown): value is number | null =>
  value === null ||
  (typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 5)

const flight = (value: unknown): value is FlightCard => {
  if (!record(value)) return false
  const returned = value.return_flight
  return (
    text(value.id) &&
    text(value.airline) &&
    price(value.total_usd) &&
    text(value.departure_time) &&
    text(value.arrival_time) &&
    count(value.stops) &&
    (returned === null ||
      (record(returned) &&
        text(returned.airline) &&
        text(returned.departure_time) &&
        text(returned.arrival_time) &&
        count(returned.stops)))
  )
}

const hotel = (value: unknown): value is HotelCard => {
  if (!record(value)) return false
  return (
    text(value.id) &&
    text(value.name) &&
    price(value.nightly_usd) &&
    price(value.total_usd) &&
    rating(value.overall_rating) &&
    rating(value.location_rating)
  )
}

const activity = (value: unknown): value is ActivityCard => {
  if (!record(value)) return false
  return (
    text(value.id) &&
    text(value.name) &&
    text(value.type) &&
    rating(value.rating)
  )
}

/** Unknown versions and malformed saved data use the existing text renderer. */
export function parseTravelResult(value: unknown): TravelResult | null {
  if (!record(value) || value.version !== 1) return null
  if (
    value.kind !== "full_trip" &&
    value.kind !== "flight_only" &&
    value.kind !== "hotel_only" &&
    value.kind !== "activity_only"
  )
    return null
  if (
    !text(value.searched_at) ||
    !text(value.origin) ||
    !text(value.destination) ||
    !text(value.start_date) ||
    !text(value.end_date) ||
    !count(value.adults) ||
    value.adults < 1 ||
    !count(value.children) ||
    !count(value.rooms) ||
    value.rooms < 1 ||
    typeof value.is_one_way !== "boolean" ||
    !price(value.total_usd) ||
    !text(value.notice)
  )
    return null
  if (
    !Array.isArray(value.flights) ||
    value.flights.length > 5 ||
    !value.flights.every(flight) ||
    !Array.isArray(value.hotels) ||
    value.hotels.length > 5 ||
    !value.hotels.every(hotel) ||
    !Array.isArray(value.activities) ||
    value.activities.length > 5 ||
    !value.activities.every(activity)
  )
    return null
  if (
    (value.kind === "full_trip" &&
      (!value.flights.length || !value.hotels.length)) ||
    (value.kind === "flight_only" && !value.flights.length) ||
    (value.kind === "hotel_only" && !value.hotels.length) ||
    (value.kind === "activity_only" && !value.activities.length)
  )
    return null
  return value as unknown as TravelResult
}
