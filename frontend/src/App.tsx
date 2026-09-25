/**
 * Copyright AGNTCY Contributors (https://github.com/agntcy)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Travel Planning Agent Frontend Application
 *
 * This is the main React application that provides a UI for interacting with
 * the Travel Planning Agent. It supports searching for flights and hotels.
 **/

import React, { useState, useEffect, useRef, useCallback } from "react"
import { LOCAL_STORAGE_KEY } from "@/components/Chat/Messages"
import { logger } from "@/utils/logger"
import { useChatAreaMeasurement } from "@/hooks/useChatAreaMeasurement"
import Navigation from "@/components/Navigation/Navigation"
import MainArea from "@/components/MainArea/MainArea"
import { useAgentAPI } from "@/hooks/useAgentAPI"
import ChatArea from "@/components/Chat/ChatArea"
import Sidebar from "@/components/Sidebar/Sidebar"
import { ThemeProvider } from "@/contexts/ThemeContext"
import { Message } from "./types/message"
import { getGraphConfig } from "@/utils/graphConfigs"
import { PATTERNS, PatternType } from "@/utils/patternUtils"
import TravelResponseCard from "@/components/Chat/TravelResponseCard"
import { BudgetAssessment } from "@/types/budget"
import { Plane } from "lucide-react"

interface ApiResponse {
  response: string
  session_id?: string
  conversation_id?: string
  trip_state?: Record<string, unknown>
  budget_assessment?: BudgetAssessment | null
}

interface ConversationMessage {
  role: "user" | "assistant"
  content: string
  budget_assessment?: BudgetAssessment | null
}

export interface ChatHistoryItem {
  id: string
  conversationId?: string
  title: string
  timestamp: Date
  messages: ConversationMessage[]
}

const CHAT_HISTORY_KEY = "travel_chat_history"

const App: React.FC = () => {
  const { sendMessage, deleteConversation } = useAgentAPI()
  const activeChatRef = useRef<string | null>(null)
  const pendingChats = useRef(new Set<string>())
  const deletedChats = useRef(new Set<string>())
  const [historyError, setHistoryError] = useState("")

  const [selectedPattern, setSelectedPattern] = useState<PatternType>(
    PATTERNS.TRAVEL_SEARCH,
  )

  const [aiReplied, setAiReplied] = useState<boolean>(false)
  const [buttonClicked, setButtonClicked] = useState<boolean>(false)
  const [currentUserMessage, setCurrentUserMessage] = useState<string>("")
  const [agentResponse, setAgentResponse] = useState<ApiResponse | undefined>(
    undefined,
  )
  const [isAgentLoading, setIsAgentLoading] = useState<boolean>(false)
  const [apiError, setApiError] = useState<boolean>(false)
  const [showFinalResponse, setShowFinalResponse] = useState<boolean>(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true)

  // Chat history state
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || "[]")
      return Array.isArray(saved)
        ? saved.map((chat: ChatHistoryItem) => ({
            ...chat,
            timestamp: new Date(chat.timestamp),
          }))
        : []
    } catch {
      return []
    }
  })
  const [conversationMessages, setConversationMessages] = useState<
    ConversationMessage[]
  >([])

  // Ref for scrolling to bottom
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [conversationMessages, isAgentLoading])

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(chatHistory))
    } catch {
      setHistoryError(
        "Browser storage is full or unavailable. Chat history may not survive a reload.",
      )
    }
  }, [chatHistory])

  const handlePatternChange = useCallback((pattern: PatternType) => {
    setShowFinalResponse(false)
    setAgentResponse(undefined)
    setIsAgentLoading(false)
    setApiError(false)
    setCurrentUserMessage("")
    setButtonClicked(false)
    setAiReplied(false)
    setSelectedPattern(pattern)
  }, [])

  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || "[]")
      return Array.isArray(saved) ? saved : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(messages))
    } catch {
      setHistoryError(
        "Browser storage is full or unavailable. Chat history may not survive a reload.",
      )
    }
  }, [messages])

  useEffect(() => {
    setButtonClicked(false)
    setAiReplied(false)
  }, [selectedPattern])

  const {
    height: chatHeight,
    isExpanded,
    chatRef,
  } = useChatAreaMeasurement({
    debounceMs: 100,
  })

  const chatHeightValue = currentUserMessage || agentResponse ? chatHeight : 76

  const handleUserInput = async (query: string) => {
    const chatId = activeChatRef.current || crypto.randomUUID()
    if (pendingChats.current.has(chatId)) return
    const existingChat = chatHistory.find((chat) => chat.id === chatId)
    const conversationId = existingChat?.conversationId || crypto.randomUUID()
    activeChatRef.current = chatId
    setCurrentChatId(chatId)
    pendingChats.current.add(chatId)
    setHistoryError("")
    setCurrentUserMessage(query)
    setIsAgentLoading(true)
    setButtonClicked(true)
    setAiReplied(false)
    setApiError(false)
    setShowFinalResponse(true)
    const newMessages = [
      ...conversationMessages,
      { role: "user" as const, content: query },
    ]
    setConversationMessages(newMessages)
    const entry: ChatHistoryItem = {
      id: chatId,
      conversationId,
      title:
        existingChat?.title ||
        (query.length > 35 ? query.substring(0, 35) + "..." : query),
      timestamp: new Date(),
      messages: newMessages,
    }
    setChatHistory((previous) => [
      entry,
      ...previous.filter((chat) => chat.id !== chatId),
    ])
    let response: ApiResponse
    let failed = false
    try {
      response = await sendMessage(query, selectedPattern, conversationId)
    } catch (error) {
      failed = true
      logger.apiError("/agent/prompt", error)
      response = {
        response: error instanceof Error ? error.message : String(error),
      }
    }
    pendingChats.current.delete(chatId)
    if (deletedChats.current.has(chatId)) return
    const updatedMessages = [
      ...newMessages,
      {
        role: "assistant" as const,
        content: response.response,
        budget_assessment: response.budget_assessment,
      },
    ]
    setChatHistory((previous) =>
      previous.map((chat) =>
        chat.id === chatId ? { ...chat, messages: updatedMessages } : chat,
      ),
    )
    if (activeChatRef.current !== chatId) return
    setConversationMessages(updatedMessages)
    setAgentResponse(response)
    setIsAgentLoading(false)
    setButtonClicked(false)
    setAiReplied(true)
    setApiError(failed)
  }

  const handleApiResponse = (
    response: ApiResponse | string,
    isError = false,
  ) => {
    setAgentResponse(typeof response === "string" ? { response } : response)
    setApiError(isError)
  }

  const handleDropdownSelect = async (query: string) => {
    handleUserInput(query)
  }

  const handleClearConversation = () => {
    activeChatRef.current = null
    setHistoryError("")
    setMessages([])
    setCurrentUserMessage("")
    setAgentResponse(undefined)
    setIsAgentLoading(false)
    setButtonClicked(false)
    setAiReplied(false)
    setShowFinalResponse(false)
    setCurrentChatId(null)
    setConversationMessages([])
  }

  useEffect(() => {
    setCurrentUserMessage("")
    setAgentResponse(undefined)
    setIsAgentLoading(false)
    setButtonClicked(false)
    setAiReplied(false)
    setShowFinalResponse(false)
  }, [selectedPattern])

  const handleNewChat = () => {
    handleClearConversation()
  }

  const handleSelectChat = (chatId: string) => {
    const selectedChat = chatHistory.find((chat) => chat.id === chatId)
    if (selectedChat && selectedChat.messages.length > 0) {
      setAgentResponse(undefined)
      setApiError(false)
      activeChatRef.current = chatId
      setIsAgentLoading(pendingChats.current.has(chatId))
      setHistoryError(
        selectedChat.conversationId
          ? ""
          : "This older chat has no saved AI memory. Please restate your trip details once.",
      )
      setCurrentChatId(chatId)
      setConversationMessages(selectedChat.messages)

      const lastUserMsg = [...selectedChat.messages]
        .reverse()
        .find((m) => m.role === "user")
      const lastAssistantMsg = [...selectedChat.messages]
        .reverse()
        .find((m) => m.role === "assistant")

      if (lastUserMsg) {
        setCurrentUserMessage(lastUserMsg.content)
      }
      if (lastAssistantMsg) {
        setAgentResponse({ response: lastAssistantMsg.content })
        setShowFinalResponse(true)
      }
      setButtonClicked(false)
      setAiReplied(true)
    }
  }

  const handleDeleteChat = async (chatId: string) => {
    const chat = chatHistory.find((item) => item.id === chatId)
    try {
      if (chat?.conversationId) await deleteConversation(chat.conversationId)
      deletedChats.current.add(chatId)
      setChatHistory((previous) =>
        previous.filter((item) => item.id !== chatId),
      )
      if (activeChatRef.current === chatId) handleClearConversation()
    } catch {
      setHistoryError(
        "Could not delete the saved conversation. Please try again.",
      )
    }
  }

  const handleToggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen)
  }

  // Show welcome section only when it's a fresh new chat (no messages)
  const showWelcome = conversationMessages.length === 0

  return (
    <ThemeProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#212121]">
        <Navigation
          onToggleSidebar={handleToggleSidebar}
          isSidebarOpen={isSidebarOpen}
        />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar
            selectedPattern={selectedPattern}
            onPatternChange={handlePatternChange}
            onNewChat={handleNewChat}
            onSelectChat={handleSelectChat}
            onDeleteChat={handleDeleteChat}
            chatHistory={chatHistory}
            currentChatId={currentChatId}
            isOpen={isSidebarOpen}
          />
          <div
            className={`flex flex-1 flex-col bg-[#212121] ${isSidebarOpen ? "border-l border-gray-800" : ""}`}
          >
            {historyError && (
              <p role="status" className="px-4 py-2 text-sm text-amber-200">
                {historyError}
              </p>
            )}
            {/* Main content area - scrollable */}
            <div className="relative flex-1 overflow-y-auto">
              {/* New Chat Welcome View - Graph + Welcome Section */}
              {showWelcome && (
                <div className="flex h-full flex-col">
                  {/* Agent Graph - takes up available space above welcome */}
                  <div className="min-h-[300px] flex-1">
                    <MainArea
                      pattern={selectedPattern}
                      buttonClicked={buttonClicked}
                      setButtonClicked={setButtonClicked}
                      aiReplied={aiReplied}
                      setAiReplied={setAiReplied}
                      chatHeight={chatHeightValue}
                      isExpanded={isExpanded}
                      groupCommResponseReceived={false}
                      onNodeHighlight={() => {}}
                    />
                  </div>

                  {/* Welcome Section */}
                  <div className="flex flex-col items-center justify-center px-4 pb-4">
                    {/* Airplane Icon - same orientation as logo */}
                    <div className="mb-4">
                      <Plane
                        className="h-12 w-12 text-[#3ce98a]"
                        strokeWidth={2}
                      />
                    </div>

                    {/* Welcome Text */}
                    <h1 className="mb-2 text-2xl font-semibold text-white">
                      How can I help you plan your trip?
                    </h1>
                    <p className="text-gray-400">
                      Find flights, hotels, and activities for your next
                      adventure
                    </p>
                  </div>
                </div>
              )}

              {/* Loading State with Graph - when messages exist but loading */}
              {!showWelcome && isAgentLoading && (
                <div className="h-[350px]">
                  <MainArea
                    pattern={selectedPattern}
                    buttonClicked={buttonClicked}
                    setButtonClicked={setButtonClicked}
                    aiReplied={aiReplied}
                    setAiReplied={setAiReplied}
                    chatHeight={chatHeightValue}
                    isExpanded={isExpanded}
                    groupCommResponseReceived={false}
                    onNodeHighlight={() => {}}
                  />
                </div>
              )}

              {/* Conversation Messages - ChatGPT style */}
              {conversationMessages.length > 0 && (
                <div className="mx-auto w-full max-w-[768px] px-4 py-6">
                  {conversationMessages.map((msg, index) => (
                    <div key={index} className="mb-6">
                      {msg.role === "user" ? (
                        /* User Message - right aligned bubble */
                        <div className="flex justify-end">
                          <div className="max-w-[85%] rounded-3xl bg-[#2f2f2f] px-5 py-3 text-[15px] text-gray-100">
                            {msg.content}
                          </div>
                        </div>
                      ) : (
                        /* Assistant Message - left aligned with avatar */
                        <div className="flex items-start gap-4">
                          <div
                            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
                            style={{
                              background:
                                "linear-gradient(135deg, #3ce98a, #5feb9b)",
                            }}
                          >
                            <Plane className="h-4 w-4 text-white" />
                          </div>
                          <div className="flex-1 pt-1 text-[15px]">
                            <TravelResponseCard
                              content={msg.content}
                              budget={msg.budget_assessment}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Loading indicator */}
                  {isAgentLoading && (
                    <div className="mb-6 flex items-start gap-4">
                      <div
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
                        style={{
                          background:
                            "linear-gradient(135deg, #3ce98a, #5feb9b)",
                        }}
                      >
                        <Plane className="h-4 w-4 text-white" />
                      </div>
                      <div className="flex items-center gap-1 pt-3">
                        <div className="h-2 w-2 animate-bounce rounded-full bg-[#3ce98a] [animation-delay:-0.3s]" />
                        <div className="h-2 w-2 animate-bounce rounded-full bg-[#5feb9b] [animation-delay:-0.15s]" />
                        <div className="h-2 w-2 animate-bounce rounded-full bg-[#7becac]" />
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Input area - fixed at bottom */}
            <div className="flex w-full flex-none flex-col items-center justify-end gap-0 bg-[#212121] px-4 pb-6 pt-2">
              <ChatArea
                setMessages={setMessages}
                setButtonClicked={setButtonClicked}
                setAiReplied={setAiReplied}
                isBottomLayout={true}
                showCoffeePrompts={false}
                showLogisticsPrompts={false}
                showProgressTracker={false}
                showAuctionStreaming={false}
                showFinalResponse={showFinalResponse}
                onStreamComplete={() => {}}
                onSenderHighlight={() => {}}
                pattern={selectedPattern}
                graphConfig={getGraphConfig(selectedPattern, false)}
                onDropdownSelect={handleDropdownSelect}
                onUserInput={handleUserInput}
                onApiResponse={handleApiResponse}
                onClearConversation={handleClearConversation}
                currentUserMessage={currentUserMessage}
                agentResponse={agentResponse}
                executionKey=""
                isAgentLoading={isAgentLoading}
                apiError={apiError}
                chatRef={chatRef}
                auctionState={{
                  events: [],
                  status: "idle",
                  error: null,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </ThemeProvider>
  )
}

export default App
