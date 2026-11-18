import type { OutboundPreviewFlight } from "@/utils/travelStream"
import FlightOptionCard from "./FlightOptionCard"

export default function OutboundPreviewCard({
  flights,
}: {
  flights: OutboundPreviewFlight[]
}) {
  return (
    <section aria-label="Provisional outbound flights" className="space-y-3">
      <h3 className="text-lg font-semibold tracking-tight text-white">
        Outbound preview
      </h3>
      <ul className="space-y-2">
        {flights.map((flight, index) => (
          <li key={index}>
            <FlightOptionCard leg={flight} quote={{ state: "pending" }} />
          </li>
        ))}
      </ul>
    </section>
  )
}
