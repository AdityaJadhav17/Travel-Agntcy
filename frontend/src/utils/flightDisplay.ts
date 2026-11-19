import type { FlightCard } from "@/types/travelResult"

export const formatFare = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
}).format

export function flightStops(count: number) {
  return count === 0 ? "Nonstop" : `${count} ${count === 1 ? "stop" : "stops"}`
}

export function comparableFare(flight: FlightCard, oneWay: boolean) {
  return oneWay ||
    (flight.return_flight?.departure_time && flight.return_flight.arrival_time)
    ? flight.total_usd
    : null
}

export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60)
  return [hours && `${hours}h`, minutes % 60 && `${minutes % 60}m`]
    .filter(Boolean)
    .join(" ")
}

const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

const periods = ["Early morning", "Morning", "Afternoon", "Evening"]

export function formatFlightSchedule(value: string) {
  // Read the provider's airport-local wall clock without applying the browser
  // timezone. Keep other formats verbatim when an airport-local value is unknown.
  const clock = value.trim()
  const match =
    /^(?:(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[ T])?([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec(
      clock,
    )
  if (!match)
    return {
      time: clock || "Time unavailable",
      date: null,
      dayStamp: null,
      minutes: null,
      period: null,
    }
  const [, year, month, day, hour, minute] = match
  const h = Number(hour)
  const localDate = year ? `${year}-${month}-${day}` : null
  const dayStamp = localDate ? Date.parse(`${localDate}T00:00:00Z`) : NaN
  const validDate =
    Number.isFinite(dayStamp) &&
    new Date(dayStamp).toISOString().slice(0, 10) === localDate
  return {
    time: `${h % 12 || 12}:${minute} ${h < 12 ? "AM" : "PM"}`,
    date: validDate ? `${monthNames[Number(month) - 1]} ${Number(day)}` : null,
    dayStamp: validDate ? dayStamp : null,
    minutes: h * 60 + Number(minute),
    period: periods[Math.floor(h / 6)],
  }
}

export function formatArrivalDate(
  departure: ReturnType<typeof formatFlightSchedule>,
  arrival: ReturnType<typeof formatFlightSchedule>,
) {
  if (departure.dayStamp === null || arrival.dayStamp === null)
    return arrival.date
  const days = (arrival.dayStamp - departure.dayStamp) / 86_400_000
  if (days === 0) return null
  if (days === 1) return `Next day · ${arrival.date}`
  return arrival.date
}
