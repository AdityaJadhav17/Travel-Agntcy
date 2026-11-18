import type { TravelResult } from "@/types/travelResult"

export default function TravelFollowUpActions({
  kind,
  retryHotels,
  onAction,
}: {
  kind?: TravelResult["kind"]
  retryHotels?: boolean
  onAction: (prompt: string) => void
}) {
  const hasFlights = kind === "flight_only" || kind === "full_trip"
  if (!hasFlights && !retryHotels) return null

  const searches = [
    ...(retryHotels ? ["Retry hotels"] : []),
    ...(hasFlights
      ? ["Compare nearby arrival airports", "Compare cheaper dates"]
      : []),
    ...(kind === "full_trip" && !retryHotels ? ["Change the hotel"] : []),
  ]
  const explanation =
    kind === "full_trip" ? "Why this trip?" : "Why this flight?"
  const buttonStyle =
    "min-h-10 rounded-md px-2.5 py-1 text-sm font-medium focus-visible:outline-2 focus-visible:outline-emerald-300"
  return (
    <div
      role="group"
      aria-label="Actions for this result"
      className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3"
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
            className={`${buttonStyle} border border-white/20 bg-white/5 text-gray-100 hover:bg-white/10`}
            onClick={() => onAction(action)}
          >
            {action}
          </button>
        ))}
      </div>
      {hasFlights && (
        <button
          type="button"
          className={`${buttonStyle} text-emerald-200 underline underline-offset-4 hover:bg-white/10`}
          onClick={() => onAction(explanation)}
        >
          {explanation}
        </button>
      )}
    </div>
  )
}
