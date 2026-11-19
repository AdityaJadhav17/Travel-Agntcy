import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { Bookmark } from "lucide-react"
import {
  createSavedFlight,
  readSavedFlights,
  savedFlightsKey,
  writeSavedFlights,
  type SavedFlight,
} from "@/stores/savedFlights"
import type { FlightCard, TravelResult } from "@/types/travelResult"
import { formatTripDates } from "@/types/tripContext"
import { formatFare } from "@/utils/flightDisplay"
import { FlightConnections, LegSchedule } from "./FlightOptionCard"

const SavedFlightsContext = createContext<{
  flights: SavedFlight[]
  status: string
  error: boolean
  save: (flight: SavedFlight) => void
  remove: (id: string) => void
} | null>(null)

function loadFlights(tripId: string | null) {
  try {
    return tripId ? readSavedFlights(tripId) : []
  } catch {
    return []
  }
}

export function SavedFlightsProvider({
  tripId,
  children,
}: {
  tripId: string | null
  children: ReactNode
}) {
  const [stored, setStored] = useState(() => ({
    tripId,
    flights: loadFlights(tripId),
    status: "",
    error: false,
  }))
  if (stored.tripId !== tripId) {
    setStored({
      tripId,
      flights: loadFlights(tripId),
      status: "",
      error: false,
    })
  }

  useEffect(() => {
    if (!tripId) return
    const sync = (event: StorageEvent) => {
      if (event.key !== null && event.key !== savedFlightsKey(tripId)) return
      try {
        const flights = readSavedFlights(tripId)
        setStored({ tripId, flights, status: "", error: false })
      } catch {
        setStored((current) => ({
          ...current,
          status: "Could not load saved flights from this browser.",
          error: true,
        }))
      }
    }
    window.addEventListener("storage", sync)
    return () => window.removeEventListener("storage", sync)
  }, [tripId])

  function update(
    change: (stored: SavedFlight[]) => SavedFlight[],
    success: string,
  ) {
    if (!tripId) return
    try {
      const updated = change(readSavedFlights(tripId))
      writeSavedFlights(tripId, updated)
      setStored({ tripId, flights: updated, status: success, error: false })
    } catch {
      setStored((current) => ({
        ...current,
        status: "Could not update saved flights in this browser.",
        error: true,
      }))
    }
  }

  return (
    <SavedFlightsContext.Provider
      value={
        tripId && stored.tripId === tripId
          ? {
              flights: stored.flights,
              status: stored.status,
              error: stored.error,
              save: (flight) =>
                update(
                  (stored) =>
                    stored.some(({ id }) => id === flight.id)
                      ? stored
                      : [flight, ...stored],
                  "Flight saved to this trip.",
                ),
              remove: (flightId) =>
                update(
                  (stored) => stored.filter(({ id }) => id !== flightId),
                  "Flight removed from saved flights.",
                ),
            }
          : null
      }
    >
      {children}
    </SavedFlightsContext.Provider>
  )
}

const actionClasses =
  "inline-flex min-h-10 items-center gap-2 rounded-lg border border-travel-control px-3 text-sm font-medium text-travel-text hover:bg-travel-selected focus-visible:outline-2 focus-visible:outline-travel-accent"

export function SaveFlightButton({
  result,
  flight,
  destination,
  fare,
  departureDate,
  returnDate,
}: {
  result: TravelResult
  flight: FlightCard
  destination?: string
  fare?: number | null
  departureDate?: string
  returnDate?: string
}) {
  const saved = useContext(SavedFlightsContext)
  if (!saved) return null

  const snapshot = createSavedFlight(result, flight, {
    destination,
    fare,
    departureDate,
    returnDate,
  })
  if (!snapshot) return null

  const isSaved = saved.flights.some(({ id }) => id === snapshot.id)
  return (
    <button
      type="button"
      onClick={() => {
        if (isSaved) saved.remove(snapshot.id)
        else saved.save(snapshot)
      }}
      className={actionClasses}
    >
      <Bookmark
        aria-hidden="true"
        className={isSaved ? "size-4 fill-current" : "size-4"}
      />
      {isSaved ? "Unsave option" : "Save option"}
    </button>
  )
}

const checkedDate = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
})

export function SavedFlightsPanel() {
  const saved = useContext(SavedFlightsContext)
  if (!saved) return null

  const status = (
    <p
      aria-live="polite"
      className={
        saved.error ? "px-3 py-2 text-sm text-travel-warning" : "sr-only"
      }
    >
      {saved.status}
    </p>
  )
  if (!saved.flights.length) return status
  return (
    <div className="mx-auto w-full max-w-[928px] px-4 pt-2 sm:px-6">
      {status}
      <details className="rounded-lg border border-travel-border bg-travel-surface">
        <summary className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium text-travel-text hover:bg-travel-selected focus-visible:outline-2 focus-visible:outline-travel-accent">
          Saved flights ({saved.flights.length})
        </summary>
        <section
          aria-label="Saved flights"
          className="max-h-[40dvh] space-y-2 overflow-y-auto border-t border-travel-border p-3"
        >
          <p className="text-xs text-travel-muted">
            Saved quotes can change in price or availability.
          </p>
          {saved.flights.map((flight) => (
            <article
              key={flight.id}
              className="space-y-3 rounded-lg border border-travel-border p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div>
                  <h3 className="text-sm font-semibold text-travel-text">
                    {flight.origin} → {flight.destination}
                  </h3>
                  <p className="text-xs text-travel-muted">
                    {[
                      formatTripDates(flight.departureDate, flight.returnDate),
                      flight.returned ? "Round trip" : "One-way",
                      `${flight.adults + flight.children} ${flight.adults + flight.children === 1 ? "traveler" : "travelers"}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="text-sm text-travel-text">
                  <span className="font-semibold">
                    Quoted {formatFare(flight.fare)}
                  </span>
                  {" · "}
                  {flight.priceScope === "requested_party"
                    ? "Total for the party"
                    : flight.priceScope === "per_traveler"
                      ? "Per traveler"
                      : "Price basis unavailable"}
                </div>
              </div>
              <LegSchedule leg={flight.outbound} label="Outbound" showAirline />
              {flight.returned && (
                <div className="space-y-1">
                  <p className="text-xs text-travel-muted">
                    {flight.destination} →{" "}
                    {flight.returned.arrival_airport || flight.origin}
                  </p>
                  <LegSchedule
                    leg={flight.returned}
                    label="Return"
                    showAirline
                  />
                </div>
              )}
              <FlightConnections
                leg={flight.outbound}
                returned={flight.returned}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-travel-muted">
                  Fare checked{" "}
                  <time dateTime={flight.checkedAt}>
                    {checkedDate.format(new Date(flight.checkedAt))}
                  </time>
                </p>
                <button
                  type="button"
                  className={actionClasses}
                  onClick={() => saved.remove(flight.id)}
                >
                  Remove saved option
                </button>
              </div>
            </article>
          ))}
        </section>
      </details>
    </div>
  )
}
