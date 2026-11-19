import { useId, useState, type FormEvent, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { formatTripDates, type TripContext } from "@/types/tripContext"

const formatDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
})
const day = (value: string) =>
  value ? formatDate.format(new Date(value)) : "Not set"
const fieldStyle =
  "min-h-10 w-full rounded-md border border-travel-control bg-travel-surface px-2 text-travel-text"
const actionStyle =
  "min-h-10 rounded-md px-2 text-sm font-medium text-travel-text hover:bg-travel-selected focus-visible:outline-2 focus-visible:outline-travel-accent disabled:opacity-50"

export default function TripSummary({
  trip,
  composerLabel,
  showDetails,
  disabled,
  onSearch,
}: {
  trip: TripContext
  composerLabel: ReactNode
  showDetails: boolean
  disabled: boolean
  onSearch: (prompt: string) => void
}) {
  const [editing, setEditing] = useState<"dates" | "travelers" | null>(null)
  const [expanded, setExpanded] = useState(false)
  const controlsId = useId()
  const [children, setChildren] = useState(trip.children ?? 0)
  const [error, setError] = useState("")
  const flight =
    trip.search_type === "flight_only" || trip.search_type === "full_trip"
  const hotel = trip.search_type === "hotel_only"
  const oneWay = flight && trip.is_one_way === true
  const start = hotel
    ? trip.hotel_check_in_date || trip.start_date
    : trip.start_date
  const end = hotel ? trip.hotel_check_out_date || trip.end_date : trip.end_date
  const route =
    flight || (!trip.search_type && trip.origin)
      ? `${trip.origin || "Origin not set"} → ${trip.destination || "Destination not set"}`
      : trip.destination || "Destination not set"
  const party =
    trip.adults === null
      ? "Travelers not set"
      : `${trip.adults} adult${trip.adults === 1 ? "" : "s"}${trip.children ? ` · ${trip.children} ${trip.children === 1 ? "child" : "children"}` : ""}`
  const dates = oneWay ? day(start) : formatTripDates(start, end)
  const displayDates = dates || "Dates not set"

  function review(next: "dates" | "travelers") {
    setChildren(trip.children ?? 0)
    setError("")
    setEditing(next)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled) return
    const values = new FormData(event.currentTarget)
    let prompt: string
    if (editing === "dates") {
      const newStart = String(values.get("start") ?? "")
      const newEnd = String(values.get("end") ?? "")
      if (
        !newStart ||
        (!oneWay &&
          (!newEnd || newEnd < newStart || (hotel && newEnd === newStart)))
      ) {
        setError(
          hotel
            ? "Choose a check-out date after check-in."
            : "Choose a return date on or after departure.",
        )
        return
      }
      if (newStart === start && (oneWay || newEnd === end)) {
        setError("Choose a different date before searching.")
        return
      }
      prompt = hotel
        ? `Change the hotel stay to check-in ${newStart} and check-out ${newEnd}. Keep the other trip details.`
        : oneWay
          ? `Change the departure date to ${newStart} for my one-way flight. Keep the other trip details.`
          : `Change the trip dates to depart ${newStart} and return ${newEnd}. Keep the other trip details.`
    } else {
      const adultCount = Number(values.get("adults"))
      if (adultCount + children > 9) {
        setError("Choose up to nine travelers total.")
        return
      }
      const ages = Array.from({ length: children }, (_, index) =>
        Number(values.get(`child-${index}`)),
      )
      if (
        adultCount === trip.adults &&
        children === trip.children &&
        ages.every((age, index) => age === trip.children_ages[index])
      ) {
        setError("Change the traveler details before searching.")
        return
      }
      prompt = `Change the traveler count to ${adultCount} ${adultCount === 1 ? "adult" : "adults"} and ${children} ${children === 1 ? "child" : "children"}${children ? ` (ages ${ages.join(", ")})` : ""}. Keep the other trip details.`
    }
    setEditing(null)
    setExpanded(false)
    onSearch(prompt)
  }

  return (
    <section
      aria-label="Trip details"
      className="mb-1.5 w-full text-sm text-travel-muted"
    >
      {showDetails && (
        <p className="wrap-break-word">
          <strong className="font-semibold text-travel-text">{route}</strong>
          {(hotel || flight || start || end) && ` · ${displayDates}`}
          {trip.search_type !== "activity_only" && ` · ${party}`}
          {flight &&
            trip.is_one_way !== null &&
            (oneWay ? " · One-way" : " · Round trip")}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        {composerLabel}
        {(flight || hotel) && (
          <button
            type="button"
            className={`${actionStyle} inline-flex shrink-0 items-center gap-1`}
            disabled={disabled}
            aria-expanded={expanded}
            aria-controls={controlsId}
            onClick={() => {
              setExpanded(!expanded)
              setEditing(null)
            }}
          >
            Edit trip
            <ChevronDown
              aria-hidden="true"
              className={`size-4 ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        )}
      </div>
      {(flight || hotel) && (
        <div id={controlsId} hidden={!expanded}>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              disabled={disabled}
              aria-expanded={editing === "dates"}
              className={actionStyle}
              onClick={() => review("dates")}
            >
              Change dates
            </button>
            <button
              type="button"
              disabled={disabled}
              aria-expanded={editing === "travelers"}
              className={actionStyle}
              onClick={() => review("travelers")}
            >
              Edit travelers
            </button>
          </div>
          {editing && !disabled && (
            <form
              key={editing}
              aria-label={
                editing === "dates" ? "Review dates" : "Review travelers"
              }
              onSubmit={submit}
              className="mt-2 max-h-[45dvh] space-y-2 overflow-y-auto border-t border-travel-border py-2"
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {editing === "dates" ? (
                  <>
                    <label className="space-y-1">
                      {hotel ? "Check-in" : "Departure"}
                      <input
                        className={fieldStyle}
                        type="date"
                        name="start"
                        defaultValue={start}
                        required
                      />
                    </label>
                    {!oneWay && (
                      <label className="space-y-1">
                        {hotel ? "Check-out" : "Return"}
                        <input
                          className={fieldStyle}
                          type="date"
                          name="end"
                          defaultValue={end}
                          required
                        />
                      </label>
                    )}
                  </>
                ) : (
                  <>
                    <label className="space-y-1">
                      Adults
                      <input
                        className={fieldStyle}
                        type="number"
                        name="adults"
                        min={1}
                        max={9}
                        defaultValue={trip.adults ?? ""}
                        required
                      />
                    </label>
                    <label className="space-y-1">
                      Children
                      <select
                        className={fieldStyle}
                        value={children}
                        onChange={(event) =>
                          setChildren(Number(event.currentTarget.value))
                        }
                      >
                        {Array.from({ length: 9 }, (_, count) => (
                          <option key={count} value={count}>
                            {count}
                          </option>
                        ))}
                      </select>
                    </label>
                    {Array.from({ length: children }, (_, index) => (
                      <label className="space-y-1" key={index}>
                        Child {index + 1} age
                        <input
                          className={fieldStyle}
                          type="number"
                          name={`child-${index}`}
                          min={0}
                          max={17}
                          defaultValue={trip.children_ages[index] ?? ""}
                          required
                        />
                      </label>
                    ))}
                  </>
                )}
              </div>
              {editing === "dates" &&
                trip.search_type === "full_trip" &&
                (trip.hotel_check_in_date || trip.hotel_check_out_date) && (
                  <p className="text-travel-muted">
                    Saved hotel dates stay {day(trip.hotel_check_in_date)} –{" "}
                    {day(trip.hotel_check_out_date)}.
                  </p>
                )}
              {error && (
                <p role="alert" className="text-travel-warning">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className={`${actionStyle} bg-travel-accent-soft`}
                >
                  Search with changes
                </button>
                <button
                  type="button"
                  className={actionStyle}
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  )
}
