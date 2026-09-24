/**
 * Copyright AGNTCY Contributors (https://github.com/agntcy)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Travel Prompts Dropdown Component
 *
 * This component displays suggested travel search prompts to help users
 * understand what the travel agent can do. It fetches prompts from the
 * travel supervisor's /suggested-prompts endpoint.
 **/

import React, { useState, useRef, useEffect } from "react"
import { Plane } from "lucide-react"
import LoadingSpinner from "./LoadingSpinner"
import { PromptCategory } from "./PromptTypes"

// API URL for the travel supervisor
const DEFAULT_TRAVEL_API_URL = "http://127.0.0.1:8000"
const TRAVEL_API_URL =
  import.meta.env.VITE_EXCHANGE_APP_API_URL || DEFAULT_TRAVEL_API_URL

interface TravelPromptsDropdownProps {
  visible: boolean
  onSelect: (query: string) => void
  pattern?: string
}

const TravelPromptsDropdown: React.FC<TravelPromptsDropdownProps> = ({
  visible,
  onSelect,
  pattern,
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [categories, setCategories] = useState<PromptCategory[]>([])
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Fetch travel prompts on mount or pattern change
  useEffect(() => {
    const controller = new AbortController()
    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null
    const MAX_RETRY_DELAY = 5000 // 5 seconds max

    const fetchPrompts = async (retryCount = 0) => {
      try {
        setIsLoading(true)
        // Check if using streaming pattern
        const isStreamingPattern = pattern === "travel_search_streaming"
        const url = isStreamingPattern
          ? `${TRAVEL_API_URL}/suggested-prompts?pattern=streaming`
          : `${TRAVEL_API_URL}/suggested-prompts`

        const res = await fetch(url, {
          cache: "no-cache",
          signal: controller.signal,
        })

        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const data: unknown = await res.json()
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new Error("Invalid suggested prompts response")
        }

        console.log("Fetched travel prompts:", data)

        // Parse prompts from API response
        // Travel API returns: { travel: [...] } or { streaming: [...] }
        const categories = Object.entries(data).map(([key, value]) => ({
          name: key,
          // Handle both string arrays and object arrays
          prompts: Array.isArray(value)
            ? value.map((item) =>
                typeof item === "string" ? { prompt: item } : item,
              )
            : [],
        }))
        setCategories(categories)

        // Retry if all categories are empty
        if (categories.every((category) => category.prompts.length === 0)) {
          const delay = Math.min(
            5000 * Math.pow(2, retryCount),
            MAX_RETRY_DELAY,
          )
          retryTimeoutId = setTimeout(() => fetchPrompts(retryCount + 1), delay)
        }

        setIsLoading(false)
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          console.warn("Failed to load travel prompts from API.", err)
          // Retry on error with exponential backoff
          const delay = Math.min(
            5000 * Math.pow(2, retryCount),
            MAX_RETRY_DELAY,
          )
          retryTimeoutId = setTimeout(() => fetchPrompts(retryCount + 1), delay)
        }
      }
    }

    fetchPrompts()

    return () => {
      controller.abort()
      if (retryTimeoutId) clearTimeout(retryTimeoutId)
    }
  }, [pattern])

  // Handle outside clicks and escape key
  useEffect(() => {
    if (!visible || !isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside, true)
    document.addEventListener("keydown", handleEscapeKey)

    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true)
      document.removeEventListener("keydown", handleEscapeKey)
    }
  }, [visible, isOpen])

  const handleToggle = () => setIsOpen(!isOpen)

  const handleItemClick = (item: string) => {
    onSelect(item)
    setIsOpen(false)
  }

  if (!visible) return null

  const dropdownClasses = `flex h-9 cursor-pointer flex-row items-center gap-2 rounded-full border border-gray-700 bg-[#2f2f2f] px-4 py-2 transition-all duration-200 ease-in-out hover:bg-[#3a3a3a] ${
    isOpen ? "bg-[#3a3a3a]" : ""
  }`

  const hasNoPrompts = categories.every(
    (category) => category.prompts.length === 0,
  )

  const menuClasses = `absolute bottom-full left-0 z-[1000] mb-2 max-h-[400px] min-h-[50px] w-[380px] overflow-y-auto rounded-xl border border-gray-700 bg-[#2f2f2f] px-2 py-2 shadow-xl ${
    isOpen ? "block animate-fadeInDropdown" : "hidden"
  }`

  const iconClasses = `transition-transform duration-300 ease-in-out ${
    isOpen ? "rotate-180" : ""
  }`

  return (
    <div className="mb-3 flex items-center gap-3">
      <div className="relative inline-block" ref={dropdownRef}>
        <div className={dropdownClasses} onClick={handleToggle}>
          <Plane className="h-4 w-4 text-[#5feb9b]" />
          <span className="font-inter text-sm font-medium text-gray-300">
            Travel Prompts
          </span>
          <svg
            className={`h-4 w-4 text-gray-500 ${iconClasses}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>

        <div className={menuClasses}>
          {isLoading || hasNoPrompts ? (
            <LoadingSpinner message="Loading travel prompts..." />
          ) : (
            categories.map((category, index) => (
              <div key={`category-${index}`} className="py-1">
                {/* Category header for travel prompts */}
                {category.name === "travel" && (
                  <div
                    className="mb-2 flex items-center gap-2 rounded-lg px-3 py-2"
                    style={{
                      background:
                        "linear-gradient(to right, #3ce98a15, #5feb9b15)",
                    }}
                  >
                    <span className="text-sm">🔍</span>
                    <span className="font-inter text-xs font-semibold uppercase tracking-wider text-[#5feb9b]">
                      Search Trips
                    </span>
                  </div>
                )}
                {category.name === "streaming" && (
                  <div
                    className="mb-2 flex items-center gap-2 rounded-lg px-3 py-2"
                    style={{
                      background:
                        "linear-gradient(to right, #7becac15, #94edbb15)",
                    }}
                  >
                    <span className="text-sm">⚡</span>
                    <span className="font-inter text-xs font-semibold uppercase tracking-wider text-[#7becac]">
                      Streaming Search
                    </span>
                  </div>
                )}
                {category.prompts.map((item, idx) => (
                  <div
                    key={`prompt-${index}-${idx}`}
                    className="group mx-1 my-1 flex cursor-pointer flex-col rounded-lg border border-transparent px-3 py-3 transition-all duration-200 hover:bg-[#3a3a3a]"
                    onClick={() => handleItemClick(item.prompt)}
                  >
                    <div className="w-full break-words font-inter text-sm font-normal leading-5 text-gray-300 group-hover:text-white">
                      {item.prompt}
                    </div>
                    {item.description && (
                      <div className="mt-1 w-full break-words font-inter text-xs font-normal leading-4 text-gray-500">
                        {item.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// Export as both TravelPromptsDropdown and the legacy name for compatibility
export default TravelPromptsDropdown
export { TravelPromptsDropdown as CoffeePromptsDropdown }
