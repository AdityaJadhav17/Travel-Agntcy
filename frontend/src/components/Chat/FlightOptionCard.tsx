import type { FlightCard } from "@/types/travelResult"
import { flightStops, formatFare } from "@/utils/flightDisplay"

type FlightLeg = Pick<
  FlightCard,
  "airline" | "departure_time" | "arrival_time" | "stops"
>

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

function schedule(value: string) {
  // Provider schedules are airport-local. Format the supplied wall clock
  // without converting it to the browser's timezone.
  const match =
    /^(?:(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[ T])?([01]\d|2[0-3]):([0-5]\d)(?::00)?$/.exec(
      value,
    )
  if (!match) return { time: value || "Time unavailable", date: null }
  const [, , month, day, hour, minute] = match
  const h = Number(hour)
  return {
    time: `${h % 12 || 12}:${minute} ${h < 12 ? "AM" : "PM"}`,
    date: month ? `${monthNames[Number(month) - 1]} ${Number(day)}` : null,
  }
}

function LegSchedule({
  leg,
  label,
}: {
  leg: FlightLeg
  label: "Outbound" | "Return"
}) {
  const departure = schedule(leg.departure_time)
  const arrival = schedule(leg.arrival_time)
  return (
    <div className="border-t border-white/10 pt-2.5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-gray-300">
        <span>
          {label}
          {label === "Return" && leg.airline ? ` · ${leg.airline}` : ""}
        </span>
        <span>{flightStops(leg.stops)}</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-2">
        <div className="wrap-break-word">
          <span className="sr-only">Departs </span>
          <span className="font-semibold text-white tabular-nums">
            {departure.time}
          </span>
          {departure.date && (
            <span className="block text-xs text-gray-400">
              {departure.date}
            </span>
          )}
        </div>
        <span aria-hidden="true" className="text-sm text-gray-400">
          →
        </span>
        <div className="text-right wrap-break-word">
          <span className="sr-only">Arrives </span>
          <span className="font-semibold text-white tabular-nums">
            {arrival.time}
          </span>
          {arrival.date && (
            <span className="block text-xs text-gray-400">{arrival.date}</span>
          )}
        </div>
      </div>
    </div>
  )
}

type Quote =
  | { state: "pending" }
  | {
      state: "complete"
      fare: number | null
      oneWay: boolean
      returned: FlightLeg | null
    }

export default function FlightOptionCard({
  leg,
  quote,
}: {
  leg: FlightLeg
  quote: Quote
}) {
  const fare = quote.state === "complete" ? quote.fare : null
  return (
    <article className="space-y-2.5 rounded-xl border border-white/15 bg-[#252525] px-3.5 py-3 sm:px-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="min-w-0 text-sm font-semibold wrap-break-word text-white">
          {leg.airline || "Airline unavailable"}
        </h4>
        <div className="max-w-[58%] text-right">
          {quote.state === "pending" ? (
            <p className="text-xs font-medium text-amber-200">
              Return details and fare pending
            </p>
          ) : (
            <>
              <p
                className={
                  fare === null
                    ? "text-xs text-gray-300"
                    : "text-lg leading-none font-semibold text-emerald-200 tabular-nums"
                }
              >
                {fare === null ? "Fare unavailable" : formatFare(fare)}
              </p>
              <p className="mt-1 text-xs text-gray-400">
                {quote.oneWay
                  ? "One-way"
                  : quote.returned
                    ? "Round trip"
                    : "Quoted fare"}
              </p>
            </>
          )}
        </div>
      </div>
      <LegSchedule label="Outbound" leg={leg} />
      {quote.state === "complete" && quote.returned && (
        <LegSchedule label="Return" leg={quote.returned} />
      )}
      {quote.state === "complete" && !quote.oneWay && !quote.returned && (
        <p className="border-t border-white/10 pt-2.5 text-xs text-gray-300">
          Return details unavailable
        </p>
      )}
    </article>
  )
}
