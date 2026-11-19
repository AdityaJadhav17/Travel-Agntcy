/**
 * Copyright AGNTCY Contributors (https://github.com/agntcy)
 * SPDX-License-Identifier: Apache-2.0
 **/

import React, { useId, useState, useRef, useLayoutEffect } from "react"
import { Message } from "@/types/message"
import type { TripContext } from "@/types/tripContext"
import { ArrowUp, Square } from "lucide-react"
import CoffeePromptsDropdown from "./Prompts/CoffeePromptsDropdown"
import TripSummary from "./TripSummary"
import { useAgentAPI } from "@/hooks/useAgentAPI"

import { logger } from "@/utils/logger"
import axios from "axios"
import "./ChatComposer.css"

interface ApiResponse {
  response: string
  session_id?: string
}

interface ChatAreaProps {
  content: string
  setContent: (draft: string) => void
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setButtonClicked: (clicked: boolean) => void
  setAiReplied: (replied: boolean) => void
  isBottomLayout: boolean
  showCoffeePrompts?: boolean
  showTravelStarters?: boolean
  trip?: TripContext | null
  tripEditorKey?: string
  showTripDetails?: boolean
  onTripSearch?: (prompt: string) => void
  showLogisticsPrompts?: boolean
  showProgressTracker?: boolean
  showAuctionStreaming?: boolean
  showFinalResponse?: boolean
  onStreamComplete?: () => void
  onSenderHighlight?: (nodeId: string) => void
  pattern?: string
  graphConfig?: any
  onDropdownSelect?: (query: string) => void
  onUserInput?: (query: string) => boolean | void
  onApiResponse?: (response: string, isError?: boolean) => void
  onClearConversation?: () => void
  currentUserMessage?: string
  agentResponse?: ApiResponse
  executionKey?: string
  isAgentLoading?: boolean
  onStop?: () => void
  apiError: boolean
  chatRef?: React.RefObject<HTMLDivElement | null>
  auctionState?: any
  grafanaUrl?: string
}

const starters = [
  {
    label: "Find flights",
    draft:
      "Find a weekend flight from Dallas to San Francisco for three adults.",
  },
  {
    label: "Find a hotel",
    draft: "Find a hotel in Boston for two adults next weekend.",
  },
  {
    label: "Flights + hotel",
    draft:
      "Find flights and a hotel for two adults from Seattle to Chicago next weekend.",
  },
]

function composerPlaceholder(trip: TripContext | null | undefined) {
  switch (trip?.search_type) {
    case "flight_only":
    case "full_trip":
      return "Arrive before noon"
    case "hotel_only":
      return "Stay near the city center"
    case "activity_only":
      return "Find outdoor activities"
    default:
      return trip
        ? "Ask about these results or change your trip"
        : "Enter a route, destination, or travel dates"
  }
}

const ChatArea: React.FC<ChatAreaProps> = ({
  content,
  setContent,
  setMessages,
  setButtonClicked,
  setAiReplied,
  isBottomLayout,
  showCoffeePrompts = false,
  showTravelStarters = false,
  trip,
  tripEditorKey,
  showTripDetails = true,
  onTripSearch,
  showProgressTracker = false,
  showAuctionStreaming = false,
  pattern,
  onDropdownSelect,
  onUserInput,
  onApiResponse,
  isAgentLoading,
  onStop,
  chatRef,
}) => {
  const [loading, setLoading] = useState<boolean>(false)
  const inputId = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { sendMessageWithCallback } = useAgentAPI()

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea || CSS.supports("field-sizing", "content")) return
    textarea.style.height = "0"
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [content])

  const handleDropdownQuery = (query: string) => {
    if (onDropdownSelect) {
      onDropdownSelect(query)
    }
  }

  const processMessageWithQuery = async (
    messageContent: string,
  ): Promise<void> => {
    if (!messageContent.trim()) return

    setContent("")
    setLoading(true)
    setButtonClicked(true)

    await sendMessageWithCallback(
      messageContent,
      setMessages,
      {
        onSuccess: (response: ApiResponse) => {
          setAiReplied(true)
          if (onApiResponse) {
            onApiResponse(response.response ?? "", false)
          }
        },
        onError: (error) => {
          logger.apiError("/agent/prompt", error)
          let errorMessage = "Sorry, I encountered an error"
          if (axios.isAxiosError(error) && error.response?.data?.detail) {
            errorMessage = error.response.data.detail
          }
          if (onApiResponse) {
            onApiResponse(errorMessage, true)
          }
        },
      },
      pattern,
    )

    setLoading(false)
  }

  const processMessage = async (): Promise<void> => {
    if (!content.trim()) return

    if (onUserInput) {
      const messageContent = content
      if (onUserInput(messageContent) !== false) setContent("")
      return
    }

    if ((showAuctionStreaming || showProgressTracker) && onDropdownSelect) {
      setContent("")
      onDropdownSelect(content)
    } else {
      await processMessageWithQuery(content)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (!loading && !isAgentLoading) void processMessage()
    }
  }

  if (!isBottomLayout) {
    return null
  }

  const isDisabled = loading || isAgentLoading
  const canSend = Boolean(content.trim()) && !isDisabled
  const canApplyStarter =
    !isDisabled &&
    (!content.trim() || starters.some(({ draft }) => content === draft))
  const label = (
    <label htmlFor={inputId} className="text-sm font-medium text-travel-text">
      {trip ? "Refine this trip" : "Where would you like to go?"}
    </label>
  )

  return (
    <div
      ref={chatRef}
      className="relative flex w-full flex-col bg-travel-canvas"
    >
      <div className="flex w-full flex-col items-center gap-3 py-2">
        {showCoffeePrompts && (
          <div className="relative z-10 flex w-full justify-center">
            <CoffeePromptsDropdown
              visible={true}
              onSelect={handleDropdownQuery}
              pattern={pattern}
            />
          </div>
        )}

        <div className="w-full">
          {showTravelStarters && (
            <div
              role="group"
              aria-label="Search starters"
              className="mb-3 flex flex-wrap gap-2"
            >
              {starters.map(({ label, draft }) => (
                <button
                  key={label}
                  type="button"
                  disabled={!canApplyStarter}
                  onClick={() => {
                    setContent(draft)
                    textareaRef.current?.focus()
                  }}
                  className="min-h-11 rounded-md border border-travel-control px-3 text-sm font-medium text-travel-text hover:bg-travel-selected focus-visible:outline-2 focus-visible:outline-travel-accent disabled:opacity-50"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {trip && onTripSearch ? (
            <TripSummary
              key={tripEditorKey}
              trip={trip}
              composerLabel={label}
              showDetails={showTripDetails}
              disabled={Boolean(isDisabled)}
              onSearch={onTripSearch}
            />
          ) : (
            <div className="mb-1.5">{label}</div>
          )}
          <div className="travel-composer relative flex flex-col rounded-2xl border">
            <textarea
              id={inputId}
              ref={textareaRef}
              className="w-full resize-none bg-transparent px-4 py-4 pr-16 text-base leading-6 text-travel-text outline-hidden placeholder:text-travel-muted"
              placeholder={composerPlaceholder(trip)}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isDisabled && !onStop}
              rows={1}
            />

            <div className="absolute right-1.5 bottom-1.5">
              <button
                type="button"
                aria-label={onStop ? "Stop" : "Send message"}
                title={onStop ? "Stop search" : "Send message"}
                onClick={() => {
                  if (onStop) {
                    onStop()
                  } else if (canSend) {
                    void processMessage()
                  }
                }}
                disabled={!onStop && !canSend}
                className="travel-composer-action flex size-11 items-center justify-center rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-travel-accent motion-reduce:transition-none"
              >
                {onStop ? (
                  <Square
                    aria-hidden="true"
                    className="size-3.5 fill-current"
                  />
                ) : (
                  <ArrowUp
                    aria-hidden="true"
                    className="size-5"
                    strokeWidth={2.5}
                  />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChatArea
