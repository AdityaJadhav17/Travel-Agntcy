/**
 * Copyright AGNTCY Contributors (https://github.com/agntcy)
 * SPDX-License-Identifier: Apache-2.0
 **/

import React, { useState, useRef, useEffect } from "react"
import { Message } from "@/types/message"
import { ArrowUp, Square } from "lucide-react"
import CoffeePromptsDropdown from "./Prompts/CoffeePromptsDropdown"
import { useAgentAPI } from "@/hooks/useAgentAPI"

import { logger } from "@/utils/logger"
import axios from "axios"

interface ApiResponse {
  response: string
  session_id?: string
}

interface ChatAreaProps {
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setButtonClicked: (clicked: boolean) => void
  setAiReplied: (replied: boolean) => void
  isBottomLayout: boolean
  showCoffeePrompts?: boolean
  showTravelStarters?: boolean
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
  { label: "Find flights", draft: "Find flights from " },
  { label: "Find a hotel", draft: "Find a hotel in " },
  {
    label: "Flights + hotel",
    draft: "Find flights and a hotel only. I'm leaving from ",
  },
]

const ChatArea: React.FC<ChatAreaProps> = ({
  setMessages,
  setButtonClicked,
  setAiReplied,
  isBottomLayout,
  showCoffeePrompts = false,
  showTravelStarters = false,
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
  const [content, setContent] = useState<string>("")
  const [loading, setLoading] = useState<boolean>(false)
  const [isMinimized, setIsMinimized] = useState<boolean>(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { sendMessageWithCallback } = useAgentAPI()

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 200) + "px"
    }
  }, [content])

  const handleDropdownQuery = (query: string) => {
    if (isMinimized) {
      setIsMinimized(false)
    }

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

    if (isMinimized) {
      setIsMinimized(false)
    }

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
  const canApplyStarter =
    !isDisabled &&
    (!content.trim() || starters.some(({ draft }) => content === draft))

  return (
    <div ref={chatRef} className="relative flex w-full flex-col bg-[#212121]">
      <div className="flex w-full flex-col items-center gap-3 px-4 py-4">
        {showCoffeePrompts && (
          <div className="relative z-10 flex w-full max-w-[768px] justify-center">
            <CoffeePromptsDropdown
              visible={true}
              onSelect={handleDropdownQuery}
              pattern={pattern}
            />
          </div>
        )}

        <div className="w-full max-w-[768px]">
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
                  className="min-h-11 rounded-md border border-white/15 px-3 text-sm font-medium text-gray-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-emerald-300 disabled:opacity-50"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="relative flex flex-col rounded-2xl border border-[#424242] bg-[#2f2f2f] shadow-lg transition-all focus-within:border-[#5a5a5a]">
            {/* Textarea */}
            <textarea
              aria-label="Message Travel AGNTCY"
              ref={textareaRef}
              className="max-h-[200px] min-h-[52px] w-full resize-none bg-transparent px-4 py-3.5 pr-16 text-[15px] leading-6 text-gray-100 outline-hidden placeholder:text-gray-500"
              placeholder={
                showTravelStarters
                  ? "Enter a route, destination, or travel dates"
                  : "Add details or ask about these results"
              }
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isDisabled}
              rows={1}
            />

            {/* Send button */}
            <div className="absolute right-1 bottom-1">
              <button
                type="button"
                aria-label={onStop ? "Stop" : "Send message"}
                title={onStop ? "Stop search" : "Send message"}
                onClick={() => {
                  if (onStop) {
                    onStop()
                  } else if (content.trim() && !isDisabled) {
                    processMessage()
                  }
                }}
                disabled={!onStop && (!content.trim() || isDisabled)}
                className={`flex size-11 items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 motion-reduce:transition-none ${
                  onStop || (content.trim() && !isDisabled)
                    ? "bg-white text-black hover:bg-gray-200"
                    : "cursor-not-allowed bg-[#424242] text-gray-500"
                }`}
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
