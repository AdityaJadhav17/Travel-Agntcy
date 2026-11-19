import type {
  OutboundPreviewFlight,
  VerifiedFlightPreview,
} from "@/utils/travelStream"
import FlightOptionCard from "./FlightOptionCard"

function outboundKey(flight: OutboundPreviewFlight) {
  return JSON.stringify([
    flight.airline,
    flight.departure_time,
    flight.arrival_time,
    flight.stops,
  ])
}

export default function OutboundPreviewCard({
  flights,
  checked,
}: {
  flights?: OutboundPreviewFlight[] | null
  checked?: VerifiedFlightPreview | null
}) {
  const visibleFlights = checked ? [checked.outbound] : (flights ?? [])
  const byOutbound = new Map(
    visibleFlights.map((flight) => [outboundKey(flight), flight]),
  )
  return (
    <section
      aria-label={
        checked ? "First checked round trip" : "Provisional outbound flights"
      }
      className="space-y-2"
    >
      <h3
        data-trip-result-heading
        className="text-lg font-semibold tracking-tight text-travel-text"
      >
        {checked ? "First checked round trip" : "Outbound preview"}
      </h3>
      <ul className="space-y-2">
        {Array.from(byOutbound, ([key, flight]) => (
          <li key={key}>
            <FlightOptionCard
              leg={flight}
              quote={
                checked
                  ? {
                      state: "complete",
                      fare: checked.total_usd,
                      oneWay: false,
                      returned: checked.returned,
                    }
                  : { state: "pending" }
              }
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
