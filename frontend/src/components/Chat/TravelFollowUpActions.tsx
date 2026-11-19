import type { TravelResult } from "@/types/travelResult"

export default function TravelFollowUpActions({
  result,
  retryHotels,
  onAction,
}: {
  result: TravelResult | null
  retryHotels?: boolean
  onAction: (prompt: string) => void
}) {
  const kind = result?.kind
  const hasFlights = kind === "flight_only" || kind === "full_trip"
  if (!hasFlights && !retryHotels) return null

  const searches = [
    ...(retryHotels ? ["Retry hotels"] : []),
    ...(hasFlights
      ? ["Compare nearby arrival airports", "Compare cheaper dates"]
      : []),
    ...(kind === "full_trip" && !retryHotels ? ["Change the hotel"] : []),
  ]
  const buttonStyle =
    "min-h-10 rounded-md px-2.5 py-1 text-sm font-medium focus-visible:outline-2 focus-visible:outline-travel-accent"
  return (
    <div
      role="group"
      aria-label="Actions for this result"
      className="mt-3 flex flex-wrap items-center gap-2 border-t border-travel-border pt-3"
    >
      <div
        role="group"
        aria-label="Run another search"
        className="flex flex-wrap gap-2"
      >
        {searches.map((action) => (
          <button
            key={action}
            type="button"
            className={`${buttonStyle} border border-travel-control bg-travel-surface text-travel-text hover:bg-travel-selected`}
            onClick={() => onAction(action)}
          >
            {action}
          </button>
        ))}
      </div>
      {kind === "full_trip" && (
        <button
          type="button"
          className={`${buttonStyle} text-travel-accent underline underline-offset-4 hover:bg-travel-selected`}
          onClick={() => onAction("Why this trip?")}
        >
          Why this trip?
        </button>
      )}
    </div>
  )
}
