/**
 * Copyright AGNTCY Contributors (https://github.com/agntcy)
 * SPDX-License-Identifier: Apache-2.0
 **/

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { X } from "lucide-react"
import { getApiUrlForPattern, PATTERNS } from "@/utils/patternUtils"

interface BuildInfo {
  version: string
  build_date: string
  dependencies: Record<string, string>
}

export default function InfoModal({
  onClose,
  agentGraph,
}: {
  onClose: () => void
  agentGraph: ReactNode
}) {
  const apiUrl = getApiUrlForPattern(PATTERNS.TRAVEL_SEARCH)
  const dialog = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  const graphId = useId()
  const [info, setInfo] = useState<BuildInfo | null>(null)
  const [error, setError] = useState(false)
  const [showGraph, setShowGraph] = useState(false)

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  useEffect(() => {
    const request = new AbortController()
    async function fetchInfo() {
      try {
        const response = await fetch(`${apiUrl}/about`, {
          credentials: "include",
          signal: request.signal,
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        if (!request.signal.aborted) setInfo(data)
      } catch {
        if (!request.signal.aborted) setError(true)
      }
    }
    void fetchInfo()
    return () => request.abort()
  }, [apiUrl])

  return (
    <dialog
      ref={dialog}
      aria-labelledby={headingId}
      onClose={onClose}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-auto rounded-2xl border border-travel-border bg-travel-surface text-travel-text shadow-xl backdrop:bg-black/50"
    >
      <div className="flex items-center justify-between border-b border-travel-border py-2 pr-3 pl-5">
        <h2 id={headingId} className="text-lg font-semibold">
          Help
        </h2>
        <button
          type="button"
          aria-label="Close help"
          onClick={() => dialog.current?.close()}
          className="flex size-11 items-center justify-center rounded-md text-travel-muted hover:bg-travel-selected focus-visible:outline-2 focus-visible:outline-travel-accent"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>

      <div className="space-y-5 p-5">
        <section aria-label="Traveler questions" className="space-y-3">
          <h3 className="text-sm font-semibold">Traveler questions</h3>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="font-medium">What can I search for?</dt>
              <dd className="mt-1 text-travel-muted">
                Ask for flights, hotels, activities, or a full trip. Include
                your destination, travel dates, and the number of travelers. For
                flights, include where you’re leaving from.
              </dd>
            </div>
            <div>
              <dt className="font-medium">What does a flight price cover?</dt>
              <dd className="mt-1 text-travel-muted">
                Trip total covers the travelers in your search. Per traveler is
                for one person. Price basis unavailable means the quote’s
                coverage could not be verified.
              </dd>
            </div>
            <div>
              <dt className="font-medium">
                How do I change just my return date?
              </dt>
              <dd className="mt-1 text-travel-muted">
                In your round trip, choose Edit trip, then Change dates. Keep
                the departure date and enter your new return date.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Where do I find my saved flights?</dt>
              <dd className="mt-1 text-travel-muted">
                Saved flights stay with the trip in this browser. Reopen the
                trip from the sidebar and expand Saved flights. Each option
                shows when the fare was checked. Confirm the latest price and
                availability with the provider before booking.
              </dd>
            </div>
          </dl>
        </section>

        <section
          aria-label="Diagnostics"
          className="border-t border-travel-border pt-4"
        >
          <h3 className="text-sm font-semibold">Diagnostics</h3>
          <button
            type="button"
            aria-expanded={showGraph}
            aria-controls={graphId}
            onClick={() => setShowGraph((shown) => !shown)}
            className="my-2 min-h-11 rounded-lg border border-travel-control px-3 text-sm hover:bg-travel-selected focus-visible:outline-2 focus-visible:outline-travel-accent"
          >
            {showGraph ? "Hide agent graph" : "Show agent graph"}
          </button>
          <div id={graphId} hidden={!showGraph}>
            {showGraph && (
              <div className="h-64 overflow-hidden rounded-lg border border-travel-border md:h-96">
                {agentGraph}
              </div>
            )}
          </div>
        </section>

        <section
          aria-label="Build and release information"
          className="space-y-2 border-t border-travel-border pt-4"
        >
          <h3 className="text-sm font-semibold">
            Build and release information
          </h3>
          {error && (
            <p className="text-sm text-travel-warning">
              Failed to load build info
            </p>
          )}
          {!error && !info && (
            <p className="text-sm text-travel-muted">Loading build info…</p>
          )}
          {info && (
            <dl className="space-y-2 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-travel-muted">Release version</dt>
                <dd className="font-mono">{info.version}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-travel-muted">Build date</dt>
                <dd className="font-mono">{info.build_date}</dd>
              </div>
              {Object.entries(info.dependencies ?? {}).map(
                ([name, version]) => (
                  <div
                    key={name}
                    className="flex flex-wrap justify-between gap-2"
                  >
                    <dt className="text-travel-muted">{name}</dt>
                    <dd className="font-mono">{version}</dd>
                  </div>
                ),
              )}
            </dl>
          )}
        </section>
      </div>
    </dialog>
  )
}
