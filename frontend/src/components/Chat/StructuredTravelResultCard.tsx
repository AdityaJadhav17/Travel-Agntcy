import { formatTripDates } from "@/types/tripContext"
import { useState, type ReactNode } from "react"
import type { FlightCard, HotelCard, TravelResult } from "@/types/travelResult"
import FlightOptionCard, {
  FareBasis,
  FlightConnections,
  LegSchedule,
} from "./FlightOptionCard"
import {
  comparableFare,
  formatDuration,
  formatFare,
  formatFlightSchedule,
} from "@/utils/flightDisplay"
import { SaveFlightButton } from "./SavedFlights"

const usd = (value: number | null) =>
  value === null
    ? "Price unavailable"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(value)

function flightPriceBasis(
  result: TravelResult,
  flight: TravelResult["flights"][number] | undefined,
  fare = flight?.total_usd,
) {
  if (!flight || flight.total_usd !== fare) return undefined
  if (flight.price_scope === "per_traveler") return "Per traveler"
  if (flight.price_scope !== "requested_party") return undefined
  const party = result.children
    ? `${result.adults + result.children} travelers`
    : `${result.adults} adult${result.adults === 1 ? "" : "s"}`
  return `Total for ${party}`
}

function ComparisonSchedule({
  flight,
  periodLegs,
}: {
  flight: TravelResult["flights"][number]
  periodLegs: TravelResult["departure_period_legs"]
}) {
  return (
    <>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <LegSchedule
          label="Outbound"
          leg={flight}
          showAirline
          showPeriod={periodLegs?.includes("outbound")}
        />
        {flight.return_flight && (
          <LegSchedule
            label="Return"
            leg={flight.return_flight}
            showAirline={flight.return_flight.airline !== flight.airline}
            showPeriod={periodLegs?.includes("return")}
          />
        )}
      </div>
      <FlightConnections leg={flight} returned={flight.return_flight} />
    </>
  )
}

function flightTradeoff(result: TravelResult, flights: FlightCard[]) {
  if (result.kind !== "flight_only") return null
  const oneWay = result.is_one_way
  const comparable = flights
    .flatMap((flight) => {
      const fare = comparableFare(flight, oneWay)
      return fare === null ? [] : [{ flight, fare }]
    })
    .sort((left, right) => left.fare - right.fare)
  const cheapest = comparable[0]
  if (!cheapest) return null

  const nonstopBothWays = (flight: TravelResult["flights"][number]) =>
    flight.stops === 0 && (oneWay || flight.return_flight?.stops === 0)
  const isTradeoff = (flight: TravelResult["flights"][number]) =>
    (!nonstopBothWays(cheapest.flight) && nonstopBothWays(flight)) ||
    (cheapest.flight.stops > 0 && flight.stops === 0)
  const better = comparable.find(({ flight }) => isTradeoff(flight))
  if (!better || better.fare - cheapest.fare < 0.005) return null

  const label = oneWay
    ? "Nonstop"
    : nonstopBothWays(better.flight)
      ? "Nonstop both ways"
      : "Nonstop outbound"
  return {
    id: better.flight.id,
    text: `${label} for ${formatFare(better.fare - cheapest.fare)} more than the lowest fare`,
  }
}

function arrivalDifference(
  flight: FlightCard,
  flights: FlightCard[],
  result: TravelResult,
) {
  const arrival = formatFlightSchedule(flight.arrival_time)
  const airport = flight.arrival_airport ?? result.destination_airport
  if (
    !airport ||
    flight.total_usd === null ||
    !flight.price_scope ||
    arrival.dayStamp === null ||
    arrival.minutes === null
  )
    return
  const arrivalMinute = arrival.dayStamp / 60_000 + arrival.minutes
  const returned = flight.return_flight
  const candidates = flights.flatMap((other) => {
    if (
      other.id === flight.id ||
      other.total_usd !== flight.total_usd ||
      other.price_scope !== flight.price_scope ||
      (other.arrival_airport ?? result.destination_airport) !== airport
    )
      return []
    const later = formatFlightSchedule(other.arrival_time)
    if (later.dayStamp === null || later.minutes === null) return []
    const minutes = later.dayStamp / 60_000 + later.minutes - arrivalMinute
    if (minutes <= 0) return []
    const otherReturn = other.return_flight
    const sameReturnTimes =
      returned &&
      otherReturn &&
      returned.departure_time === otherReturn.departure_time &&
      returned.arrival_time === otherReturn.arrival_time &&
      (returned.arrival_airport ?? result.origin_airport) ===
        (otherReturn.arrival_airport ?? result.origin_airport)
    return [{ minutes, sameReturnTimes }]
  })
  const comparison =
    candidates.find(({ sameReturnTimes }) => sameReturnTimes) ?? candidates[0]
  if (!comparison) return
  return `Same fare · Outbound arrives ${formatDuration(comparison.minutes)} earlier${comparison.sameReturnTimes ? " · Same return times" : ""}`
}

function FlightOptions({
  result,
  interactive,
  saveFlights,
}: {
  result: TravelResult
  interactive: boolean
  saveFlights: boolean
}) {
  const [sortByFare, setSortByFare] = useState(false)
  const [nonstopOnly, setNonstopOnly] = useState(false)
  const oneWay = result.is_one_way
  const complete = oneWay
    ? result.flights
    : result.flights.filter((flight) => comparableFare(flight, false) !== null)
  const legacyIncomplete = oneWay
    ? []
    : result.flights.filter((flight) => comparableFare(flight, false) === null)
  const incomplete = [...(result.incomplete_flights ?? []), ...legacyIncomplete]
  const incompleteCount =
    (result.incomplete_flight_count ?? result.incomplete_flights?.length ?? 0) +
    legacyIncomplete.length
  const tradeoff = flightTradeoff(result, complete)
  const flights = nonstopOnly
    ? complete.filter(
        (flight) =>
          flight.stops === 0 && (oneWay || flight.return_flight?.stops === 0),
      )
    : complete
  const visibleFlights = sortByFare
    ? [...flights].sort((left, right) => {
        const a = comparableFare(left, oneWay) ?? Infinity
        const b = comparableFare(right, oneWay) ?? Infinity
        return a === b ? 0 : a < b ? -1 : 1
      })
    : flights
  const lowestFare = Math.min(
    ...visibleFlights.map(
      (flight) => comparableFare(flight, oneWay) ?? Infinity,
    ),
  )
  const hasHigherFare = visibleFlights.some((flight) => {
    const fare = comparableFare(flight, oneWay)
    return fare !== null && fare > lowestFare
  })

  return (
    <div className="space-y-2">
      {result.kind !== "flight_only" && (
        <h4 className="font-semibold text-travel-text">Flights</h4>
      )}
      {incompleteCount > 0 && (
        <p className="text-sm text-travel-muted">
          {complete.length
            ? `${complete.length} complete round-trip ${complete.length === 1 ? "quote" : "quotes"}`
            : "No complete round-trip quotes"}
          {" · "}
          {incompleteCount} incomplete{" "}
          {incompleteCount === 1 ? "quote" : "quotes"}
        </p>
      )}
      {interactive && complete.length > 1 && (
        <div
          role="group"
          aria-label="Compare returned flights"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-travel-text"
        >
          <label className="flex min-h-10 items-center gap-2">
            Sort by
            <select
              className="rounded-md border border-travel-control bg-travel-surface px-2 py-2 text-travel-text focus-visible:outline-2 focus-visible:outline-travel-accent"
              onChange={(event) =>
                setSortByFare(event.currentTarget.value === "fare")
              }
              value={sortByFare ? "fare" : "original"}
            >
              <option value="original">Search order</option>
              <option value="fare">Lowest fare</option>
            </select>
          </label>
          <label className="flex min-h-10 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={nonstopOnly}
              onChange={(event) => setNonstopOnly(event.currentTarget.checked)}
              className="h-4 w-4 accent-travel-accent focus-visible:outline-2 focus-visible:outline-travel-accent"
            />
            {oneWay ? "Nonstop only" : "Nonstop both ways"}
          </label>
        </div>
      )}
      {!visibleFlights.length && nonstopOnly && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <p role="status" className="text-travel-muted">
            {oneWay
              ? "No nonstop options in these results."
              : "No options in these results are nonstop both ways."}
          </p>
          <button
            type="button"
            onClick={() => setNonstopOnly(false)}
            className="font-medium text-travel-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-travel-accent"
          >
            Clear filter
          </button>
        </div>
      )}
      {visibleFlights.map((flight) => (
        <FlightOptionCard
          key={flight.id}
          leg={flight}
          periodLegs={result.departure_period_legs}
          lowest={
            hasHigherFare && comparableFare(flight, oneWay) === lowestFare
          }
          difference={
            arrivalDifference(flight, visibleFlights, result) ??
            (!nonstopOnly && flight.id === tradeoff?.id
              ? tradeoff.text
              : undefined)
          }
          quote={{
            state: "complete",
            fare: flight.total_usd,
            oneWay,
            returned: flight.return_flight,
            priceBasis: flightPriceBasis(result, flight),
          }}
          actions={
            saveFlights && <SaveFlightButton result={result} flight={flight} />
          }
        />
      ))}
      {incompleteCount > 0 && (
        <details className="rounded-xl border border-travel-border bg-travel-surface p-3 text-sm text-travel-muted">
          <summary className="w-fit cursor-pointer font-medium text-travel-text focus-visible:outline-2 focus-visible:outline-travel-accent">
            Review incomplete round-trip{" "}
            {incompleteCount === 1 ? "quote" : "quotes"}
          </summary>
          <p className="mt-2">
            These options are missing return details or a round-trip fare.
          </p>
          {incompleteCount > incomplete.length && incomplete.length > 0 && (
            <p>
              Showing {incomplete.length} of {incompleteCount}.
            </p>
          )}
          <div className="mt-2 space-y-2">
            {incomplete.map((flight) => (
              <FlightOptionCard
                key={flight.id}
                leg={flight}
                quote={{
                  state: "complete",
                  fare: null,
                  oneWay: false,
                  returned: flight.return_flight,
                }}
                periodLegs={result.departure_period_legs}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

const accommodationReasonLabels: Record<string, string> = {
  known_hostel_excluded:
    "The listing indicates a hostel, which does not match your hotel preference.",
  known_hotel_excluded:
    "The listing indicates a hotel, which does not match your hostel preference.",
  known_nonhotel_property_type:
    "The provider identified a non-hotel property type.",
  known_nonhostel_property_type:
    "The provider identified a non-hostel property type.",
  hotel_property_evidence: "The provider identifies this property as a hotel.",
  hostel_property_evidence:
    "The provider identifies this property as a hostel.",
  listing_name_suggests_hostel:
    "The listing name suggests this may be a hostel.",
  property_type_unverified: "The provider did not confirm the property type.",
  room_privacy_unverified:
    "The provider did not confirm whether the room is private.",
  non_private_room_evidence:
    "The provider indicates this is not a private room.",
  shared_room_evidence:
    "The provider indicates this is a shared or dormitory room.",
  private_room_evidence: "The provider identifies this as a private room.",
  private_room_not_required: "A private room was not required.",
}

const accommodationMatchLabels: Record<string, string> = {
  hotel_property_evidence: "Hotel type confirmed",
  hostel_property_evidence: "Hostel type confirmed",
  private_room_evidence: "Listed as a private room",
}

const accommodationExceptionLabels: Record<string, string> = {
  known_hostel_excluded: "Hostel listing does not meet hotel requirement",
  known_hotel_excluded: "Hotel listing does not meet hostel requirement",
  known_nonhotel_property_type: "Hotel type requirement unmet",
  known_nonhostel_property_type: "Hostel type requirement unmet",
  property_type_unverified: "Property type unconfirmed",
  room_privacy_unverified: "Room privacy unconfirmed",
  non_private_room_evidence: "Private room requirement unmet",
  shared_room_evidence: "Shared room only",
}

const humanizeEvidenceSource = (source: string) => {
  if (
    source.toLowerCase() === "serpapi_google_hotels" ||
    source.toLowerCase() === "serpapigooglehotels"
  )
    return "SerpAPI Google Hotels"
  return source
    .replace(/[_./:-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function HotelAccommodation({ hotel }: { hotel: HotelCard }) {
  const { accommodation_status: status, accommodation_evidence: evidence } =
    hotel
  const reasons = hotel.accommodation_reasons ?? []
  const type = [
    hotel.property_type ?? evidence?.property_type,
    hotel.room_type ?? evidence?.room_type,
  ]
    .filter(Boolean)
    .join(" / ")
  const source = hotel.accommodation_evidence_source ?? evidence?.source
  const hasException = status === "contradicted" || status === "unknown"
  const labels = hasException
    ? accommodationExceptionLabels
    : accommodationMatchLabels
  const statusLabels = reasons.map((reason) => labels[reason]).filter(Boolean)
  const statusText =
    statusLabels.join(" · ") ||
    (status === "contradicted"
      ? "Does not meet the accommodation preference"
      : status === "unknown"
        ? "Accommodation type or room details unverified"
        : "")

  return (
    <>
      {statusText && (
        <p
          className={
            hasException
              ? "mt-1 text-sm font-medium text-travel-warning"
              : "mt-1 text-sm text-travel-muted"
          }
        >
          {statusText}
        </p>
      )}
      {(type || source || reasons.length > 0) && (
        <details className="mt-1 text-sm text-travel-muted">
          <summary className="w-fit cursor-pointer">Room details</summary>
          <div className="mt-1 space-y-1 pl-4">
            {type && <p>{type}</p>}
            {source && <p>Evidence: {humanizeEvidenceSource(source)}</p>}
            {reasons.length > 0 && (
              <p>
                {reasons
                  .map(
                    (reason) =>
                      accommodationReasonLabels[reason] ??
                      "Confirm accommodation details with the property.",
                  )
                  .join(" ")}
              </p>
            )}
          </div>
        </details>
      )}
    </>
  )
}

export default function StructuredTravelResultCard({
  result,
  allowFlightControls = false,
  headerAction,
  responseDetails,
  saveFlights = false,
}: {
  result: TravelResult
  allowFlightControls?: boolean
  headerAction?: ReactNode
  responseDetails?: ReactNode
  saveFlights?: boolean
}) {
  const isFlightOnly = result.kind === "flight_only"
  const route = [
    result.origin_city || result.origin,
    result.destination_city || result.destination,
  ]
    .filter(Boolean)
    .join(" → ")
  const codes = [
    result.origin_airport ||
      (/^[A-Z]{3}$/.test(result.origin) && result.origin),
    result.destination_airport ||
      (/^[A-Z]{3}$/.test(result.destination) && result.destination),
  ]
    .filter(Boolean)
    .join(" → ")
  const heading = {
    full_trip: "Your trip",
    flight_only: route || "Flights",
    hotel_only: "Hotels",
    activity_only: "Things to do",
    airport_comparison: "Nearby arrival airports",
    date_comparison: "Nearby travel dates",
  }[result.kind]
  const dates = formatTripDates(result.start_date, result.end_date)
  const party = `${result.adults} adult${result.adults === 1 ? "" : "s"}${result.children > 0 ? `, ${result.children} ${result.children === 1 ? "child" : "children"}` : ""}`
  const flightMetadata = [
    codes !== route && codes,
    dates,
    party,
    result.is_one_way ? "One-way" : "Round trip",
  ]
    .filter(Boolean)
    .join(" · ")
  return (
    <section aria-label="Travel results" className="space-y-4">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3">
          <h3
            data-trip-result-heading
            className="text-xl font-semibold tracking-tight text-travel-text sm:text-2xl"
          >
            {heading}
          </h3>
          {headerAction}
        </div>
        {isFlightOnly ? (
          <p className="text-sm text-travel-muted">{flightMetadata}</p>
        ) : (
          <>
            <p className="text-sm text-travel-muted">
              {[result.origin, result.destination].filter(Boolean).join(" → ")}
              {dates && ` · ${dates}`}
            </p>
            <p className="text-sm text-travel-muted">
              {party}
              {(result.kind === "hotel_only" || result.kind === "full_trip") &&
                ` · ${result.rooms} room${result.rooms === 1 ? "" : "s"}`}
            </p>
          </>
        )}
        {result.kind === "full_trip" && result.total_usd !== null && (
          <p className="mt-2 font-semibold text-travel-text">
            Quoted flight + full hotel stay: {usd(result.total_usd)}
          </p>
        )}
      </header>
      {responseDetails}
      {result.notice && (
        <p className="rounded-xl border border-travel-border bg-travel-surface px-3 py-2 text-sm text-travel-text">
          {result.notice}
        </p>
      )}
      {(result.flights.length > 0 ||
        (result.incomplete_flights?.length ?? 0) > 0) && (
        <FlightOptions
          result={result}
          interactive={allowFlightControls && result.kind === "flight_only"}
          saveFlights={saveFlights}
        />
      )}
      {result.kind === "airport_comparison" && (
        <div className="space-y-2">
          <div>
            <p className="text-sm text-travel-text">
              Requested airport: {result.requested_airport} · Current airfare:{" "}
              {usd(result.requested_fare_usd ?? null)}
            </p>
            {typeof result.requested_fare_usd === "number" && (
              <FareBasis
                basis={flightPriceBasis(
                  result,
                  result.airport_alternatives?.find(
                    (option) =>
                      option.arrival_airport === result.requested_airport,
                  )?.flight,
                  result.requested_fare_usd,
                )}
              />
            )}
          </div>
          {result.airport_alternatives?.map((option) => (
            <article
              key={option.arrival_airport}
              className="rounded-xl border border-travel-border bg-travel-surface p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h4 className="font-semibold text-travel-text">
                  {option.arrival_airport} · {option.municipality}
                </h4>
                <div className="text-right">
                  <p className="font-semibold text-travel-text tabular-nums">
                    {usd(option.fare_usd)} airfare
                  </p>
                  <FareBasis
                    basis={flightPriceBasis(
                      result,
                      option.flight,
                      option.fare_usd,
                    )}
                  />
                </div>
              </div>
              <p className="text-sm text-travel-muted">{option.airport_name}</p>
              <p className="mt-1 text-sm text-travel-text">
                {option.driving_miles !== null
                  ? `${option.driving_miles} driving miles · about ${option.driving_minutes} minutes to ${result.destination}`
                  : `${option.straight_line_miles} straight-line miles to ${result.requested_airport} airport; driving distance unavailable`}
              </p>
              {option.savings_usd !== null && option.savings_usd > 0 && (
                <p className="text-sm text-travel-text">
                  {usd(option.savings_usd)} lower airfare than{" "}
                  {result.requested_airport}
                </p>
              )}
              <ComparisonSchedule
                flight={option.flight}
                periodLegs={result.departure_period_legs}
              />
              {saveFlights && (
                <SaveFlightButton
                  result={result}
                  flight={option.flight}
                  destination={option.arrival_airport}
                  fare={option.fare_usd}
                />
              )}
            </article>
          ))}
        </div>
      )}
      {result.kind === "date_comparison" && (
        <div className="space-y-2">
          <div>
            <p className="text-sm text-travel-text">
              Original date: {result.start_date} · Fresh airfare:{" "}
              {usd(result.base_fare_usd ?? null)}
            </p>
            {typeof result.base_fare_usd === "number" && (
              <FareBasis
                basis={flightPriceBasis(
                  result,
                  result.date_alternatives?.find(
                    (option) => option.departure_date === result.start_date,
                  )?.flight,
                  result.base_fare_usd,
                )}
              />
            )}
          </div>
          {result.date_alternatives?.map((option) => (
            <article
              key={option.departure_date + option.return_date}
              className="rounded-xl border border-travel-border bg-travel-surface p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h4 className="font-semibold text-travel-text">
                  {option.departure_date}
                  {option.return_date && " to " + option.return_date}
                </h4>
                <div className="text-right">
                  <p className="font-semibold text-travel-text tabular-nums">
                    {usd(option.fare_usd)} airfare
                  </p>
                  <FareBasis
                    basis={flightPriceBasis(
                      result,
                      option.flight,
                      option.fare_usd,
                    )}
                  />
                </div>
              </div>
              <ComparisonSchedule
                flight={option.flight}
                periodLegs={result.departure_period_legs}
              />
              {saveFlights && (
                <SaveFlightButton
                  result={result}
                  flight={option.flight}
                  fare={option.fare_usd}
                  departureDate={option.departure_date}
                  returnDate={option.return_date}
                />
              )}
              {option.savings_usd !== null && option.savings_usd > 0 && (
                <p className="mt-1 text-sm text-travel-text">
                  {usd(option.savings_usd)} lower airfare than the original date
                </p>
              )}
            </article>
          ))}
        </div>
      )}
      {result.hotels.length > 0 && (
        <div className="space-y-2">
          {result.kind !== "hotel_only" && (
            <h4 className="font-semibold text-travel-text">Hotels</h4>
          )}
          {result.hotels.map((hotel) => {
            const total = hotel.total_usd
            const stayStart =
              hotel.check_in_date ||
              result.hotel_check_in_date ||
              result.start_date
            const stayEnd =
              hotel.check_out_date ||
              result.hotel_check_out_date ||
              result.end_date
            const separateStay =
              result.kind !== "hotel_only" ||
              stayStart !== result.start_date ||
              stayEnd !== result.end_date
            const timingWarning =
              hotel.provisional ||
              hotel.timing_status === "incompatible" ||
              hotel.timing_status === "needs_confirmation"
            const lateCheckInUnconfirmed =
              hotel.timing_status === "needs_confirmation" &&
              (hotel.timing_reason_codes?.some((code) =>
                [
                  "prior_night_booking_or_late_arrival_needs_confirmation",
                  "arrival_after_provider_checkin_window",
                  "late_arrival_retention_unknown",
                ].includes(code),
              ) ||
                /late arrival retention/i.test(hotel.timing_message ?? ""))
            const nightly = hotel.nightly_usd
            const price =
              total !== null
                ? `${usd(total)} full stay`
                : nightly !== null
                  ? `${usd(nightly)} nightly`
                  : "Price unavailable"
            const secondary = [
              total !== null && nightly !== null && `${usd(nightly)} nightly`,
              total === null &&
                nightly !== null &&
                "Full-stay price unavailable",
              hotel.overall_rating !== null &&
                `Rating ${hotel.overall_rating}/5`,
              hotel.location_rating !== null &&
                `Location ${hotel.location_rating}/5`,
            ]
              .filter(Boolean)
              .join(" · ")

            return (
              <article
                key={hotel.id}
                className="rounded-xl border border-travel-border bg-travel-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h5 className="font-semibold text-travel-text">
                    {hotel.name}
                  </h5>
                  <p
                    className={
                      total === null && nightly === null
                        ? "text-travel-muted"
                        : "font-semibold text-travel-text"
                    }
                  >
                    {price}
                  </p>
                </div>
                {secondary && (
                  <p className="text-sm text-travel-muted">{secondary}</p>
                )}
                {separateStay && (stayStart || stayEnd) && (
                  <p className="text-sm text-travel-muted">
                    Stay: {formatTripDates(stayStart, stayEnd)}
                  </p>
                )}
                <HotelAccommodation hotel={hotel} />
                {(hotel.timing_message || hotel.timing_status) && (
                  <p
                    className={`mt-1 text-sm ${timingWarning ? "text-travel-warning" : "text-travel-muted"}`}
                  >
                    {lateCheckInUnconfirmed
                      ? "Late check-in needs confirmation. Ask the property if it will hold your room."
                      : hotel.timing_message ||
                        (hotel.timing_status === "needs_confirmation"
                          ? "Arrival timing needs confirmation."
                          : hotel.timing_status === "incompatible"
                            ? "Arrival timing is incompatible with these stay dates."
                            : "Arrival timing is compatible with these stay dates.")}
                  </p>
                )}
              </article>
            )
          })}
        </div>
      )}
      {result.activities.length > 0 && (
        <div className="space-y-2">
          {result.kind !== "activity_only" && (
            <h4 className="font-semibold text-travel-text">Things to do</h4>
          )}
          {result.activities.map((activity) => (
            <article
              key={activity.id}
              className="rounded-xl border border-travel-border bg-travel-surface p-3 text-sm text-travel-text"
            >
              <span className="font-semibold text-travel-text">
                {activity.name}
              </span>
              {activity.type && ` · ${activity.type}`}
              {activity.rating !== null && ` · ${activity.rating}/5`}
            </article>
          ))}
        </div>
      )}
      {result.kind === "flight_only" && (
        <p className="text-xs text-travel-muted">
          Check the final airfare, baggage fees, and fare rules before booking.
        </p>
      )}
      {result.hotels.length > 0 && (
        <p className="text-xs text-travel-muted">
          Confirm room occupancy and property fees before booking.
        </p>
      )}
    </section>
  )
}
