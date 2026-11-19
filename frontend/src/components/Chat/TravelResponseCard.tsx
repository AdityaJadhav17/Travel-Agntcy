/**
 * Copyright AGNTCY Contributors (https://github.com/agntcy)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Beautiful card-based rendering for all travel agent responses:
 * - Full trip (flight + hotel + activities)
 * - Flight-only searches
 * - Hotel-only searches
 * - Activity-only searches
 **/

import React, { useState } from "react"
import { BudgetAssessment } from "@/types/budget"
import { parseTravelResult, type TravelResult } from "@/types/travelResult"
import { formatFare } from "@/utils/flightDisplay"
import StructuredTravelResultCard from "./StructuredTravelResultCard"
import ActionMenu from "../Navigation/ActionMenu"
import ReactMarkdown from "react-markdown"
import {
  Plane,
  Hotel,
  Calendar,
  Clock,
  Ellipsis,
  MapPin,
  Star,
} from "lucide-react"

interface TravelResponseCardProps {
  content: string
  budget?: BudgetAssessment | null
  travelResult?: TravelResult | null
}

// Detect response type based on content patterns
const detectResponseType = (
  content: string,
):
  | "full_trip"
  | "flights_only"
  | "hotels_only"
  | "activities_only"
  | "simple" => {
  // Full trip: Has outbound flight AND hotel details
  if (
    (content.includes("Outbound Flight") || content.includes("✈️ **Flight")) &&
    (content.includes("Hotel Details") || content.includes("🏨 **Hotel"))
  ) {
    return "full_trip"
  }

  // Flight-only: Has "Flights:" header with flight options (card style)
  if (
    (content.includes("One-Way Flights:") ||
      content.includes("Round-Trip Flights:")) &&
    (content.includes("Here are the top") || content.includes("flight options"))
  ) {
    return "flights_only"
  }

  // Hotel-only: Has "Hotels in" header
  if (
    content.includes("Top Hotels in") ||
    content.includes("🏨 **Top Hotels")
  ) {
    return "hotels_only"
  }

  // Activity-only: Has "Things to Do" header
  if (
    content.includes("Things to Do in") ||
    content.includes("🎯 **Things to Do")
  ) {
    return "activities_only"
  }

  return "simple"
}

// Parse full trip response
const parseFullTripResponse = (content: string) => {
  const sections: {
    intro?: string
    notice?: string
    totalCost?: string
    flightCost?: string
    hotelCost?: string
    outboundFlight?: Record<string, string>
    returnFlight?: Record<string, string>
    hotel?: Record<string, string>
    activities?: Array<{
      name: string
      type?: string
      rating?: string
      reviews?: string
    }>
    tripSummary?: string[]
  } = {}

  const lines = content.split("\n")
  let currentSection = ""
  let tripSummaryLines: string[] = []
  let activitiesList: Array<{
    name: string
    type?: string
    rating?: string
    reviews?: string
  }> = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed === "---") continue

    if (
      trimmed.startsWith(
        "I kept your selected flight and found a different hotel.",
      )
    ) {
      sections.notice = trimmed
      continue
    }

    // Detect sections
    if (
      trimmed.includes("Great news") ||
      trimmed.includes("found the best") ||
      trimmed.includes("lowest eligible quote among") ||
      trimmed.includes("provisional pairing from the returned options")
    ) {
      sections.intro = trimmed.replace(/\*\*/g, "").replace(/🎉/g, "").trim()
      continue
    }

    if (trimmed.includes("Total Cost:")) {
      sections.totalCost = trimmed.match(/\$[\d,.]+/)?.[0] || ""
      continue
    }

    if (
      trimmed.includes("Flight:") &&
      trimmed.includes("$") &&
      !trimmed.includes("Flight**")
    ) {
      sections.flightCost = trimmed.match(/\$[\d,.]+/)?.[0] || ""
      continue
    }

    if (
      trimmed.includes("Hotel:") &&
      trimmed.includes("$") &&
      !trimmed.includes("Hotel**")
    ) {
      sections.hotelCost = trimmed.match(/\$[\d,.]+/)?.[0] || ""
      continue
    }

    if (
      trimmed.includes("Outbound Flight") ||
      (trimmed.includes("✈️") &&
        trimmed.includes("Flight") &&
        !trimmed.includes("Return"))
    ) {
      currentSection = "outbound"
      sections.outboundFlight = {}
      continue
    }

    if (trimmed.includes("Return Flight")) {
      currentSection = "return"
      sections.returnFlight = {}
      continue
    }

    if (trimmed.includes("Hotel Details") || trimmed.includes("🏨 **Hotel")) {
      currentSection = "hotel"
      sections.hotel = {}
      continue
    }

    if (trimmed.includes("Things to Do") || trimmed.includes("🎯 **Things")) {
      currentSection = "activities"
      activitiesList = []
      continue
    }

    if (trimmed.includes("Trip Summary")) {
      currentSection = "summary"
      tripSummaryLines = []
      continue
    }

    // Parse section content
    if (currentSection === "outbound" && sections.outboundFlight) {
      parseFlightLine(trimmed, sections.outboundFlight)
    } else if (currentSection === "return" && sections.returnFlight) {
      parseFlightLine(trimmed, sections.returnFlight)
    } else if (currentSection === "hotel" && sections.hotel) {
      parseHotelLine(trimmed, sections.hotel)
    } else if (currentSection === "activities") {
      // Parse activity line: - **Name** - Type ⭐ rating (reviews)
      if (trimmed.startsWith("-") || trimmed.startsWith("•")) {
        const activityMatch = trimmed.match(/\*\*([^*]+)\*\*(.*)/)
        if (activityMatch) {
          const name = activityMatch[1].trim()
          const rest = activityMatch[2]
          const typeMatch = rest.match(/^\s*-?\s*([^⭐]+)/)
          const ratingMatch = rest.match(/⭐\s*([\d.]+)/)
          const reviewsMatch = rest.match(/\(([^)]+reviews)\)/)

          activitiesList.push({
            name,
            type: typeMatch?.[1]?.trim().replace(/^-\s*/, ""),
            rating: ratingMatch?.[1],
            reviews: reviewsMatch?.[1],
          })
        }
      }
    } else if (currentSection === "summary") {
      const cleaned = trimmed.replace(/^-\s*/, "").replace(/\*\*/g, "").trim()
      if (cleaned) tripSummaryLines.push(cleaned)
    }
  }

  if (tripSummaryLines.length > 0) sections.tripSummary = tripSummaryLines
  if (activitiesList.length > 0) sections.activities = activitiesList

  return sections
}

// Parse flight-only response (card style with outbound/return sections)
const parseFlightsOnlyResponse = (content: string) => {
  const result: {
    title: string
    route: string
    reverseRoute: string
    date: string
    isOneWay: boolean
    flightOptions: Array<{
      optionNumber: number
      price: string
      priceType: string
      outbound: Record<string, string>
      returnFlight?: Record<string, string>
    }>
  } = {
    title: "",
    route: "",
    reverseRoute: "",
    date: "",
    isOneWay: true,
    flightOptions: [],
  }

  const lines = content.split("\n")
  let currentOption: any = null
  let currentSection = ""

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Parse header: ✈️ **Round-Trip Flights: SJC → NRT**
    if (trimmed.includes("Flights:")) {
      result.title = trimmed.replace(/✈️|\*/gu, "").trim()
      result.isOneWay = trimmed.includes("One-Way")
      const routeMatch = trimmed.match(/:\s*([A-Z]{3})\s*→\s*([A-Z]{3})/)
      if (routeMatch) {
        result.route = `${routeMatch[1]} → ${routeMatch[2]}`
        result.reverseRoute = `${routeMatch[2]} → ${routeMatch[1]}`
      }
    }

    // Parse date
    if (trimmed.startsWith("**Date**:") || trimmed.startsWith("**Dates**:")) {
      result.date = trimmed.replace(/^\*\*Dates?\*\*:\s*/, "").trim()
    }

    // Parse option header: **Option 1** - $1253.00 (round-trip)
    const optionMatch = trimmed.match(
      /\*\*Option\s*(\d+)\*\*\s*-\s*\$([\d.]+)\s*\(([^)]+)\)/,
    )
    if (optionMatch) {
      if (currentOption) result.flightOptions.push(currentOption)
      currentOption = {
        optionNumber: parseInt(optionMatch[1]),
        price: `$${optionMatch[2]}`,
        priceType: optionMatch[3],
        outbound: {},
        returnFlight: undefined,
      }
      currentSection = ""
      continue
    }

    // Detect outbound flight section
    if (trimmed.includes("🛫") && trimmed.includes("Outbound Flight")) {
      currentSection = "outbound"
      if (currentOption) currentOption.outbound = {}
      continue
    }

    // Detect return flight section
    if (trimmed.includes("🛬") && trimmed.includes("Return Flight")) {
      currentSection = "return"
      if (currentOption) currentOption.returnFlight = {}
      continue
    }

    // Parse flight details: - **Key**: Value
    if (currentOption && trimmed.startsWith("-")) {
      const detailMatch = trimmed.match(/-\s*\*\*([^*]+)\*\*:\s*(.+)/)
      if (detailMatch) {
        const key = detailMatch[1].toLowerCase().trim()
        const value = detailMatch[2].trim()

        if (currentSection === "outbound") {
          currentOption.outbound[key] = value
        } else if (currentSection === "return" && currentOption.returnFlight) {
          currentOption.returnFlight[key] = value
        }
      }
    }
  }

  if (currentOption) result.flightOptions.push(currentOption)

  return result
}

// Parse hotel-only response
const parseHotelsOnlyResponse = (content: string) => {
  const result: {
    location: string
    dates: string
    nights: number
    hotels: Array<{
      rank: number
      name: string
      pricePerNight: string
      totalPrice: string
      rating: string
      stars: string
      locationRating: string
      checkIn: string
    }>
  } = {
    location: "",
    dates: "",
    nights: 0,
    hotels: [],
  }

  const lines = content.split("\n")
  let currentHotel: any = null

  for (const line of lines) {
    const trimmed = line.trim()

    // Parse header: 🏨 **Top Hotels in Location**
    if (trimmed.includes("Hotels in")) {
      const locationMatch = trimmed.match(/Hotels in\s+([^*\n]+)/)
      if (locationMatch) result.location = locationMatch[1].trim()
    }

    // Parse dates
    if (trimmed.startsWith("Dates:")) {
      result.dates = trimmed.replace(/^Dates:\s*/, "").trim()
      const nightsMatch = trimmed.match(/\((\d+)\s*nights?\)/)
      if (nightsMatch) result.nights = parseInt(nightsMatch[1])
    }

    // Parse hotel entry: **1. Hotel Name**
    const hotelMatch = trimmed.match(/\*\*(\d+)\.\s*([^*]+)\*\*/)
    if (hotelMatch && !trimmed.includes("$")) {
      if (currentHotel) result.hotels.push(currentHotel)
      currentHotel = {
        rank: parseInt(hotelMatch[1]),
        name: hotelMatch[2].trim(),
        pricePerNight: "",
        totalPrice: "",
        rating: "",
        stars: "",
        locationRating: "",
        checkIn: "",
      }
    }

    // Parse price: 💰 $XX/night × N = $XX total
    if (currentHotel && trimmed.includes("💰")) {
      const priceMatch = trimmed.match(/\$([\d.]+)\/night/)
      const totalMatch = trimmed.match(
        /\*\*\$([\d.]+)\s*(?:total|for \d+ nights?)\*\*/,
      )
      if (priceMatch) currentHotel.pricePerNight = `$${priceMatch[1]}`
      if (totalMatch) currentHotel.totalPrice = `$${totalMatch[1]}`
    }

    // Parse rating: ⭐⭐⭐⭐ (X.X/5) | 📍 Location: X.X/5
    if (currentHotel && (trimmed.includes("⭐") || trimmed.includes("/5)"))) {
      const ratingMatch = trimmed.match(/\(([\d.]+)\/5\)/)
      if (ratingMatch) currentHotel.rating = ratingMatch[1]
      currentHotel.stars = (trimmed.match(/⭐/g) || []).length.toString()
      const locMatch = trimmed.match(/Location:\s*([\d.]+)/)
      if (locMatch) currentHotel.locationRating = locMatch[1]
    }

    // Parse check-in: 🕐 Check-in: X:XX PM
    if (currentHotel && trimmed.includes("Check-in:")) {
      const checkInMatch = trimmed.match(/Check-in:\s*(.+)/)
      if (checkInMatch) currentHotel.checkIn = checkInMatch[1].trim()
    }
  }

  if (currentHotel) result.hotels.push(currentHotel)

  return result
}

// Parse activity-only response
const parseActivitiesOnlyResponse = (content: string) => {
  const result: {
    location: string
    activities: Array<{
      name: string
      type: string
      address: string
      rating: string
      reviews: string
    }>
  } = {
    location: "",
    activities: [],
  }

  const lines = content.split("\n")

  for (const line of lines) {
    const trimmed = line.trim()

    // Parse header
    if (trimmed.includes("Things to Do in")) {
      const locationMatch = trimmed.match(/Things to Do in\s+([^*\n]+)/)
      if (locationMatch) result.location = locationMatch[1].trim()
    }

    // Parse activity: **1. Name** - Type
    const activityMatch = trimmed.match(
      /^\*\*\d+\.\s*([^*]+)\*\*(?:\s*-\s*(.+))?$/,
    )
    if (activityMatch) {
      result.activities.push({
        name: activityMatch[1].trim(),
        type: activityMatch[2]?.trim() ?? "",
        address: "",
        rating: "",
        reviews: "",
      })
    }

    // Parse address: 📍 Address
    if (trimmed.startsWith("📍") && result.activities.length > 0) {
      result.activities[result.activities.length - 1].address = trimmed
        .replace("📍", "")
        .trim()
    }

    // Parse rating: ⭐ X.X (XX reviews)
    if (trimmed.startsWith("⭐") && result.activities.length > 0) {
      const ratingMatch = trimmed.match(/⭐\s*([\d.]+)/)
      const reviewsMatch = trimmed.match(/\(([\d,]+)/)
      if (ratingMatch)
        result.activities[result.activities.length - 1].rating = ratingMatch[1]
      if (reviewsMatch)
        result.activities[result.activities.length - 1].reviews =
          reviewsMatch[1]
    }
  }

  return result
}

const extractAfterFirstColon = (str: string): string => {
  const colonIndex = str.indexOf(":")
  if (colonIndex === -1) return ""
  return str.substring(colonIndex + 1).trim()
}

const formatDateTime = (dateStr: string): string => {
  if (!dateStr) return ""
  const match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})(.*)/)
  if (match) {
    const [, year, month, day, rest] = match
    return `${month}-${day}-${year}${rest}`
  }
  return dateStr
}

// Format date ranges and individual dates from YYYY-MM-DD to MM-DD-YYYY
const formatDateRange = (dateStr: string): string => {
  if (!dateStr) return ""
  // Replace all occurrences of YYYY-MM-DD pattern
  return dateStr.replace(
    /(\d{4})-(\d{2})-(\d{2})/g,
    (_, year, month, day) => `${month}-${day}-${year}`,
  )
}

const parseFlightLine = (line: string, obj: Record<string, string>) => {
  const cleaned = line.replace(/^-\s*/, "").replace(/\*\*/g, "").trim()
  if (cleaned.includes("Airline:"))
    obj.airline = extractAfterFirstColon(cleaned)
  else if (cleaned.includes("Price:"))
    obj.price = extractAfterFirstColon(cleaned)
  else if (cleaned.includes("Departure:"))
    obj.departure = extractAfterFirstColon(cleaned)
  else if (cleaned.includes("Arrival:"))
    obj.arrival = extractAfterFirstColon(cleaned)
  else if (cleaned.includes("Stops:"))
    obj.stops = extractAfterFirstColon(cleaned)
}

const parseHotelLine = (line: string, obj: Record<string, string>) => {
  const cleaned = line.replace(/^-\s*/, "").replace(/\*\*/g, "").trim()
  if (cleaned.includes("Name:")) obj.name = extractAfterFirstColon(cleaned)
  else if (cleaned.includes("Price:"))
    obj.price = extractAfterFirstColon(cleaned)
  else if (cleaned.includes("Overall Rating:"))
    obj.rating = extractAfterFirstColon(cleaned).replace(/[⭐]/g, "").trim()
  else if (cleaned.includes("Location Rating:"))
    obj.locationRating = extractAfterFirstColon(cleaned)
  else if (cleaned.includes("Check-in:"))
    obj.checkIn = extractAfterFirstColon(cleaned)
}

// Main component
const TravelResponseCard: React.FC<TravelResponseCardProps> = ({ content }) => {
  const responseType = detectResponseType(content)

  switch (responseType) {
    case "full_trip":
      return <FullTripCard content={content} />
    case "flights_only":
      return <FlightsOnlyCard content={content} />
    case "hotels_only":
      return <HotelsOnlyCard content={content} />
    case "activities_only":
      return <ActivitiesOnlyCard content={content} />
    default:
      return <SimpleMarkdown content={content} />
  }
}

// Full Trip Card Component
const FullTripCard: React.FC<{ content: string }> = ({ content }) => {
  const sections = parseFullTripResponse(content)

  return (
    <div className="space-y-4">
      {sections.notice && (
        <p className="rounded-xl border border-travel-border bg-travel-accent-soft p-4 text-sm text-travel-accent">
          {sections.notice}
        </p>
      )}
      {(sections.intro || sections.totalCost) && (
        <div className="rounded-xl border border-travel-border p-4">
          {sections.intro && (
            <h3
              data-trip-result-heading
              className="font-semibold text-travel-text"
            >
              {sections.intro}
            </h3>
          )}
          {sections.totalCost && (
            <p className="text-sm text-travel-muted">
              Total trip cost:{" "}
              <span className="font-semibold text-travel-text">
                {sections.totalCost}
              </span>
            </p>
          )}
        </div>
      )}

      {/* Cost Breakdown */}
      {(sections.flightCost || sections.hotelCost) && (
        <div className="grid grid-cols-2 gap-3">
          {sections.flightCost && (
            <div className="flex items-center gap-3 rounded-lg border border-travel-border bg-travel-surface p-3">
              <Plane className="h-5 w-5 text-travel-accent" />
              <div>
                <p className="text-xs text-travel-muted">Flights</p>
                <p className="font-semibold text-travel-text">
                  {sections.flightCost}
                </p>
              </div>
            </div>
          )}
          {sections.hotelCost && (
            <div className="flex items-center gap-3 rounded-lg border border-travel-border bg-travel-surface p-3">
              <Hotel className="h-5 w-5 text-travel-accent" />
              <div>
                <p className="text-xs text-travel-muted">Hotel</p>
                <p className="font-semibold text-travel-text">
                  {sections.hotelCost}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Outbound Flight Card */}
      {sections.outboundFlight &&
        Object.keys(sections.outboundFlight).length > 0 && (
          <FlightCard
            title="Outbound Flight"
            flight={sections.outboundFlight}
          />
        )}

      {/* Return Flight Card */}
      {sections.returnFlight &&
        Object.keys(sections.returnFlight).length > 0 && (
          <FlightCard title="Return Flight" flight={sections.returnFlight} />
        )}

      {/* Hotel Card */}
      {sections.hotel && Object.keys(sections.hotel).length > 0 && (
        <HotelCard hotel={sections.hotel} />
      )}

      {/* Activities Card */}
      {sections.activities && sections.activities.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-travel-border bg-travel-surface">
          <div className="flex items-center gap-2 border-b border-travel-border px-4 py-3">
            <h3 className="font-semibold text-travel-text">Things to Do</h3>
          </div>
          <div className="space-y-3 p-4">
            {sections.activities.map((activity, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-travel-raised"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-travel-text">
                    {activity.name}
                  </p>
                  <div className="mt-1 flex items-center gap-3 text-xs text-travel-muted">
                    {activity.type && <span>{activity.type}</span>}
                    {activity.rating && (
                      <span className="flex items-center gap-1">
                        <Star className="h-3 w-3 fill-current text-travel-warning" />
                        {activity.rating}
                      </span>
                    )}
                    {activity.reviews && <span>({activity.reviews})</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trip Summary */}
      {sections.tripSummary && sections.tripSummary.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-travel-border bg-travel-surface">
          <div className="flex items-center gap-2 border-b border-travel-border px-4 py-3">
            <h3 className="font-semibold text-travel-text">Trip Summary</h3>
          </div>
          <div className="space-y-2 p-4">
            {sections.tripSummary
              .filter(
                (item) =>
                  !item.toLowerCase().includes("buffer to hotel") &&
                  !item.toLowerCase().includes("outbound arrival"),
              )
              .map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 text-sm text-travel-muted"
                >
                  <span className="mt-0.5 text-travel-accent">•</span>
                  <span>
                    {item.replace(
                      /(\d{4})-(\d{2})-(\d{2})/g,
                      (_, y, m, d) => `${m}-${d}-${y}`,
                    )}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Flights Only Card Component - Card style similar to full trip
const FlightsOnlyCard: React.FC<{ content: string }> = ({ content }) => {
  const data = parseFlightsOnlyResponse(content)
  if (!data.flightOptions.length) return <SimpleMarkdown content={content} />

  return (
    <div className="space-y-4">
      {/* Header */}
      <header className="space-y-1">
        <h3 data-trip-result-heading className="font-semibold text-travel-text">
          {data.isOneWay ? "One-Way" : "Round-Trip"} Flights: {data.route}
        </h3>
        {data.date && (
          <p className="text-sm text-travel-muted">
            {formatDateRange(data.date)}
          </p>
        )}
      </header>

      {/* Flight Options - Card style like full trip */}
      <div className="space-y-6">
        {data.flightOptions.map((option, idx) => (
          <div key={idx} className="space-y-3">
            {/* Option Header */}
            <div className="flex items-center justify-between gap-2">
              {data.flightOptions.length > 1 && (
                <span className="font-medium text-travel-text">
                  Option {option.optionNumber}
                </span>
              )}
              <span className="text-sm font-semibold text-travel-accent">
                {option.price} ({option.priceType})
              </span>
            </div>

            {/* Outbound Flight Card */}
            {option.outbound && Object.keys(option.outbound).length > 0 && (
              <div className="overflow-hidden rounded-xl border border-travel-border bg-travel-surface">
                <div className="flex items-center justify-between border-b border-travel-border px-4 py-3">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-travel-text">
                      Outbound Flight
                    </h3>
                  </div>
                </div>
                <div className="space-y-3 p-4 text-sm">
                  <div className="flex items-center justify-between">
                    {option.outbound.airline && (
                      <div className="flex items-center gap-2">
                        <span className="text-travel-muted">Airline:</span>
                        <span className="font-medium text-travel-text">
                          {option.outbound.airline}
                        </span>
                      </div>
                    )}
                    {option.outbound.stops && (
                      <div className="flex items-center gap-2">
                        <span className="text-travel-muted">Stops:</span>
                        <span
                          className={`font-medium ${option.outbound.stops.includes("0") || option.outbound.stops.toLowerCase().includes("non-stop") ? "text-travel-accent" : "text-travel-warning"}`}
                        >
                          {option.outbound.stops}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4 border-t border-travel-border pt-2">
                    {option.outbound.departure && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-travel-muted">
                          <Calendar className="h-3.5 w-3.5" />
                          <span className="text-xs tracking-wide uppercase">
                            Departure
                          </span>
                        </div>
                        <p className="font-medium text-travel-text">
                          {formatDateTime(option.outbound.departure)}
                        </p>
                      </div>
                    )}
                    {option.outbound.arrival && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-travel-muted">
                          <Clock className="h-3.5 w-3.5" />
                          <span className="text-xs tracking-wide uppercase">
                            Arrival
                          </span>
                        </div>
                        <p className="font-medium text-travel-text">
                          {formatDateTime(option.outbound.arrival)}
                        </p>
                      </div>
                    )}
                  </div>
                  {option.outbound.layover && (
                    <div className="border-t border-travel-border pt-2 text-travel-muted">
                      Layover: {option.outbound.layover}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Return Flight Card - only for round-trip */}
            {!data.isOneWay &&
              option.returnFlight &&
              Object.keys(option.returnFlight).length > 0 && (
                <div className="overflow-hidden rounded-xl border border-travel-border bg-travel-surface">
                  <div className="flex items-center justify-between border-b border-travel-border px-4 py-3">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-travel-text">
                        Return Flight
                      </h3>
                    </div>
                  </div>
                  <div className="space-y-3 p-4 text-sm">
                    <div className="flex items-center justify-between">
                      {option.returnFlight.airline && (
                        <div className="flex items-center gap-2">
                          <span className="text-travel-muted">Airline:</span>
                          <span className="font-medium text-travel-text">
                            {option.returnFlight.airline}
                          </span>
                        </div>
                      )}
                      {option.returnFlight.stops && (
                        <div className="flex items-center gap-2">
                          <span className="text-travel-muted">Stops:</span>
                          <span
                            className={`font-medium ${option.returnFlight.stops.includes("0") || option.returnFlight.stops.toLowerCase().includes("non-stop") ? "text-travel-accent" : "text-travel-warning"}`}
                          >
                            {option.returnFlight.stops}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4 border-t border-travel-border pt-2">
                      {option.returnFlight.departure && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-travel-muted">
                            <Calendar className="h-3.5 w-3.5" />
                            <span className="text-xs tracking-wide uppercase">
                              Departure
                            </span>
                          </div>
                          <p className="font-medium text-travel-text">
                            {formatDateTime(option.returnFlight.departure)}
                          </p>
                        </div>
                      )}
                      {option.returnFlight.arrival && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-travel-muted">
                            <Clock className="h-3.5 w-3.5" />
                            <span className="text-xs tracking-wide uppercase">
                              Arrival
                            </span>
                          </div>
                          <p className="font-medium text-travel-text">
                            {formatDateTime(option.returnFlight.arrival)}
                          </p>
                        </div>
                      )}
                    </div>
                    {option.returnFlight.layover && (
                      <div className="border-t border-travel-border pt-2 text-travel-muted">
                        Layover: {option.returnFlight.layover}
                      </div>
                    )}
                  </div>
                </div>
              )}
          </div>
        ))}
      </div>
    </div>
  )
}

// Hotels Only Card Component
const HotelsOnlyCard: React.FC<{ content: string }> = ({ content }) => {
  const data = parseHotelsOnlyResponse(content)
  if (!data.hotels.length) return <SimpleMarkdown content={content} />

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 rounded-xl border border-travel-border bg-travel-surface p-4">
        <div>
          <h3
            data-trip-result-heading
            className="font-semibold text-travel-text"
          >
            Top Hotels in {data.location}
          </h3>
          <p className="text-sm text-travel-muted">
            {formatDateRange(data.dates)}
          </p>
        </div>
      </div>

      {/* Hotel List */}
      <div className="space-y-3">
        {data.hotels.slice(0, 10).map((hotel, idx) => (
          <div
            key={idx}
            className="overflow-hidden rounded-xl border border-travel-border bg-travel-surface"
          >
            <div className="flex items-center justify-between border-b border-travel-border bg-travel-raised px-4 py-3">
              <div className="flex items-center gap-3">
                {data.hotels.length > 1 && (
                  <span className="text-sm text-travel-muted">
                    {hotel.rank}.
                  </span>
                )}
                <span className="max-w-[200px] truncate font-medium text-travel-text">
                  {hotel.name}
                </span>
              </div>
              {hotel.totalPrice && (
                <span className="text-sm font-semibold text-travel-accent">
                  {hotel.totalPrice}
                </span>
              )}
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <Star className="h-4 w-4 fill-current text-travel-warning" />
                  <span className="text-travel-text">{hotel.rating}/5</span>
                  {hotel.stars && (
                    <span className="text-travel-warning">
                      {"⭐".repeat(Math.min(parseInt(hotel.stars), 5))}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-travel-muted" />
                  <span className="text-travel-muted">
                    Location: {hotel.locationRating}/5
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-travel-muted">
                    {hotel.pricePerNight}/night
                  </span>
                </div>
                {hotel.checkIn && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-travel-muted" />
                    <span className="text-travel-muted">
                      Check-in: {hotel.checkIn}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Activities Only Card Component
const ActivitiesOnlyCard: React.FC<{ content: string }> = ({ content }) => {
  const data = parseActivitiesOnlyResponse(content)
  if (!data.activities.length) return <SimpleMarkdown content={content} />

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 rounded-xl border border-travel-border bg-travel-surface p-4">
        <div>
          <h3
            data-trip-result-heading
            className="font-semibold text-travel-text"
          >
            Things to Do in {data.location}
          </h3>
        </div>
      </div>

      {/* Activity List */}
      <div className="space-y-3">
        {data.activities.slice(0, 10).map((activity, idx) => (
          <div
            key={idx}
            className="overflow-hidden rounded-xl border border-travel-border bg-travel-surface"
          >
            <div className="flex items-start gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-travel-text">{activity.name}</p>
                <p className="mt-1 text-sm text-travel-muted">
                  {activity.type}
                </p>
                <div className="mt-2 flex items-center gap-4 text-sm">
                  {activity.address && (
                    <span className="flex items-center gap-1 text-travel-muted">
                      <MapPin className="h-3 w-3" />
                      {activity.address}
                    </span>
                  )}
                  {activity.rating && (
                    <span className="flex items-center gap-1 text-travel-warning">
                      <Star className="h-3 w-3 fill-yellow-400" />
                      {activity.rating}
                    </span>
                  )}
                  {activity.reviews && (
                    <span className="text-travel-muted">
                      ({activity.reviews} reviews)
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Flight Card Component (for full trip)
const FlightCard: React.FC<{
  title: string
  flight: Record<string, string>
}> = ({ title, flight }) => {
  return (
    <div className="overflow-hidden rounded-xl border border-travel-border bg-travel-surface">
      <div className="flex items-center justify-between border-b border-travel-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-travel-text">{title}</h3>
        </div>
        {flight.price && (
          <span className="text-sm font-semibold text-travel-accent">
            {flight.price}
          </span>
        )}
      </div>
      <div className="space-y-3 p-4 text-sm">
        <div className="flex items-center justify-between">
          {flight.airline && (
            <div className="flex items-center gap-2">
              <span className="text-travel-muted">Airline:</span>
              <span className="font-medium text-travel-text">
                {flight.airline}
              </span>
            </div>
          )}
          {flight.stops && (
            <div className="flex items-center gap-2">
              <span className="text-travel-muted">Stops:</span>
              <span
                className={`font-medium ${flight.stops.includes("0") || flight.stops.includes("Non-stop") ? "text-travel-accent" : "text-travel-warning"}`}
              >
                {flight.stops.includes("0") ? "Non-stop" : flight.stops}
              </span>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 border-t border-travel-border pt-2">
          {flight.departure && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-travel-muted">
                <Calendar className="h-3.5 w-3.5" />
                <span className="text-xs tracking-wide uppercase">
                  Departure
                </span>
              </div>
              <p className="font-medium text-travel-text">
                {formatDateTime(flight.departure)}
              </p>
            </div>
          )}
          {flight.arrival && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-travel-muted">
                <Clock className="h-3.5 w-3.5" />
                <span className="text-xs tracking-wide uppercase">Arrival</span>
              </div>
              <p className="font-medium text-travel-text">
                {formatDateTime(flight.arrival)}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Hotel Card Component (for full trip)
const HotelCard: React.FC<{ hotel: Record<string, string> }> = ({ hotel }) => {
  return (
    <div className="overflow-hidden rounded-xl border border-travel-border bg-travel-surface">
      <div className="flex items-center justify-between border-b border-travel-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-travel-text">Hotel</h3>
        </div>
        {hotel.price && (
          <span className="text-sm font-semibold text-travel-accent">
            {hotel.price}
          </span>
        )}
      </div>
      <div className="p-4">
        {hotel.name && (
          <h4 className="mb-3 text-lg font-semibold text-travel-text">
            {hotel.name}
          </h4>
        )}
        <div className="grid grid-cols-2 gap-3 text-sm">
          {hotel.rating && (
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 fill-current text-travel-warning" />
              <span className="text-travel-text">{hotel.rating}</span>
            </div>
          )}
          {hotel.locationRating && (
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-travel-muted" />
              <span className="text-travel-text">{hotel.locationRating}</span>
            </div>
          )}
          {hotel.checkIn && (
            <div className="col-span-2 flex items-center gap-2">
              <Clock className="h-4 w-4 text-travel-muted" />
              <span className="text-travel-muted">Check-in:</span>
              <span className="text-travel-text">{hotel.checkIn}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Legacy and general replies still support Markdown without injecting provider HTML.
const SimpleMarkdown: React.FC<{ content: string }> = ({ content }) => (
  <div className="space-y-2 whitespace-pre-wrap text-travel-muted [&_a]:text-travel-accent [&_a]:underline [&_a]:underline-offset-2 [&_strong]:text-travel-text">
    <ReactMarkdown>{content}</ReactMarkdown>
  </div>
)

function budgetHeading(budget: BudgetAssessment) {
  if (budget.status === "unknown") return "Budget not verified"
  if (typeof budget.quoted_total !== "number" || !Number.isFinite(budget.limit))
    return budget.status === "within"
      ? "Within budget for quoted costs"
      : "Over budget"
  const difference =
    Math.round((budget.quoted_total - budget.limit) * 100) / 100
  if (difference === 0) return "Quote matches your budget"
  return `Quote is ${formatFare(Math.abs(difference))} ${difference < 0 ? "under" : "over"} budget`
}

function OriginalResponse({ content }: { content: string }) {
  return (
    <details className="mt-3 text-sm text-travel-muted">
      <summary className="w-fit cursor-pointer py-1 underline-offset-4 hover:underline">
        Original response
      </summary>
      <div className="mt-2">
        <SimpleMarkdown content={content} />
      </div>
    </details>
  )
}

const TravelResponseWithBudget: React.FC<TravelResponseCardProps> = ({
  content,
  budget,
  travelResult,
}) => {
  const prefix = budget ? `${budget.message}\n\n` : ""
  const body =
    prefix && content.startsWith(prefix)
      ? content.slice(prefix.length)
      : content
  const structured = parseTravelResult(travelResult)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const hasOriginal = Boolean(
    body.trim() && body.trim() !== structured?.notice.trim(),
  )
  return (
    <>
      {budget && (
        <section
          aria-label="Budget assessment"
          className={`mb-4 rounded-xl border p-4 text-sm ${budget.status === "within" ? "border-travel-border bg-travel-accent-soft text-travel-text" : "border-travel-warning-border bg-travel-warning-soft text-travel-warning"}`}
        >
          <h3 className="mb-1 font-semibold">{budgetHeading(budget)}</h3>
          <p>
            {budget.status === "within"
              ? budget.message.replace(/^Within quoted-cost budget:\s*/, "")
              : budget.message}
          </p>
        </section>
      )}
      {structured ? (
        <StructuredTravelResultCard
          result={structured}
          allowFlightControls
          saveFlights
          headerAction={
            hasOriginal && (
              <ActionMenu
                label="Result actions"
                icon={<Ellipsis aria-hidden="true" className="size-5" />}
                buttonClassName="flex size-10 items-center justify-center rounded-lg text-travel-muted hover:bg-travel-selected hover:text-travel-text focus-visible:outline-2 focus-visible:outline-travel-accent"
                panelClassName="absolute right-0 top-full z-20 mt-1 min-w-44 rounded-lg border border-travel-border bg-travel-surface p-1 shadow-lg"
                actions={[
                  {
                    label: detailsOpen
                      ? "Hide original response"
                      : "Original response",
                    onSelect: () => setDetailsOpen((open) => !open),
                  },
                ]}
              />
            )
          }
          responseDetails={
            hasOriginal &&
            detailsOpen && (
              <section
                aria-label="Original response"
                className="rounded-lg border border-travel-border bg-travel-surface p-3 text-sm"
              >
                <SimpleMarkdown content={body} />
              </section>
            )
          }
        />
      ) : (
        <>
          <TravelResponseCard content={body} />
          {detectResponseType(body) !== "simple" && (
            <OriginalResponse content={body} />
          )}
        </>
      )}
    </>
  )
}

export default TravelResponseWithBudget
