import type { OutboundPreviewFlight } from "@/utils/travelStream"

export default function OutboundPreviewCard({
  flights,
}: {
  flights: OutboundPreviewFlight[]
}) {
  return (
    <section
      aria-label="Provisional outbound flights"
      className="space-y-2 rounded-xl border border-amber-300/30 bg-amber-300/5 p-4"
    >
      <h3 className="font-semibold text-amber-100">
        Provisional outbound flights
      </h3>
      <p className="text-sm text-gray-300">
        Still searching for return flights.
      </p>
      <ul className="space-y-2">
        {flights.map((flight, index) => (
          <li
            key={index}
            className="rounded-xl border border-gray-700 bg-[#252525] p-3"
          >
            <h4 className="font-semibold text-white">{flight.airline}</h4>
            <p className="text-sm text-gray-300">
              {flight.departure_time} → {flight.arrival_time} ·{" "}
              {flight.stops === 0
                ? "Nonstop"
                : `${flight.stops} stop${flight.stops === 1 ? "" : "s"}`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
