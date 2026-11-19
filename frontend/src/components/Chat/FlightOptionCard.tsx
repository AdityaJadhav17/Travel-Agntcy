import type { ReactNode } from "react"
import type { FlightLeg, TravelResult } from "@/types/travelResult"
import {
  flightStops,
  formatArrivalDate,
  formatFare,
  formatDuration,
  formatFlightSchedule,
} from "@/utils/flightDisplay"

const scheduleColumns =
  "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.7fr)] gap-x-2 sm:gap-x-4"

export function LegSchedule({
  leg,
  label,
  showPeriod,
  showAirline,
  showLabel = true,
  compact = false,
}: {
  leg: FlightLeg
  label: "Outbound" | "Return"
  showPeriod?: boolean
  showAirline?: boolean
  showLabel?: boolean
  compact?: boolean
}) {
  const departure = formatFlightSchedule(leg.departure_time)
  const arrival = formatFlightSchedule(leg.arrival_time)
  const arrivalDate = formatArrivalDate(departure, arrival)
  const isReturn = label === "Return"
  const timingClass = isReturn
    ? "text-sm font-medium text-travel-muted"
    : "text-sm font-semibold text-travel-text @[26rem]:text-base"
  const timingLabelClass = compact ? "sr-only" : "text-xs text-travel-muted"

  return (
    <div className={`min-w-0 gap-y-1.5 ${scheduleColumns}`}>
      {showLabel && (
        <div className="col-span-full flex flex-wrap items-baseline gap-x-2 text-xs">
          <p className="wrap-break-word text-travel-muted">
            <span className="font-medium">{label}</span>
            {showAirline && leg.airline && ` · ${leg.airline}`}
            {showPeriod && departure.period && ` · ${departure.period}`}
          </p>
        </div>
      )}
      <div className="min-w-0">
        <p className={timingLabelClass}>Departs</p>
        <p className={`wrap-break-word tabular-nums ${timingClass}`}>
          {departure.time}
        </p>
        {departure.date && (
          <p className="text-xs text-travel-muted">{departure.date}</p>
        )}
      </div>
      <div className="min-w-0">
        <p className={timingLabelClass}>Arrives</p>
        <p className={`wrap-break-word tabular-nums ${timingClass}`}>
          {arrival.time}
        </p>
        {arrivalDate && (
          <p className="text-xs text-travel-muted">{arrivalDate}</p>
        )}
      </div>
      <div className="min-w-0">
        <p className={timingLabelClass}>Stops</p>
        <p className={`wrap-break-word tabular-nums ${timingClass}`}>
          {flightStops(leg.stops)}
        </p>
        {leg.duration_minutes && (
          <p className="text-xs text-travel-muted">
            {formatDuration(leg.duration_minutes)} total
          </p>
        )}
      </div>
    </div>
  )
}

export function FlightConnections({
  leg,
  returned,
}: {
  leg: FlightLeg
  returned?: FlightLeg | null
}) {
  if (!leg.connections?.length && !returned?.connections?.length) return null
  const legs = [
    { label: "Outbound", connections: leg.connections },
    { label: "Return", connections: returned?.connections },
  ]
  return (
    <details className="mt-2 text-xs text-travel-muted">
      <summary className="w-fit cursor-pointer focus-visible:outline-2 focus-visible:outline-travel-accent">
        Connection details
      </summary>
      <ul className="mt-1 space-y-1 pl-4">
        {legs.map(({ label, connections }) =>
          connections?.length ? (
            <li key={label}>
              {label} ·{" "}
              {connections
                .map(({ airport, duration_minutes }) =>
                  duration_minutes
                    ? `${airport} (${formatDuration(duration_minutes)})`
                    : airport,
                )
                .join(" · ")}
            </li>
          ) : null,
        )}
      </ul>
    </details>
  )
}

type Quote =
  | { state: "pending" }
  | {
      state: "complete"
      fare: number | null
      oneWay: boolean
      returned: FlightLeg | null
      priceBasis?: string
    }

export function FareBasis({
  basis,
  tripType,
}: {
  basis?: string
  tripType?: string
}) {
  return (
    <>
      {(tripType || basis) && (
        <p className="text-xs text-travel-muted">
          {[tripType, basis].filter(Boolean).join(" · ")}
        </p>
      )}
      {!basis && (
        <details className="text-xs text-travel-muted">
          <summary className="cursor-pointer underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-travel-accent">
            Fare details
          </summary>
          <p>Price basis unavailable</p>
        </details>
      )}
    </>
  )
}

export default function FlightOptionCard({
  leg,
  quote,
  periodLegs,
  difference,
  lowest,
  actions,
}: {
  leg: FlightLeg
  quote: Quote
  periodLegs?: TravelResult["departure_period_legs"]
  difference?: string
  lowest?: boolean
  actions?: ReactNode
}) {
  const fare = quote.state === "complete" ? quote.fare : null
  const outboundPeriod = periodLegs?.includes("outbound")
    ? formatFlightSchedule(leg.departure_time).period
    : null
  return (
    <article
      className={`@container rounded-xl border bg-travel-surface px-3.5 py-3 sm:px-4 ${lowest ? "border-travel-accent" : "border-travel-border"}`}
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h4 className="text-sm font-semibold wrap-break-word text-travel-text">
            {leg.airline || "Airline unavailable"}
          </h4>
          {outboundPeriod && (
            <span className="text-xs text-travel-muted">{outboundPeriod}</span>
          )}
        </div>
        {lowest && (
          <span className="text-xs font-semibold text-travel-accent">
            Lowest fare
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 items-start gap-x-4 @[26rem]:grid-cols-[minmax(0,2.7fr)_minmax(0,1fr)]">
        <LegSchedule label="Outbound" leg={leg} showLabel={false} />
        <div className="order-last mt-2 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 border-t border-travel-border pt-2 @[26rem]:order-0 @[26rem]:mt-0 @[26rem]:block @[26rem]:border-0 @[26rem]:pt-0 @[26rem]:text-right">
          <p className="text-xs text-travel-muted">Fare</p>
          <div className="min-w-0 text-right">
            {quote.state === "pending" ? (
              <p className="text-xs font-medium text-travel-warning">
                Return details and fare pending
              </p>
            ) : (
              <>
                <p
                  className={
                    fare === null
                      ? "text-xs text-travel-muted"
                      : "text-lg leading-tight font-semibold wrap-break-word text-travel-text tabular-nums @[26rem]:text-2xl"
                  }
                >
                  {fare === null ? "Fare unavailable" : formatFare(fare)}
                </p>
                {fare !== null && (
                  <FareBasis
                    basis={quote.priceBasis}
                    tripType={
                      quote.oneWay
                        ? "One-way"
                        : quote.returned
                          ? "Round trip"
                          : "Quoted fare"
                    }
                  />
                )}
              </>
            )}
          </div>
        </div>
        {quote.state === "complete" && (quote.returned || !quote.oneWay) && (
          <div className="col-span-full mt-2 grid grid-cols-subgrid border-t border-travel-border pt-2">
            {quote.returned ? (
              <LegSchedule
                label="Return"
                leg={quote.returned}
                compact
                showPeriod={periodLegs?.includes("return")}
                showAirline={quote.returned.airline !== leg.airline}
              />
            ) : (
              <p className="col-span-full text-xs text-travel-muted">
                Return details unavailable
              </p>
            )}
          </div>
        )}
      </div>
      {difference && (
        <p className="mt-2 text-xs text-travel-muted">{difference}</p>
      )}
      <FlightConnections
        leg={leg}
        returned={quote.state === "complete" ? quote.returned : null}
      />
      {actions && <div className="mt-2">{actions}</div>}
    </article>
  )
}
