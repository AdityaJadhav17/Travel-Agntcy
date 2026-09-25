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

import React from "react"
import { BudgetAssessment } from "@/types/budget"
import {
  Plane,
  Hotel,
  Calendar,
  Clock,
  MapPin,
  Star,
  Activity,
} from "lucide-react"

interface TravelResponseCardProps {
  content: string
  budget?: BudgetAssessment | null
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

    // Detect sections
    if (
      trimmed.includes("Great news") ||
      trimmed.includes("found the best") ||
      trimmed.includes("lowest eligible quote among")
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
      const totalMatch = trimmed.match(/\*\*\$([\d.]+)\s*total\*\*/)
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
      rank: number
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
    const activityMatch = trimmed.match(/\*\*(\d+)\.\s*([^*]+)\*\*\s*-\s*(.+)/)
    if (activityMatch) {
      result.activities.push({
        rank: parseInt(activityMatch[1]),
        name: activityMatch[2].trim(),
        type: activityMatch[3].trim(),
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
      {/* Success Header */}
      {sections.intro && (
        <div className="flex items-center gap-3 rounded-xl border border-[#3ce98a]/30 bg-gradient-to-r from-[#3ce98a]/20 to-[#5feb9b]/10 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#3ce98a]">
            <span className="text-xl">🎉</span>
          </div>
          <div>
            <p className="font-semibold text-white">{sections.intro}</p>
            {sections.totalCost && (
              <p className="text-sm text-[#5feb9b]">
                Total trip cost:{" "}
                <span className="font-bold text-white">
                  {sections.totalCost}
                </span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Cost Breakdown */}
      {(sections.flightCost || sections.hotelCost) && (
        <div className="grid grid-cols-2 gap-3">
          {sections.flightCost && (
            <div className="flex items-center gap-3 rounded-lg border border-gray-700 bg-[#2a2a2a] p-3">
              <Plane className="h-5 w-5 text-[#5feb9b]" />
              <div>
                <p className="text-xs text-gray-400">Flights</p>
                <p className="font-semibold text-white">
                  {sections.flightCost}
                </p>
              </div>
            </div>
          )}
          {sections.hotelCost && (
            <div className="flex items-center gap-3 rounded-lg border border-gray-700 bg-[#2a2a2a] p-3">
              <Hotel className="h-5 w-5 text-[#5feb9b]" />
              <div>
                <p className="text-xs text-gray-400">Hotel</p>
                <p className="font-semibold text-white">{sections.hotelCost}</p>
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
            icon="🛫"
            flight={sections.outboundFlight}
          />
        )}

      {/* Return Flight Card */}
      {sections.returnFlight &&
        Object.keys(sections.returnFlight).length > 0 && (
          <FlightCard
            title="Return Flight"
            icon="🛬"
            flight={sections.returnFlight}
          />
        )}

      {/* Hotel Card */}
      {sections.hotel && Object.keys(sections.hotel).length > 0 && (
        <HotelCard hotel={sections.hotel} />
      )}

      {/* Activities Card */}
      {sections.activities && sections.activities.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-gray-700 bg-[#2a2a2a]">
          <div className="flex items-center gap-2 border-b border-gray-700 bg-gradient-to-r from-orange-500/20 to-transparent px-4 py-3">
            <span className="text-lg">🎯</span>
            <h3 className="font-semibold text-white">Things to Do</h3>
          </div>
          <div className="space-y-3 p-4">
            {sections.activities.map((activity, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-[#333]"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500/20 text-sm font-bold text-orange-400">
                  {idx + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-white">
                    {activity.name}
                  </p>
                  <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                    {activity.type && <span>{activity.type}</span>}
                    {activity.rating && (
                      <span className="flex items-center gap-1">
                        <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
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
        <div className="overflow-hidden rounded-xl border border-gray-700 bg-[#2a2a2a]">
          <div className="flex items-center gap-2 border-b border-gray-700 bg-gradient-to-r from-[#3ce98a]/20 to-transparent px-4 py-3">
            <span className="text-lg">📋</span>
            <h3 className="font-semibold text-white">Trip Summary</h3>
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
                  className="flex items-start gap-2 text-sm text-gray-300"
                >
                  <span className="mt-0.5 text-[#5feb9b]">•</span>
                  <span>
                    {item.replace(
                      /(\d{4})-(\d{2})-(\d{2})/g,
                      (_, y, m, d) => `${m}-${d}-${y}`,
                    )}
                  </span>
                </div>
              ))}
            {sections.totalCost && (
              <div className="mt-2 flex items-start gap-2 border-t border-gray-700 pt-2 text-sm text-gray-300">
                <span className="mt-0.5 text-[#5feb9b]">💰</span>
                <span>
                  <strong className="text-white">Total Trip Cost:</strong>{" "}
                  <span className="font-semibold text-[#5feb9b]">
                    {sections.totalCost}
                  </span>
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Flights Only Card Component - Card style similar to full trip
const FlightsOnlyCard: React.FC<{ content: string }> = ({ content }) => {
  const data = parseFlightsOnlyResponse(content)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 rounded-xl border border-blue-500/30 bg-gradient-to-r from-blue-500/20 to-blue-600/10 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500">
          <Plane className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="font-semibold text-white">
            {data.isOneWay ? "One-Way" : "Round-Trip"} Flights: {data.route}
          </p>
          <p className="text-sm text-blue-400">{formatDateRange(data.date)}</p>
        </div>
      </div>

      {/* Flight Options - Card style like full trip */}
      <div className="space-y-6">
        {data.flightOptions.map((option, idx) => (
          <div key={idx} className="space-y-3">
            {/* Option Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-sm font-bold text-white">
                  {option.optionNumber}
                </span>
                <span className="font-medium text-white">
                  Option {option.optionNumber}
                </span>
              </div>
              <span className="rounded-full bg-[#3ce98a]/20 px-4 py-1.5 text-sm font-semibold text-[#5feb9b]">
                {option.price} ({option.priceType})
              </span>
            </div>

            {/* Outbound Flight Card */}
            {option.outbound && Object.keys(option.outbound).length > 0 && (
              <div className="overflow-hidden rounded-xl border border-gray-700 bg-[#2a2a2a]">
                <div className="flex items-center justify-between border-b border-gray-700 bg-gradient-to-r from-blue-500/20 to-transparent px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🛫</span>
                    <h3 className="font-semibold text-white">
                      Outbound Flight
                    </h3>
                  </div>
                  <span className="rounded-full bg-[#3ce98a]/20 px-3 py-1 text-sm font-semibold text-[#5feb9b]">
                    {option.price}
                  </span>
                </div>
                <div className="space-y-3 p-4 text-sm">
                  <div className="flex items-center justify-between">
                    {option.outbound.airline && (
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">Airline:</span>
                        <span className="font-medium text-white">
                          {option.outbound.airline}
                        </span>
                      </div>
                    )}
                    {option.outbound.stops && (
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">Stops:</span>
                        <span
                          className={`font-medium ${option.outbound.stops.includes("0") || option.outbound.stops.toLowerCase().includes("non-stop") ? "text-[#5feb9b]" : "text-yellow-400"}`}
                        >
                          {option.outbound.stops}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4 border-t border-gray-700 pt-2">
                    {option.outbound.departure && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-gray-500">
                          <Calendar className="h-3.5 w-3.5" />
                          <span className="text-xs uppercase tracking-wide">
                            Departure
                          </span>
                        </div>
                        <p className="font-medium text-white">
                          {formatDateTime(option.outbound.departure)}
                        </p>
                      </div>
                    )}
                    {option.outbound.arrival && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-gray-500">
                          <Clock className="h-3.5 w-3.5" />
                          <span className="text-xs uppercase tracking-wide">
                            Arrival
                          </span>
                        </div>
                        <p className="font-medium text-white">
                          {formatDateTime(option.outbound.arrival)}
                        </p>
                      </div>
                    )}
                  </div>
                  {option.outbound.layover && (
                    <div className="border-t border-gray-700 pt-2 text-gray-400">
                      🔄 Layover: {option.outbound.layover}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Return Flight Card - only for round-trip */}
            {!data.isOneWay &&
              option.returnFlight &&
              Object.keys(option.returnFlight).length > 0 && (
                <div className="overflow-hidden rounded-xl border border-gray-700 bg-[#2a2a2a]">
                  <div className="flex items-center justify-between border-b border-gray-700 bg-gradient-to-r from-purple-500/20 to-transparent px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🛬</span>
                      <h3 className="font-semibold text-white">
                        Return Flight
                      </h3>
                    </div>
                  </div>
                  <div className="space-y-3 p-4 text-sm">
                    <div className="flex items-center justify-between">
                      {option.returnFlight.airline && (
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500">Airline:</span>
                          <span className="font-medium text-white">
                            {option.returnFlight.airline}
                          </span>
                        </div>
                      )}
                      {option.returnFlight.stops && (
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500">Stops:</span>
                          <span
                            className={`font-medium ${option.returnFlight.stops.includes("0") || option.returnFlight.stops.toLowerCase().includes("non-stop") ? "text-[#5feb9b]" : "text-yellow-400"}`}
                          >
                            {option.returnFlight.stops}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4 border-t border-gray-700 pt-2">
                      {option.returnFlight.departure && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-gray-500">
                            <Calendar className="h-3.5 w-3.5" />
                            <span className="text-xs uppercase tracking-wide">
                              Departure
                            </span>
                          </div>
                          <p className="font-medium text-white">
                            {formatDateTime(option.returnFlight.departure)}
                          </p>
                        </div>
                      )}
                      {option.returnFlight.arrival && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-gray-500">
                            <Clock className="h-3.5 w-3.5" />
                            <span className="text-xs uppercase tracking-wide">
                              Arrival
                            </span>
                          </div>
                          <p className="font-medium text-white">
                            {formatDateTime(option.returnFlight.arrival)}
                          </p>
                        </div>
                      )}
                    </div>
                    {option.returnFlight.layover && (
                      <div className="border-t border-gray-700 pt-2 text-gray-400">
                        🔄 Layover: {option.returnFlight.layover}
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 rounded-xl border border-purple-500/30 bg-gradient-to-r from-purple-500/20 to-purple-600/10 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-500">
          <Hotel className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="font-semibold text-white">
            Top Hotels in {data.location}
          </p>
          <p className="text-sm text-purple-400">
            {formatDateRange(data.dates)}
          </p>
        </div>
      </div>

      {/* Hotel List */}
      <div className="space-y-3">
        {data.hotels.slice(0, 10).map((hotel, idx) => (
          <div
            key={idx}
            className="overflow-hidden rounded-xl border border-gray-700 bg-[#2a2a2a]"
          >
            <div className="flex items-center justify-between border-b border-gray-700 bg-[#333] px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-500/20 text-xs font-bold text-purple-400">
                  {hotel.rank}
                </span>
                <span className="max-w-[200px] truncate font-medium text-white">
                  {hotel.name}
                </span>
              </div>
              {hotel.totalPrice && (
                <span className="rounded-full bg-[#3ce98a]/20 px-3 py-1 text-sm font-semibold text-[#5feb9b]">
                  {hotel.totalPrice}
                </span>
              )}
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  <span className="text-white">{hotel.rating}/5</span>
                  {hotel.stars && (
                    <span className="text-yellow-400">
                      {"⭐".repeat(Math.min(parseInt(hotel.stars), 5))}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-gray-500" />
                  <span className="text-gray-400">
                    Location: {hotel.locationRating}/5
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">
                    {hotel.pricePerNight}/night
                  </span>
                </div>
                {hotel.checkIn && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-gray-500" />
                    <span className="text-gray-400">
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 rounded-xl border border-orange-500/30 bg-gradient-to-r from-orange-500/20 to-orange-600/10 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-500">
          <Activity className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="font-semibold text-white">
            Things to Do in {data.location}
          </p>
          <p className="text-sm text-orange-400">
            Top attractions and activities
          </p>
        </div>
      </div>

      {/* Activity List */}
      <div className="space-y-3">
        {data.activities.slice(0, 10).map((activity, idx) => (
          <div
            key={idx}
            className="overflow-hidden rounded-xl border border-gray-700 bg-[#2a2a2a]"
          >
            <div className="flex items-start gap-3 p-4">
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-orange-500/20 text-sm font-bold text-orange-400">
                {activity.rank}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-white">{activity.name}</p>
                <p className="mt-1 text-sm text-gray-400">{activity.type}</p>
                <div className="mt-2 flex items-center gap-4 text-sm">
                  {activity.address && (
                    <span className="flex items-center gap-1 text-gray-500">
                      <MapPin className="h-3 w-3" />
                      {activity.address}
                    </span>
                  )}
                  {activity.rating && (
                    <span className="flex items-center gap-1 text-yellow-400">
                      <Star className="h-3 w-3 fill-yellow-400" />
                      {activity.rating}
                    </span>
                  )}
                  {activity.reviews && (
                    <span className="text-gray-500">
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
  icon: string
  flight: Record<string, string>
}> = ({ title, icon, flight }) => {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-700 bg-[#2a2a2a]">
      <div className="flex items-center justify-between border-b border-gray-700 bg-gradient-to-r from-blue-500/20 to-transparent px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <h3 className="font-semibold text-white">{title}</h3>
        </div>
        {flight.price && (
          <span className="rounded-full bg-[#3ce98a]/20 px-3 py-1 text-sm font-semibold text-[#5feb9b]">
            {flight.price}
          </span>
        )}
      </div>
      <div className="space-y-3 p-4 text-sm">
        <div className="flex items-center justify-between">
          {flight.airline && (
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Airline:</span>
              <span className="font-medium text-white">{flight.airline}</span>
            </div>
          )}
          {flight.stops && (
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Stops:</span>
              <span
                className={`font-medium ${flight.stops.includes("0") || flight.stops.includes("Non-stop") ? "text-[#5feb9b]" : "text-yellow-400"}`}
              >
                {flight.stops.includes("0") ? "Non-stop" : flight.stops}
              </span>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 border-t border-gray-700 pt-2">
          {flight.departure && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-gray-500">
                <Calendar className="h-3.5 w-3.5" />
                <span className="text-xs uppercase tracking-wide">
                  Departure
                </span>
              </div>
              <p className="font-medium text-white">
                {formatDateTime(flight.departure)}
              </p>
            </div>
          )}
          {flight.arrival && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-gray-500">
                <Clock className="h-3.5 w-3.5" />
                <span className="text-xs uppercase tracking-wide">Arrival</span>
              </div>
              <p className="font-medium text-white">
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
    <div className="overflow-hidden rounded-xl border border-gray-700 bg-[#2a2a2a]">
      <div className="flex items-center justify-between border-b border-gray-700 bg-gradient-to-r from-purple-500/20 to-transparent px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🏨</span>
          <h3 className="font-semibold text-white">Hotel</h3>
        </div>
        {hotel.price && (
          <span className="rounded-full bg-[#3ce98a]/20 px-3 py-1 text-sm font-semibold text-[#5feb9b]">
            {hotel.price}
          </span>
        )}
      </div>
      <div className="p-4">
        {hotel.name && (
          <h4 className="mb-3 text-lg font-semibold text-white">
            {hotel.name}
          </h4>
        )}
        <div className="grid grid-cols-2 gap-3 text-sm">
          {hotel.rating && (
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
              <span className="text-white">{hotel.rating}</span>
            </div>
          )}
          {hotel.locationRating && (
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-gray-500" />
              <span className="text-white">{hotel.locationRating}</span>
            </div>
          )}
          {hotel.checkIn && (
            <div className="col-span-2 flex items-center gap-2">
              <Clock className="h-4 w-4 text-gray-500" />
              <span className="text-gray-400">Check-in:</span>
              <span className="text-white">{hotel.checkIn}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Simple markdown for other responses
const SimpleMarkdown: React.FC<{ content: string }> = ({ content }) => {
  const renderLine = (line: string, idx: number) => {
    let processed = line
    processed = processed.replace(
      /\*\*([^*]+)\*\*/g,
      '<strong class="font-semibold text-white">$1</strong>',
    )

    if (processed.trim().startsWith("- ")) {
      const bulletContent = processed.trim().substring(2)
      return (
        <div key={idx} className="flex items-start gap-2 text-gray-300">
          <span className="mt-1 text-[#5feb9b]">•</span>
          <span dangerouslySetInnerHTML={{ __html: bulletContent }} />
        </div>
      )
    }

    if (processed.trim() === "---") {
      return <hr key={idx} className="my-3 border-gray-700" />
    }

    if (!processed.trim()) {
      return <div key={idx} className="h-2" />
    }

    return (
      <p
        key={idx}
        className="text-gray-300"
        dangerouslySetInnerHTML={{ __html: processed }}
      />
    )
  }

  return (
    <div className="space-y-1">
      {content.split("\n").map((line, idx) => renderLine(line, idx))}
    </div>
  )
}

const TravelResponseWithBudget: React.FC<TravelResponseCardProps> = ({
  content,
  budget,
}) => {
  const prefix = budget ? `${budget.message}\n\n` : ""
  const body =
    prefix && content.startsWith(prefix)
      ? content.slice(prefix.length)
      : content
  return (
    <>
      {budget && (
        <section
          aria-label="Budget assessment"
          className={`mb-4 rounded-xl border p-4 text-sm ${budget.status === "within" ? "border-emerald-700 bg-emerald-950/30 text-emerald-100" : "border-amber-700 bg-amber-950/30 text-amber-100"}`}
        >
          <h3 className="mb-1 font-semibold">
            {budget.status === "within"
              ? "Within quoted-cost budget"
              : budget.status === "over"
                ? "Over budget"
                : "Budget not verified"}
          </h3>
          <p>{budget.message}</p>
        </section>
      )}
      <TravelResponseCard content={body} />
    </>
  )
}

export default TravelResponseWithBudget
