export interface FlightLeg {
  airline: string
  departure_time: string
  arrival_time: string
  stops: number
  duration_minutes?: number | null
  arrival_airport?: string | null
  connections?: { airport: string; duration_minutes?: number | null }[]
}

export interface FlightCard extends FlightLeg {
  id: string
  total_usd: number | null
  price_scope?: "requested_party" | "per_traveler" | null
  return_flight: FlightLeg | null
}

export interface HotelCard {
  id: string
  name: string
  nightly_usd: number | null
  total_usd: number | null
  overall_rating: number | null
  location_rating: number | null
  property_type?: string | null
  room_type?: string | null
  accommodation_evidence_source?: string | null
  accommodation_status?: "matched" | "contradicted" | "unknown"
  accommodation_reasons?: string[]
  accommodation_evidence?: {
    property_type: string | null
    room_type: string | null
    source: string | null
  } | null
  check_in_date?: string | null
  check_out_date?: string | null
  timing_status?: "compatible" | "incompatible" | "needs_confirmation" | null
  timing_reason_codes?: string[]
  timing_message?: string
  arrival_at_hotel?: string | null
  provisional?: boolean
}

export interface ActivityCard {
  id: string
  name: string
  type: string
  rating: number | null
}

export interface AirportAlternativeCard {
  arrival_airport: string
  airport_name: string
  municipality: string
  straight_line_miles: number
  driving_miles: number | null
  driving_minutes: number | null
  fare_usd: number
  savings_usd: number | null
  flight: FlightCard
}

export interface DateAlternativeCard {
  departure_date: string
  return_date: string
  fare_usd: number
  savings_usd: number | null
  flight: FlightCard
}

export interface TravelResult {
  version: 1
  kind:
    | "full_trip"
    | "flight_only"
    | "hotel_only"
    | "activity_only"
    | "airport_comparison"
    | "date_comparison"
  searched_at: string
  origin: string
  destination: string
  origin_airport?: string | null
  destination_airport?: string | null
  origin_city?: string | null
  destination_city?: string | null
  start_date: string
  end_date: string
  hotel_check_in_date?: string | null
  hotel_check_out_date?: string | null
  flight_result_count?: number | null
  hotel_result_count?: number | null
  activity_result_count?: number | null
  departure_period_legs?: ("outbound" | "return")[]
  adults: number
  children: number
  rooms: number
  is_one_way: boolean
  flights: FlightCard[]
  incomplete_flights?: FlightCard[]
  incomplete_flight_count?: number
  hotels: HotelCard[]
  activities: ActivityCard[]
  requested_airport?: string
  requested_fare_usd?: number | null
  airport_alternatives?: AirportAlternativeCard[]
  base_fare_usd?: number | null
  date_alternatives?: DateAlternativeCard[]
  total_usd: number | null
  notice: string
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const text = (value: unknown): value is string => typeof value === "string"

const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0

const requestedCount = (value: unknown): value is number | null | undefined =>
  value === undefined ||
  value === null ||
  (typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 100)

const price = (value: unknown): value is number | null =>
  value === null ||
  (typeof value === "number" && Number.isFinite(value) && value > 0)

const rating = (value: unknown): value is number | null =>
  value === null ||
  (typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 5)

const duration = (value: unknown) =>
  value == null || (count(value) && value > 0 && value <= 4320)

const airportCode = (value: unknown) => text(value) && /^[A-Z]{3}$/.test(value)

export const isFlightLeg = (value: unknown): value is FlightLeg =>
  record(value) &&
  text(value.airline) &&
  text(value.departure_time) &&
  text(value.arrival_time) &&
  count(value.stops) &&
  duration(value.duration_minutes) &&
  (value.arrival_airport == null || airportCode(value.arrival_airport)) &&
  (value.connections === undefined ||
    (Array.isArray(value.connections) &&
      value.connections.length <= 10 &&
      value.connections.every(
        (item) =>
          record(item) &&
          airportCode(item.airport) &&
          duration(item.duration_minutes),
      )))

const flight = (value: unknown): value is FlightCard => {
  if (!record(value)) return false
  const returned = value.return_flight
  return (
    text(value.id) &&
    isFlightLeg(value) &&
    price(value.total_usd) &&
    (value.price_scope == null ||
      value.price_scope === "requested_party" ||
      value.price_scope === "per_traveler") &&
    (returned === null || isFlightLeg(returned))
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
    rating(value.location_rating) &&
    (value.property_type === undefined ||
      value.property_type === null ||
      text(value.property_type)) &&
    (value.room_type === undefined ||
      value.room_type === null ||
      text(value.room_type)) &&
    (value.accommodation_evidence_source === undefined ||
      value.accommodation_evidence_source === null ||
      text(value.accommodation_evidence_source)) &&
    (value.accommodation_status === undefined ||
      value.accommodation_status === "matched" ||
      value.accommodation_status === "contradicted" ||
      value.accommodation_status === "unknown") &&
    (value.accommodation_reasons === undefined ||
      (Array.isArray(value.accommodation_reasons) &&
        value.accommodation_reasons.length <= 5 &&
        value.accommodation_reasons.every(text))) &&
    (value.accommodation_evidence === undefined ||
      value.accommodation_evidence === null ||
      (record(value.accommodation_evidence) &&
        (value.accommodation_evidence.property_type === null ||
          text(value.accommodation_evidence.property_type)) &&
        (value.accommodation_evidence.room_type === null ||
          text(value.accommodation_evidence.room_type)) &&
        (value.accommodation_evidence.source === null ||
          text(value.accommodation_evidence.source)))) &&
    (value.check_in_date === undefined ||
      value.check_in_date === null ||
      (text(value.check_in_date) &&
        /^\d{4}-\d{2}-\d{2}$/.test(value.check_in_date))) &&
    (value.check_out_date === undefined ||
      value.check_out_date === null ||
      (text(value.check_out_date) &&
        /^\d{4}-\d{2}-\d{2}$/.test(value.check_out_date))) &&
    (value.timing_status === undefined ||
      value.timing_status === null ||
      value.timing_status === "compatible" ||
      value.timing_status === "incompatible" ||
      value.timing_status === "needs_confirmation") &&
    (value.timing_reason_codes === undefined ||
      (Array.isArray(value.timing_reason_codes) &&
        value.timing_reason_codes.length <= 8 &&
        value.timing_reason_codes.every(text))) &&
    (value.timing_message === undefined || text(value.timing_message)) &&
    (value.arrival_at_hotel === undefined ||
      value.arrival_at_hotel === null ||
      text(value.arrival_at_hotel)) &&
    (value.provisional === undefined || typeof value.provisional === "boolean")
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

const airportAlternative = (
  value: unknown,
): value is AirportAlternativeCard => {
  if (!record(value)) return false
  const hasDriving = value.driving_miles !== null
  return (
    text(value.arrival_airport) &&
    /^[A-Z]{3}$/.test(value.arrival_airport) &&
    text(value.airport_name) &&
    text(value.municipality) &&
    count(value.straight_line_miles) &&
    (value.driving_miles === null || price(value.driving_miles)) &&
    (value.driving_minutes === null || count(value.driving_minutes)) &&
    hasDriving === (value.driving_minutes !== null) &&
    typeof value.fare_usd === "number" &&
    price(value.fare_usd) &&
    (value.savings_usd === null ||
      (typeof value.savings_usd === "number" &&
        Number.isFinite(value.savings_usd))) &&
    flight(value.flight)
  )
}

const dateAlternative = (value: unknown): value is DateAlternativeCard => {
  if (!record(value)) return false
  return (
    text(value.departure_date) &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.departure_date) &&
    text(value.return_date) &&
    (value.return_date === "" ||
      /^\d{4}-\d{2}-\d{2}$/.test(value.return_date)) &&
    typeof value.fare_usd === "number" &&
    price(value.fare_usd) &&
    (value.savings_usd === null ||
      (typeof value.savings_usd === "number" &&
        Number.isFinite(value.savings_usd))) &&
    flight(value.flight)
  )
}

/** Unknown versions and malformed saved data use the existing text renderer. */
export function parseTravelResult(value: unknown): TravelResult | null {
  if (!record(value) || value.version !== 1) return null
  if (
    value.kind !== "full_trip" &&
    value.kind !== "flight_only" &&
    value.kind !== "hotel_only" &&
    value.kind !== "activity_only" &&
    value.kind !== "airport_comparison" &&
    value.kind !== "date_comparison"
  )
    return null
  if (
    !text(value.searched_at) ||
    !text(value.origin) ||
    !text(value.destination) ||
    ![value.origin_airport, value.destination_airport].every(
      (code) => code == null || (text(code) && /^[A-Z]{3}$/.test(code)),
    ) ||
    ![value.origin_city, value.destination_city].every(
      (city) => city == null || text(city),
    ) ||
    !text(value.start_date) ||
    !text(value.end_date) ||
    !count(value.adults) ||
    value.adults < 1 ||
    !count(value.children) ||
    !count(value.rooms) ||
    value.rooms < 1 ||
    typeof value.is_one_way !== "boolean" ||
    !price(value.total_usd) ||
    !text(value.notice) ||
    !requestedCount(value.flight_result_count) ||
    !requestedCount(value.hotel_result_count) ||
    !requestedCount(value.activity_result_count) ||
    (value.departure_period_legs !== undefined &&
      (!Array.isArray(value.departure_period_legs) ||
        value.departure_period_legs.length > 2 ||
        !value.departure_period_legs.every(
          (leg) => leg === "outbound" || leg === "return",
        ))) ||
    !(
      value.hotel_check_in_date === undefined ||
      value.hotel_check_in_date === null ||
      (text(value.hotel_check_in_date) &&
        /^\d{4}-\d{2}-\d{2}$/.test(value.hotel_check_in_date))
    ) ||
    !(
      value.hotel_check_out_date === undefined ||
      value.hotel_check_out_date === null ||
      (text(value.hotel_check_out_date) &&
        /^\d{4}-\d{2}-\d{2}$/.test(value.hotel_check_out_date))
    )
  )
    return null
  if (
    !Array.isArray(value.flights) ||
    value.flights.length > 5 ||
    !value.flights.every(flight) ||
    (value.incomplete_flights !== undefined &&
      (!Array.isArray(value.incomplete_flights) ||
        value.incomplete_flights.length > 5 ||
        !value.incomplete_flights.every(flight))) ||
    (value.incomplete_flight_count !== undefined &&
      (!count(value.incomplete_flight_count) ||
        value.incomplete_flight_count <
          (Array.isArray(value.incomplete_flights)
            ? value.incomplete_flights.length
            : 0))) ||
    !Array.isArray(value.hotels) ||
    value.hotels.length > 5 ||
    !value.hotels.every(hotel) ||
    !Array.isArray(value.activities) ||
    value.activities.length > 5 ||
    !value.activities.every(activity)
  )
    return null
  const hasFlights =
    value.flights.length ||
    (Array.isArray(value.incomplete_flights) && value.incomplete_flights.length)
  if (
    (value.kind === "full_trip" && (!hasFlights || !value.hotels.length)) ||
    (value.kind === "flight_only" && !hasFlights) ||
    (value.kind === "hotel_only" && !value.hotels.length) ||
    (value.kind === "activity_only" && !value.activities.length)
  )
    return null
  if (
    value.kind === "airport_comparison" &&
    (!text(value.requested_airport) ||
      !/^[A-Z]{3}$/.test(value.requested_airport) ||
      !price(value.requested_fare_usd) ||
      !Array.isArray(value.airport_alternatives) ||
      value.airport_alternatives.length < 1 ||
      value.airport_alternatives.length > 7 ||
      !value.airport_alternatives.every(airportAlternative))
  )
    return null
  if (
    value.kind === "date_comparison" &&
    (!price(value.base_fare_usd) ||
      !Array.isArray(value.date_alternatives) ||
      value.date_alternatives.length < 1 ||
      value.date_alternatives.length > 7 ||
      !value.date_alternatives.every(dateAlternative))
  )
    return null
  return value as unknown as TravelResult
}
