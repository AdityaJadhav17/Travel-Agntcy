/**
 * Copyright AGNTCY Contributors (https://github.com/agntcy)
 * SPDX-License-Identifier: Apache-2.0
 **/

import React, { useState, useRef, useEffect } from "react"
import { Message } from "@/types/message"
import { ArrowUp } from "lucide-react"
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
  showLogisticsPrompts?: boolean
  showProgressTracker?: boolean
  showAuctionStreaming?: boolean
  showFinalResponse?: boolean
  onStreamComplete?: () => void
  onSenderHighlight?: (nodeId: string) => void
  pattern?: string
  graphConfig?: any
  onDropdownSelect?: (query: string) => void
  onUserInput?: (query: string) => void
  onApiResponse?: (response: string, isError?: boolean) => void
  onClearConversation?: () => void
  currentUserMessage?: string
  agentResponse?: ApiResponse
  executionKey?: string
  isAgentLoading?: boolean
  apiError: boolean
  chatRef?: React.RefObject<HTMLDivElement | null>
  auctionState?: any
  grafanaUrl?: string
}

const ChatArea: React.FC<ChatAreaProps> = ({
  setMessages,
  setButtonClicked,
  setAiReplied,
  isBottomLayout,
  showCoffeePrompts = false,
  showProgressTracker = false,
  showAuctionStreaming = false,
  pattern,
  onDropdownSelect,
  onUserInput,
  onApiResponse,
  isAgentLoading,
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
      setContent("")
      onUserInput(messageContent)
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      processMessage()
    }
  }

  if (!isBottomLayout) {
    return null
  }

  const isDisabled = loading || isAgentLoading

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

        {/* ChatGPT-style input container */}
        <div className="w-full max-w-[768px]">
          <div className="relative flex flex-col rounded-2xl border border-[#424242] bg-[#2f2f2f] shadow-lg transition-all focus-within:border-[#5a5a5a]">
            {/* Textarea */}
            <textarea
              ref={textareaRef}
              className="max-h-[200px] min-h-[52px] w-full resize-none bg-transparent px-4 py-3.5 pr-14 text-[15px] leading-6 text-gray-100 outline-none placeholder:text-gray-500"
              placeholder="Message Travel AGNTCY..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isDisabled}
              rows={1}
            />

            {/* Send button */}
            <div className="absolute bottom-2.5 right-3">
              <button
                onClick={() => {
                  if (content.trim() && !isDisabled) {
                    processMessage()
                  }
                }}
                disabled={!content.trim() || isDisabled}
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all ${
                  content.trim() && !isDisabled
                    ? "bg-white text-black hover:bg-gray-200"
                    : "cursor-not-allowed bg-[#424242] text-gray-500"
                }`}
              >
                <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
              </button>
            </div>
          </div>

          {/* Footer text */}
          <p className="mt-2 text-center text-xs text-gray-500">
            Travel AGNTCY can make mistakes. Consider verifying important
            information.
          </p>
        </div>
      </div>
    </div>
  )
}

export default ChatArea
