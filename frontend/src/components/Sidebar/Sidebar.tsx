/**
 * Copyright AGNTCY Contributors (https://github.com/agntcy)
 * SPDX-License-Identifier: Apache-2.0
 **/

import { useEffect, useId, useRef, useState } from "react"
import { Ellipsis, Plus, Trash2, X } from "lucide-react"
import ActionMenu from "@/components/Navigation/ActionMenu"
import type { ChatHistoryItem } from "@/stores/chatDisplay"
import {
  formatTripDates,
  latestTripContext,
  type TripContext,
} from "@/types/tripContext"

const searchLabels: Record<NonNullable<TripContext["search_type"]>, string> = {
  flight_only: "Flights",
  full_trip: "Full trip",
  hotel_only: "Hotels",
  activity_only: "Activities",
}

function tripLabel(chat: ChatHistoryItem) {
  const trip = latestTripContext(chat.messages)
  const fallback = chat.title.trim() || "Untitled trip"
  if (!trip) return { title: fallback, dates: "", details: "" }

  const localSearch =
    trip.search_type === "hotel_only" || trip.search_type === "activity_only"
  const title =
    !localSearch && trip.origin && trip.destination
      ? `${trip.origin} → ${trip.destination}`
      : trip.destination || fallback
  const firstDate =
    trip.search_type === "hotel_only"
      ? trip.hotel_check_in_date || trip.start_date
      : trip.start_date || trip.hotel_check_in_date
  const lastDate =
    trip.search_type === "hotel_only"
      ? trip.hotel_check_out_date || trip.end_date
      : !localSearch && trip.is_one_way
        ? ""
        : trip.end_date || trip.hotel_check_out_date
  const dates = formatTripDates(firstDate, lastDate)
  const type = trip.search_type && searchLabels[trip.search_type]
  const direction =
    !localSearch && trip.is_one_way !== null
      ? trip.is_one_way
        ? "One-way"
        : "Round trip"
      : ""
  return {
    title,
    dates,
    details: [type, direction].filter(Boolean).join(" · "),
  }
}

function calendarDay(date: Date) {
  return (
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000
  )
}

const groupNames = [
  "Today",
  "Yesterday",
  "Previous 7 days",
  "Previous 30 days",
  "Older",
]

function tripGroups(history: ChatHistoryItem[]) {
  const sorted = [...history].sort(
    (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
  )
  if (sorted.length === 0) return []
  if (sorted.length <= 5) return [{ name: "", trips: sorted }]
  const today = calendarDay(new Date())
  const groups = groupNames.map((name) => ({
    name,
    trips: [] as ChatHistoryItem[],
  }))
  for (const trip of sorted) {
    const age = today - calendarDay(trip.timestamp)
    const index =
      age <= 0 ? 0 : age === 1 ? 1 : age <= 7 ? 2 : age <= 30 ? 3 : 4
    groups[index].trips.push(trip)
  }
  return groups.filter(({ trips }) => trips.length > 0)
}

const focusRing =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-travel-accent"

function DeleteTripDialog({
  title,
  onClose,
  onConfirm,
}: {
  title: string
  onClose: () => void
  onConfirm: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  const descriptionId = useId()
  useEffect(() => {
    const modal = dialog.current
    modal?.showModal()
    return () => modal?.close()
  }, [])

  return (
    <dialog
      ref={dialog}
      role="alertdialog"
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault()
        dialog.current?.close()
        onClose()
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-travel-border bg-travel-surface p-5 text-travel-text shadow-xl backdrop:bg-black/50"
    >
      <h2 id={headingId} className="text-base font-semibold">
        Delete trip?
      </h2>
      <p
        id={descriptionId}
        className="mt-2 text-sm break-words text-travel-muted"
      >
        Delete “{title}” from your recent trips? This action is permanent.
      </p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          autoFocus
          onClick={() => {
            dialog.current?.close()
            onClose()
          }}
          className={`min-h-11 rounded-lg border border-travel-control px-3 text-sm hover:bg-travel-selected ${focusRing}`}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            dialog.current?.close()
            onConfirm()
          }}
          className={`min-h-11 rounded-lg border border-travel-control px-3 text-sm font-semibold text-travel-warning hover:bg-travel-selected ${focusRing}`}
        >
          Delete trip
        </button>
      </div>
    </dialog>
  )
}

export default function Sidebar({
  onNewChat,
  onSelectChat,
  onDeleteChat,
  chatHistory,
  currentChatId,
  isMobile,
  onClose,
}: {
  onNewChat: () => void
  onSelectChat: (chatId: string) => void
  onDeleteChat: (chatId: string) => Promise<boolean>
  chatHistory: ChatHistoryItem[]
  currentChatId: string | null
  isMobile: boolean
  onClose: () => void
}) {
  const newTrip = useRef<HTMLButtonElement>(null)
  const drawer = useRef<HTMLDialogElement>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<{
    id: string
    title: string
  } | null>(null)
  useEffect(() => {
    if (!isMobile) return
    const modal = drawer.current
    modal?.showModal()
    return () => modal?.close()
  }, [isMobile])

  const closeDrawer = () => {
    drawer.current?.close()
    onClose()
  }
  const groups = tripGroups(chatHistory)

  const sidebar = (
    <aside
      id={isMobile ? undefined : "trip-sidebar"}
      className="flex h-full w-[min(280px,calc(100vw-3rem))] flex-none flex-col border-r border-travel-border bg-travel-surface"
    >
      {isMobile && (
        <div className="flex items-center justify-between border-b border-travel-border py-1 pr-2 pl-4">
          <h2 id="trip-drawer-heading" className="text-sm font-semibold">
            Trips
          </h2>
          <button
            type="button"
            autoFocus
            aria-label="Close sidebar"
            onClick={closeDrawer}
            className={`flex size-11 items-center justify-center rounded-md text-travel-muted hover:bg-travel-selected ${focusRing}`}
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
      )}
      <div className="p-3">
        <button
          type="button"
          ref={newTrip}
          onClick={() => {
            if (isMobile) closeDrawer()
            onNewChat()
          }}
          className={`flex min-h-11 w-full items-center gap-2 rounded-lg border border-travel-control px-3 text-sm font-semibold text-travel-text hover:bg-travel-selected ${focusRing}`}
        >
          <Plus aria-hidden="true" className="size-4 text-travel-accent" />
          New trip
        </button>
      </div>
      <nav
        aria-label="Recent trips"
        className="flex-1 overflow-y-auto overscroll-contain px-3 pb-3"
      >
        <h2 className="px-3 py-2 text-sm font-semibold text-travel-text">
          Recent trips
        </h2>
        {chatHistory.length === 0 && (
          <p className="px-3 py-2 text-sm text-travel-muted">
            No saved trips yet
          </p>
        )}
        {groups.map(({ name, trips }) => (
          <section key={name} className="pb-2" aria-label={name || undefined}>
            {name && (
              <h3 className="px-3 py-1.5 text-xs font-medium text-travel-muted">
                {name}
              </h3>
            )}
            <ul className="space-y-1">
              {trips.map((chat) => {
                const { title, dates, details } = tripLabel(chat)
                const selected = currentChatId === chat.id
                const detailId = `trip-details-${chat.id}`
                return (
                  <li
                    key={chat.id}
                    className={`trip-row relative rounded-lg ${selected ? "bg-travel-selected" : "hover:bg-travel-raised"}`}
                  >
                    <button
                      type="button"
                      aria-current={selected ? "true" : undefined}
                      aria-label={title}
                      aria-describedby={dates || details ? detailId : undefined}
                      onClick={() => {
                        if (isMobile) closeDrawer()
                        onSelectChat(chat.id)
                      }}
                      className={`flex min-h-11 w-full flex-col justify-center gap-0.5 rounded-lg px-3 py-2 text-left text-sm text-travel-text ${focusRing}`}
                    >
                      <span className="w-full truncate pr-9" title={title}>
                        {title}
                      </span>
                      {(dates || details) && (
                        <span
                          id={detailId}
                          className="w-full text-xs text-travel-muted"
                        >
                          {dates && <span className="block">{dates}</span>}
                          {details && <span className="block">{details}</span>}
                        </span>
                      )}
                    </button>
                    <div className="trip-row-actions absolute top-0 right-0">
                      <ActionMenu
                        label={`Trip actions: ${title}`}
                        icon={
                          <Ellipsis aria-hidden="true" className="size-4" />
                        }
                        buttonClassName={`flex size-11 items-center justify-center rounded-md text-travel-muted hover:bg-travel-selected hover:text-travel-text ${focusRing}`}
                        panelClassName="absolute top-10 right-1 z-10 min-w-32 rounded-lg border border-travel-border bg-travel-raised p-1 shadow-lg"
                        actions={[
                          {
                            label: "Delete trip",
                            icon: (
                              <Trash2 aria-hidden="true" className="size-4" />
                            ),
                            destructive: true,
                            onSelect: () =>
                              setDeleteCandidate({ id: chat.id, title }),
                          },
                        ]}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </nav>
    </aside>
  )

  return (
    <>
      {isMobile ? (
        <dialog
          id="trip-sidebar"
          ref={drawer}
          aria-labelledby="trip-drawer-heading"
          onCancel={(event) => {
            event.preventDefault()
            closeDrawer()
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeDrawer()
          }}
          onKeyDown={(event) => {
            if (event.key !== "Tab") return
            const controls = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled), a[href], [tabindex="0"]',
              ),
            ).filter(
              (control) =>
                control.tabIndex >= 0 && control.getClientRects().length,
            )
            const first = controls[0]
            const last = controls.at(-1)
            const boundary = event.shiftKey ? first : last
            if (document.activeElement !== boundary) return
            event.preventDefault()
            const next = event.shiftKey ? last : first
            next?.focus()
          }}
          className="fixed inset-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-transparent text-travel-text backdrop:bg-black/50"
        >
          {sidebar}
        </dialog>
      ) : (
        sidebar
      )}
      {deleteCandidate && (
        <DeleteTripDialog
          title={deleteCandidate.title}
          onClose={() => setDeleteCandidate(null)}
          onConfirm={() => {
            const trigger = document.activeElement
            const { id } = deleteCandidate
            setDeleteCandidate(null)
            void onDeleteChat(id).then((deleted) => {
              if (!deleted) return
              requestAnimationFrame(() => {
                if (
                  document.activeElement === trigger ||
                  document.activeElement === document.body
                )
                  newTrip.current?.focus()
              })
            })
          }}
        />
      )}
    </>
  )
}
