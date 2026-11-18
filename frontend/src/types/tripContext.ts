import { parseTravelResult } from "./travelResult"

const searchTypes = [
  "flight_only",
  "full_trip",
  "hotel_only",
  "activity_only",
] as const
type SearchType = (typeof searchTypes)[number]

export interface TripContext {
  search_type: SearchType | null
  origin: string
  destination: string
  start_date: string
  end_date: string
  hotel_check_in_date: string
  hotel_check_out_date: string
  is_one_way: boolean | null
  adults: number | null
  children: number | null
  children_ages: number[]
}

const text = (value: unknown) =>
  typeof value === "string" ? value.trim().slice(0, 100) : ""
const date = (value: unknown) => {
  const day = text(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return ""
  const parsed = new Date(day)
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === day
    ? day
    : ""
}
const count = (value: unknown, min: number, max: number) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max
    ? value
    : null

export function parseTripContext(value: unknown): TripContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const trip = value as Record<string, unknown>
  const search_type =
    searchTypes.find((type) => type === trip.search_type) ?? null
  const origin = text(trip.origin)
  const location = text(trip.location) || text(trip.destination_city)
  const destination =
    search_type === "hotel_only" || search_type === "activity_only"
      ? location || text(trip.destination)
      : text(trip.destination) || location
  const start_date = date(trip.start_date)
  const end_date = date(trip.end_date)
  const hotel_check_in_date = date(trip.hotel_check_in_date)
  const hotel_check_out_date = date(trip.hotel_check_out_date)
  if (
    !search_type &&
    !origin &&
    !destination &&
    !start_date &&
    !end_date &&
    !hotel_check_in_date &&
    !hotel_check_out_date
  )
    return null

  const children = count(trip.children, 0, 8)
  const ages = trip.children_ages
  const children_ages =
    Array.isArray(ages) &&
    ages.length === children &&
    ages.every((age) => count(age, 0, 17) !== null)
      ? [...ages]
      : []

  return {
    search_type,
    origin,
    destination,
    start_date,
    end_date,
    hotel_check_in_date,
    hotel_check_out_date,
    is_one_way: typeof trip.is_one_way === "boolean" ? trip.is_one_way : null,
    adults: count(trip.adults, 1, 9),
    children,
    children_ages,
  }
}

export function latestTripContext(
  messages: readonly {
    role: string
    trip_state?: unknown
    travel_result?: unknown
  }[],
) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role !== "assistant") continue
    if (message.trip_state !== undefined)
      return parseTripContext(message.trip_state)
    const result = parseTravelResult(message.travel_result)
    if (
      result &&
      result.kind !== "airport_comparison" &&
      result.kind !== "date_comparison"
    )
      return parseTripContext({ ...result, search_type: result.kind })
  }
  return null
}
