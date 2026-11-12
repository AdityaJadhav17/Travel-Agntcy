/**
 * Copyright AGNTCY Contributors (https://github.com/agntcy)
 * SPDX-License-Identifier: Apache-2.0
 **/

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useReducer,
} from "react"
import { LOCAL_STORAGE_KEY } from "@/components/Chat/Messages"
import { logger } from "@/utils/logger"
import { useChatAreaMeasurement } from "@/hooks/useChatAreaMeasurement"
import Navigation from "@/components/Navigation/Navigation"
import MainArea from "@/components/MainArea/MainArea"
import { useAgentAPI, type ApiResponse } from "@/hooks/useAgentAPI"
import ChatArea from "@/components/Chat/ChatArea"
import Sidebar from "@/components/Sidebar/Sidebar"
import { ThemeProvider } from "@/contexts/ThemeContext"
import { Message } from "./types/message"
import { PATTERNS, PatternType } from "@/utils/patternUtils"
import TravelResponseCard from "@/components/Chat/TravelResponseCard"
import StructuredTravelResultCard from "@/components/Chat/StructuredTravelResultCard"
import { parseTravelResult } from "@/types/travelResult"
import { Plane } from "lucide-react"
import { ChatRequests } from "@/stores/chatRequests"
import { TravelStreamError } from "@/utils/travelStream"
import {
  chatDisplayReducer,
  restoreChatDisplay,
  idleView,
  type ChatHistoryItem,
} from "@/stores/chatDisplay"
import AuthGate from "@/components/AuthGate"

export type { ChatHistoryItem } from "@/stores/chatDisplay"
const CHAT_HISTORY_KEY = "travel_chat_history"
const ignoreAnimationReply = () => {}
const emptyMessages: ChatHistoryItem["messages"] = []

async function persistBrowserState(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

const TravelApp: React.FC<{ onLogout: () => Promise<void> }> = ({
  onLogout,
}) => {
  const { streamMessage, cancelStream, deleteConversation } = useAgentAPI()
  const activeChatRef = useRef<string | null>(null)
  const requests = useRef(new ChatRequests())
  const [historyError, setHistoryError] = useState("")
  const [selectedPattern, setSelectedPattern] = useState<PatternType>(
    PATTERNS.TRAVEL_SEARCH,
  )
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const [display, dispatch] = useReducer(chatDisplayReducer, undefined, () => {
    try {
      return restoreChatDisplay(
        JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || "[]"),
      )
    } catch {
      return restoreChatDisplay(null)
    }
  })
  const chatHistory = display.history
  const currentChat = chatHistory.find((chat) => chat.id === currentChatId)
  const view = currentChatId
    ? (display.views.get(currentChatId) ?? idleView)
    : idleView
  const conversationMessages = currentChat?.messages ?? emptyMessages
  const isAgentLoading = view.phase === "pending"
  const buttonClicked = view.phase === "pending" && view.animate
  const aiReplied = view.phase === "succeeded" || view.phase === "failed"
  const progressStatus = view.phase === "pending" ? view.status : ""
  const partialResult = view.phase === "pending" ? view.partial : null
  const streamText = view.phase === "pending" ? view.text : ""
  const animationToken = view.phase === "pending" ? view.token : null
  const setButtonClicked = useCallback(
    (clicked: boolean) => {
      if (!clicked && animationToken)
        dispatch({ type: "animated", token: animationToken })
    },
    [animationToken],
  )

  const messagesEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [conversationMessages, isAgentLoading])

  useEffect(() => {
    void persistBrowserState(CHAT_HISTORY_KEY, chatHistory).catch(() => {
      setHistoryError(
        "Browser storage is full or unavailable. Chat history may not survive a reload.",
      )
    })
  }, [chatHistory])

  // Retained only for the compatibility composer path.
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || "[]")
      return Array.isArray(saved) ? saved : []
    } catch {
      return []
    }
  })
  useEffect(() => {
    void persistBrowserState(LOCAL_STORAGE_KEY, messages).catch(() => {
      setHistoryError(
        "Browser storage is full or unavailable. Chat history may not survive a reload.",
      )
    })
  }, [messages])

  const {
    height: chatHeight,
    isExpanded,
    chatRef,
  } = useChatAreaMeasurement({ debounceMs: 100 })
  const chatHeightValue = conversationMessages.length ? chatHeight : 76
  const handlePatternChange = useCallback(
    (pattern: PatternType) => setSelectedPattern(pattern),
    [],
  )

  const handleUserInput = async (query: string, recover = false) => {
    if (!query.trim()) return
    const chatId = activeChatRef.current || crypto.randomUUID()
    const existingChat = chatHistory.find((chat) => chat.id === chatId)
    const conversationId = existingChat?.conversationId || crypto.randomUUID()
    const token = requests.current.start(chatId, conversationId)
    if (!token) return
    const requestId =
      recover &&
      existingChat?.conversationId &&
      existingChat.pendingRequest?.prompt === query
        ? existingChat.pendingRequest.id
        : crypto.randomUUID()
    activeChatRef.current = chatId
    setCurrentChatId(chatId)
    setHistoryError("")
    const entry: ChatHistoryItem = {
      id: chatId,
      conversationId,
      title:
        existingChat?.title ||
        (query.length > 35 ? query.substring(0, 35) + "..." : query),
      timestamp: new Date(),
      messages: recover
        ? (existingChat?.messages ?? [])
        : [...(existingChat?.messages ?? []), { role: "user", content: query }],
      pendingRequest: { id: requestId, prompt: query },
    }
    dispatch({ type: "start", token, entry })
    let response: ApiResponse
    let failed = false
    let recoverable = false
    try {
      response = await streamMessage(
        query,
        selectedPattern,
        conversationId,
        (event) => {
          if (!requests.current.isCurrent(token)) return
          if (event.type === "status" || event.type === "error") {
            dispatch({ type: "status", token, message: event.message })
          } else if (event.type === "result") {
            dispatch({
              type: "partial",
              token,
              result: parseTravelResult(event.travel_result),
            })
          } else if (event.type === "text") {
            dispatch({ type: "text", token, text: event.text })
          }
        },
        requestId,
      )
    } catch (error) {
      failed = true
      recoverable = error instanceof TravelStreamError && error.retryable
      logger.apiError("/agent/prompt", error)
      response = {
        response: error instanceof Error ? error.message : String(error),
      }
    }
    if (!requests.current.finish(token, failed ? "failed" : "succeeded")) return
    if (recoverable) {
      dispatch({ type: "interrupt", token, message: response.response })
      return
    }
    dispatch({
      type: "finish",
      token,
      outcome: failed ? "failed" : "succeeded",
      message: {
        role: "assistant",
        content: response.response,
        budget_assessment: response.budget_assessment,
        travel_result: response.travel_result,
        retry_hotels: response.retry_hotels,
      },
    })
  }

  const stopChat = (chatId: string) => {
    const token = requests.current.stop(chatId)
    if (!token) return
    cancelStream(token.conversationId)
    dispatch({ type: "stop", token })
  }
  const handleStop = () => {
    if (activeChatRef.current) stopChat(activeChatRef.current)
  }
  const handleClearConversation = () => {
    activeChatRef.current = null
    setHistoryError("")
    setMessages([])
    setCurrentChatId(null)
  }
  const handleNewChat = handleClearConversation
  const handleSelectChat = (chatId: string) => {
    const chat = chatHistory.find((item) => item.id === chatId)
    if (!chat) return
    activeChatRef.current = chatId
    setCurrentChatId(chatId)
    setHistoryError(
      chat.conversationId
        ? ""
        : "This older chat has no saved AI memory. Please restate your trip details once.",
    )
  }
  const handleDeleteChat = async (chatId: string) => {
    const chat = chatHistory.find((item) => item.id === chatId)
    stopChat(chatId)
    if (!requests.current.beginDelete(chatId)) return
    dispatch({ type: "delete-start", chatId })
    try {
      if (chat?.conversationId) await deleteConversation(chat.conversationId)
      requests.current.finishDelete(chatId, true)
      dispatch({ type: "delete-done", chatId })
      if (activeChatRef.current === chatId) handleClearConversation()
    } catch {
      requests.current.finishDelete(chatId, false)
      dispatch({ type: "delete-failed", chatId })
      setHistoryError(
        "Could not delete the saved conversation. Please try again.",
      )
    }
  }
  const handleToggleSidebar = () => setIsSidebarOpen((open) => !open)
  const showWelcome = conversationMessages.length === 0

  return (
    <ThemeProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#212121]">
        <Navigation
          onToggleSidebar={handleToggleSidebar}
          isSidebarOpen={isSidebarOpen}
          onLogout={onLogout}
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
                      setAiReplied={ignoreAnimationReply}
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
                    setAiReplied={ignoreAnimationReply}
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
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
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
                              travelResult={msg.travel_result}
                            />
                            {msg.retry_hotels &&
                              index === conversationMessages.length - 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUserInput("Retry hotels")
                                  }
                                  className="mt-3 rounded-lg border border-emerald-400 px-3 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-400/10"
                                >
                                  Retry hotels
                                </button>
                              )}
                            {(msg.travel_result?.kind === "flight_only" ||
                              msg.travel_result?.kind === "full_trip") &&
                              index === conversationMessages.length - 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUserInput(
                                      "Compare nearby arrival airports",
                                    )
                                  }
                                  className="mt-3 ml-2 rounded-lg border border-blue-400 px-3 py-2 text-sm font-medium text-blue-200 hover:bg-blue-400/10"
                                >
                                  Compare nearby arrival airports
                                </button>
                              )}
                            {(msg.travel_result?.kind === "flight_only" ||
                              msg.travel_result?.kind === "full_trip") &&
                              index === conversationMessages.length - 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUserInput("Compare cheaper dates")
                                  }
                                  className="mt-3 ml-2 rounded-lg border border-blue-400 px-3 py-2 text-sm font-medium text-blue-200 hover:bg-blue-400/10"
                                >
                                  Compare cheaper dates
                                </button>
                              )}
                            {msg.travel_result?.kind === "flight_only" &&
                              index === conversationMessages.length - 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUserInput("Why this flight?")
                                  }
                                  className="mt-3 ml-2 rounded-lg border border-emerald-400 px-3 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-400/10"
                                >
                                  Why this flight?
                                </button>
                              )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Loading indicator */}
                  {view.phase === "interrupted" && (
                    <div className="mb-6 space-y-3 rounded-lg border border-amber-300/30 p-4 text-sm text-amber-100">
                      <p role="status">
                        {currentChat?.recoveryError ||
                          "This search was interrupted when the page closed."}{" "}
                        It may have finished on the server. Retry the last
                        message to retrieve a saved result when available, or
                        search again.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          const last = conversationMessages.at(-1)
                          if (last?.role === "user")
                            void handleUserInput(last.content, true)
                        }}
                        className="rounded-lg border border-amber-200 px-3 py-2 hover:bg-amber-200/10"
                      >
                        Retry last message
                      </button>
                    </div>
                  )}
                  {view.phase === "deleting" && (
                    <p role="status" className="mb-6 text-sm text-gray-300">
                      Deleting conversation...
                    </p>
                  )}
                  {isAgentLoading && (
                    <div className="mb-6 flex items-start gap-4">
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                        style={{
                          background:
                            "linear-gradient(135deg, #3ce98a, #5feb9b)",
                        }}
                      >
                        <Plane className="h-4 w-4 text-white" />
                      </div>
                      <div className="flex-1 space-y-3 pt-1">
                        <p role="status" className="text-sm text-emerald-200">
                          {progressStatus || "Working on your trip"}
                        </p>
                        {partialResult && (
                          <StructuredTravelResultCard result={partialResult} />
                        )}
                        {streamText && (
                          <p className="text-sm whitespace-pre-wrap text-gray-300">
                            {streamText}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={handleStop}
                          className="rounded-lg border border-gray-500 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700"
                        >
                          Stop
                        </button>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Input area - fixed at bottom */}
            <div className="flex w-full flex-none flex-col items-center justify-end gap-0 bg-[#212121] px-4 pt-2 pb-6">
              <ChatArea
                setMessages={setMessages}
                setButtonClicked={setButtonClicked}
                setAiReplied={ignoreAnimationReply}
                isBottomLayout={true}
                showCoffeePrompts={false}
                showLogisticsPrompts={false}
                showProgressTracker={false}
                showAuctionStreaming={false}
                onStreamComplete={() => {}}
                onSenderHighlight={() => {}}
                pattern={selectedPattern}
                onUserInput={(query) => {
                  const chatId = activeChatRef.current
                  if (
                    chatId &&
                    ["pending", "deleting", "deleted"].includes(
                      requests.current.phase(chatId),
                    )
                  )
                    return false
                  void handleUserInput(query)
                  return true
                }}
                onClearConversation={handleClearConversation}
                executionKey=""
                isAgentLoading={isAgentLoading || view.phase === "deleting"}
                apiError={view.phase === "failed"}
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

const App: React.FC = () => (
  <AuthGate>{(logout) => <TravelApp onLogout={logout} />}</AuthGate>
)

export default App
