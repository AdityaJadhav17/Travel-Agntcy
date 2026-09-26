import type { TravelResult } from "@/types/travelResult"

const usd = (value: number | null) =>
  value === null
    ? "Price unavailable"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(value)

const stops = (count: number) =>
  count === 0 ? "Nonstop" : `${count} stop${count === 1 ? "" : "s"}`

export default function StructuredTravelResultCard({
  result,
}: {
  result: TravelResult
}) {
  const heading = {
    full_trip: "Your trip",
    flight_only: "Flights",
    hotel_only: "Hotels",
    activity_only: "Things to do",
    airport_comparison: "Nearby arrival airports",
  }[result.kind]

  return (
    <section aria-label="Travel results" className="space-y-4">
      <header className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4">
        <h3 className="text-lg font-semibold text-white">{heading}</h3>
        <p className="text-sm text-gray-300">
          {[result.origin, result.destination].filter(Boolean).join(" → ")}
          {result.start_date && ` · ${result.start_date}`}
          {result.end_date && ` to ${result.end_date}`}
        </p>
        <p className="text-sm text-gray-300">
          {result.adults} adult{result.adults === 1 ? "" : "s"},{" "}
          {result.children} child{result.children === 1 ? "" : "ren"}
          {result.kind !== "flight_only" &&
            result.kind !== "activity_only" &&
            ` · ${result.rooms} room${result.rooms === 1 ? "" : "s"}`}
        </p>
        {result.total_usd !== null && (
          <p className="mt-2 font-semibold text-emerald-200">
            Quoted flight + full hotel stay: {usd(result.total_usd)}
          </p>
        )}
      </header>
      {result.notice && (
        <p className="rounded-xl border border-blue-500/40 bg-blue-500/10 p-4 text-sm text-blue-100">
          {result.notice}
        </p>
      )}
      {result.flights.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-semibold text-white">Flights</h4>
          {result.flights.map((flight) => (
            <article
              key={flight.id}
              className="rounded-xl border border-gray-700 bg-[#252525] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h5 className="font-semibold text-white">{flight.airline}</h5>
                <p className="font-semibold text-emerald-200">
                  {flight.total_usd === null
                    ? "Price unavailable"
                    : `${usd(flight.total_usd)} fare`}
                </p>
              </div>
              <p className="text-sm text-gray-300">
                Outbound: {flight.departure_time} → {flight.arrival_time} ·{" "}
                {stops(flight.stops)}
              </p>
              {flight.return_flight && (
                <p className="text-sm text-gray-300">
                  Return: {flight.return_flight.airline} ·{" "}
                  {flight.return_flight.departure_time} →{" "}
                  {flight.return_flight.arrival_time} ·{" "}
                  {stops(flight.return_flight.stops)}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
      {result.kind === "airport_comparison" && (
        <div className="space-y-2">
          <p className="text-sm text-gray-200">
            Requested airport: {result.requested_airport} · Current airfare:{" "}
            {usd(result.requested_fare_usd ?? null)}
          </p>
          {result.airport_alternatives?.map((option) => (
            <article
              key={option.arrival_airport}
              className="rounded-xl border border-gray-700 bg-[#252525] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h4 className="font-semibold text-white">
                  {option.arrival_airport} · {option.municipality}
                </h4>
                <p className="font-semibold text-emerald-200">
                  {usd(option.fare_usd)} airfare
                </p>
              </div>
              <p className="text-sm text-gray-300">{option.airport_name}</p>
              <p className="mt-1 text-sm text-gray-200">
                {option.driving_miles !== null
                  ? `${option.driving_miles} driving miles · about ${option.driving_minutes} minutes to ${result.destination}`
                  : `${option.straight_line_miles} straight-line miles to ${result.requested_airport} airport; driving distance unavailable`}
              </p>
              {option.savings_usd !== null && option.savings_usd > 0 && (
                <p className="text-sm text-emerald-200">
                  {usd(option.savings_usd)} lower airfare than{" "}
                  {result.requested_airport}
                </p>
              )}
              <p className="mt-1 text-xs text-gray-400">
                {option.flight.airline} · {stops(option.flight.stops)} ·{" "}
                {option.flight.departure_time} → {option.flight.arrival_time}
              </p>
            </article>
          ))}
        </div>
      )}
      {result.hotels.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-semibold text-white">Hotels</h4>
          {result.hotels.map((hotel) => (
            <article
              key={hotel.id}
              className="rounded-xl border border-gray-700 bg-[#252525] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h5 className="font-semibold text-white">{hotel.name}</h5>
                <p className="font-semibold text-emerald-200">
                  {hotel.total_usd === null
                    ? "Price unavailable"
                    : `${usd(hotel.total_usd)} full stay`}
                </p>
              </div>
              <p className="text-sm text-gray-300">
                {hotel.nightly_usd !== null &&
                  `${usd(hotel.nightly_usd)} nightly · `}
                {hotel.overall_rating !== null &&
                  `Rating ${hotel.overall_rating}/5`}
                {hotel.overall_rating !== null &&
                  hotel.location_rating !== null &&
                  " · "}
                {hotel.location_rating !== null &&
                  `Location ${hotel.location_rating}/5`}
              </p>
            </article>
          ))}
        </div>
      )}
      {result.activities.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-semibold text-white">Things to do</h4>
          {result.activities.map((activity) => (
            <article
              key={activity.id}
              className="rounded-xl border border-gray-700 bg-[#252525] p-3 text-sm text-gray-200"
            >
              <span className="font-semibold text-white">{activity.name}</span>
              {activity.type && ` · ${activity.type}`}
              {activity.rating !== null && ` · ${activity.rating}/5`}
            </article>
          ))}
        </div>
      )}
      <p className="text-xs text-gray-400">
        Provider quotes can change. Confirm availability, occupancy, fees and
        final prices before booking.
      </p>
    </section>
  )
}
