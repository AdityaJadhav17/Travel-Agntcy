/**
 * Copyright AGNTCY Contributors (https://github.com/agntcy)
 * SPDX-License-Identifier: Apache-2.0
 **/

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useReducer,
  useLayoutEffect,
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
import OutboundPreviewCard from "@/components/Chat/OutboundPreviewCard"
import FlightOptionCard from "@/components/Chat/FlightOptionCard"
import TripSummary from "@/components/Chat/TripSummary"
import TravelFollowUpActions from "@/components/Chat/TravelFollowUpActions"
import { parseTravelResult } from "@/types/travelResult"
import { latestTripContext, parseTripContext } from "@/types/tripContext"
import { Plane } from "lucide-react"
import { ChatRequests } from "@/stores/chatRequests"
import type { ChatRequestToken } from "@/stores/chatRequests"
import { TravelStreamError } from "@/utils/travelStream"
import {
  chatDisplayReducer,
  restoreChatDisplay,
  idleView,
  type ChatHistoryItem,
} from "@/stores/chatDisplay"
import AuthGate from "@/components/AuthGate"
import {
  excludeTravelRenderMeasurement,
  finishTravelMeasurement,
  markFinalTravelResponseRendered,
  markFirstUsefulTravelCard,
  markFirstOutboundPreview,
  setTravelBackendTimingId,
  startTravelMeasurement,
} from "@/utils/travelLatency"

export type { ChatHistoryItem } from "@/stores/chatDisplay"
const CHAT_HISTORY_KEY = "travel_chat_history"
const ignoreAnimationReply = () => {}
const emptyMessages: ChatHistoryItem["messages"] = []
const hasUsefulTravelResult = (
  result: ReturnType<typeof parseTravelResult> | undefined,
) => {
  if (!result) return false
  if (result.kind === "airport_comparison")
    return (result.airport_alternatives?.length ?? 0) > 0
  if (result.kind === "date_comparison")
    return (result.date_alternatives?.length ?? 0) > 0
  return (
    result.flights.length + result.hotels.length + result.activities.length > 0
  )
}
const invalidateAttemptRender = (attempt: {
  id: string
  renderEligible: boolean
}) => {
  attempt.renderEligible = false
  excludeTravelRenderMeasurement(attempt.id)
}

async function persistBrowserState(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

const TravelApp: React.FC<{ onLogout: () => Promise<void> }> = ({
  onLogout,
}) => {
  const { streamMessage, cancelStream, deleteConversation } = useAgentAPI()
  const activeChatRef = useRef<string | null>(null)
  const requests = useRef(new ChatRequests())
  const latencyAttempt = useRef<{
    id: string
    chatId: string
    token: ChatRequestToken
    renderEligible: boolean
  } | null>(null)
  const latencyMeasurementsByToken = useRef(new Map<ChatRequestToken, string>())
  const [historyError, setHistoryError] = useState("")
  const [selectedPattern, setSelectedPattern] = useState<PatternType>(
    PATTERNS.TRAVEL_SEARCH,
  )
  const [isSidebarOpen, setIsSidebarOpen] = useState(
    () => window.matchMedia("(min-width: 768px)").matches,
  )
  const [showAgentActivity, setShowAgentActivity] = useState(false)
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
  const tripContext = useMemo(
    () => latestTripContext(conversationMessages),
    [conversationMessages],
  )
  const isAgentLoading = view.phase === "pending"
  const aiReplied = view.phase === "succeeded" || view.phase === "failed"
  const partialResult = view.phase === "pending" ? view.partial : null
  const outboundPreview = view.phase === "pending" ? view.outboundPreview : null
  const verifiedFlight =
    view.phase === "pending" ? view.verifiedFlightPreview : null
  const progressStatus =
    view.phase !== "pending"
      ? ""
      : verifiedFlight
        ? "Checking more fares"
        : outboundPreview
          ? "Checking return options"
          : view.status === "Starting search"
            ? "Reading your trip details"
            : view.status
  const streamText = view.phase === "pending" ? view.text : ""
  const animationToken = view.phase === "pending" ? view.token : null

  useLayoutEffect(() => {
    const attempt = latencyAttempt.current
    if (
      !outboundPreview ||
      !attempt ||
      !attempt.renderEligible ||
      currentChatId !== attempt.chatId ||
      animationToken !== attempt.token ||
      document.visibilityState !== "visible"
    )
      return
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (
          latencyAttempt.current === attempt &&
          attempt.renderEligible &&
          document.visibilityState === "visible"
        )
          markFirstOutboundPreview(attempt.id)
      })
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      if (secondFrame) cancelAnimationFrame(secondFrame)
    }
  }, [animationToken, currentChatId, outboundPreview])

  useLayoutEffect(() => {
    const attempt = latencyAttempt.current
    if (
      !attempt ||
      !attempt.renderEligible ||
      currentChatId !== attempt.chatId ||
      view.phase !== "pending" ||
      (!view.verifiedFlightPreview && !hasUsefulTravelResult(view.partial))
    )
      return
    if (
      typeof document !== "undefined" &&
      document.visibilityState !== "visible"
    )
      return
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (
          latencyAttempt.current === attempt &&
          attempt.renderEligible &&
          document.visibilityState === "visible" &&
          currentChatId === attempt.chatId &&
          view.phase === "pending" &&
          (view.verifiedFlightPreview || hasUsefulTravelResult(view.partial))
        )
          markFirstUsefulTravelCard(attempt.id)
      })
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      if (secondFrame) cancelAnimationFrame(secondFrame)
    }
  }, [currentChatId, view])

  useLayoutEffect(() => {
    const attempt = latencyAttempt.current
    const lastMessage = conversationMessages.at(-1)
    if (
      !attempt ||
      !attempt.renderEligible ||
      currentChatId !== attempt.chatId ||
      view.phase !== "succeeded" ||
      !lastMessage ||
      lastMessage.role !== "assistant"
    )
      return
    if (
      typeof document !== "undefined" &&
      document.visibilityState !== "visible"
    )
      return
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (
          latencyAttempt.current !== attempt ||
          !attempt.renderEligible ||
          document.visibilityState !== "visible" ||
          currentChatId !== attempt.chatId ||
          view.phase !== "succeeded"
        )
          return
        if (hasUsefulTravelResult(lastMessage.travel_result))
          markFirstUsefulTravelCard(attempt.id)
        markFinalTravelResponseRendered(attempt.id)
      })
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      if (secondFrame) cancelAnimationFrame(secondFrame)
    }
  }, [conversationMessages, currentChatId, view.phase])

  useEffect(() => {
    const pendingMeasurements = latencyMeasurementsByToken.current
    const invalidateHiddenAttempt = () => {
      if (document.visibilityState === "hidden" && latencyAttempt.current)
        invalidateAttemptRender(latencyAttempt.current)
    }
    document.addEventListener("visibilitychange", invalidateHiddenAttempt)
    return () => {
      document.removeEventListener("visibilitychange", invalidateHiddenAttempt)
      pendingMeasurements.forEach((id) =>
        finishTravelMeasurement(id, "cancelled"),
      )
      pendingMeasurements.clear()
    }
  }, [])
  const setButtonClicked = useCallback(
    (clicked: boolean) => {
      if (!clicked && animationToken)
        dispatch({ type: "animated", token: animationToken })
    },
    [animationToken],
  )

  const conversationScrollRef = useRef<HTMLDivElement>(null)
  const previousChatId = useRef(currentChatId)
  useLayoutEffect(() => {
    const switchedChat = previousChatId.current !== currentChatId
    previousChatId.current = currentChatId
    const scroller = conversationScrollRef.current
    // Explicit navigation and Send reveal the latest turn. Stream updates
    // leave the reader in place, with normal browser scroll anchoring.
    if (scroller && (switchedChat || animationToken)) {
      scroller.scrollTop = scroller.scrollHeight
    }
  }, [currentChatId, animationToken])

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
    setShowAgentActivity(false)
    const measurementId = startTravelMeasurement()
    latencyAttempt.current = {
      id: measurementId,
      chatId,
      token,
      renderEligible: true,
    }
    latencyMeasurementsByToken.current.set(token, measurementId)
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
            dispatch({ type: event.type, token, message: event.message })
          } else if (event.type === "outbound_preview") {
            dispatch({
              type: "outbound_preview",
              token,
              flights: event.flights,
            })
          } else if (event.type === "verified_flight_preview") {
            dispatch({ type: event.type, token, flight: event.flight })
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
        (timingId) => setTravelBackendTimingId(measurementId, timingId),
      )
    } catch (error) {
      failed = true
      finishTravelMeasurement(
        measurementId,
        error instanceof Error && error.name === "AbortError"
          ? "cancelled"
          : "error",
      )
      latencyMeasurementsByToken.current.delete(token)
      recoverable = error instanceof TravelStreamError && error.retryable
      logger.apiError("/agent/prompt", error)
      response = {
        response: error instanceof Error ? error.message : String(error),
      }
    }
    if (!requests.current.finish(token, failed ? "failed" : "succeeded")) {
      finishTravelMeasurement(measurementId, "cancelled")
      latencyMeasurementsByToken.current.delete(token)
      return
    }
    finishTravelMeasurement(measurementId, failed ? "error" : "success")
    latencyMeasurementsByToken.current.delete(token)
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
        ...(response.trip_state !== undefined
          ? { trip_state: parseTripContext(response.trip_state) }
          : {}),
        retry_hotels: response.retry_hotels,
      },
    })
  }

  const stopChat = (chatId: string) => {
    const token = requests.current.stop(chatId)
    if (!token) return
    const measurementId = latencyMeasurementsByToken.current.get(token)
    if (measurementId) {
      finishTravelMeasurement(measurementId, "cancelled")
      latencyMeasurementsByToken.current.delete(token)
    }
    cancelStream(token.conversationId)
    dispatch({ type: "stop", token })
  }
  const handleStop = () => {
    if (activeChatRef.current) stopChat(activeChatRef.current)
  }
  const handleClearConversation = () => {
    if (latencyAttempt.current) invalidateAttemptRender(latencyAttempt.current)
    activeChatRef.current = null
    setShowAgentActivity(false)
    setHistoryError("")
    setMessages([])
    setCurrentChatId(null)
  }
  const handleNewChat = () => {
    handleClearConversation()
    if (window.matchMedia("(max-width: 767px)").matches) setIsSidebarOpen(false)
  }
  const handleSelectChat = (chatId: string) => {
    const chat = chatHistory.find((item) => item.id === chatId)
    if (!chat) return
    if (latencyAttempt.current && latencyAttempt.current.chatId !== chatId)
      invalidateAttemptRender(latencyAttempt.current)
    activeChatRef.current = chatId
    setCurrentChatId(chatId)
    setShowAgentActivity(false)
    if (window.matchMedia("(max-width: 767px)").matches) setIsSidebarOpen(false)
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
      <div className="flex h-dvh w-full flex-col overflow-hidden bg-[#212121]">
        <Navigation
          onToggleSidebar={handleToggleSidebar}
          isSidebarOpen={isSidebarOpen}
          onLogout={onLogout}
        />
        <div className="relative flex flex-1 overflow-hidden">
          <div className="absolute inset-y-0 left-0 z-20 md:relative">
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
          </div>
          <div
            className={`flex min-w-0 flex-1 flex-col bg-[#212121] ${isSidebarOpen ? "md:border-l md:border-gray-800" : ""}`}
          >
            {historyError && (
              <p role="status" className="px-4 py-2 text-sm text-amber-200">
                {historyError}
              </p>
            )}
            {/* Main content area - scrollable */}
            <div
              ref={conversationScrollRef}
              role="region"
              aria-label="Conversation"
              className="relative flex-1 overflow-y-auto"
            >
              {showWelcome && (
                <div className="mx-auto flex min-h-full w-full max-w-[832px] flex-col justify-end px-8 pt-6">
                  <div className="flex flex-wrap items-center justify-between gap-x-3">
                    <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                      Plan a trip
                    </h1>
                    <button
                      type="button"
                      aria-expanded={showAgentActivity}
                      aria-controls="welcome-agent-graph"
                      onClick={() => setShowAgentActivity((open) => !open)}
                      className="min-h-11 rounded-md text-sm text-gray-400 underline-offset-4 hover:text-gray-200 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-300"
                    >
                      {showAgentActivity
                        ? "Hide agent graph"
                        : "Show agent graph"}
                    </button>
                  </div>
                  <div id="welcome-agent-graph" hidden={!showAgentActivity}>
                    {showAgentActivity && (
                      <div className="h-64">
                        <MainArea
                          pattern={selectedPattern}
                          buttonClicked={false}
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
                  </div>
                </div>
              )}
              {conversationMessages.length > 0 && (
                <div className="mx-auto w-full max-w-[768px] px-4 py-6">
                  {conversationMessages.map((msg, index) => (
                    <div key={`${currentChatId}-${index}`} className="mb-6">
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
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#293c32]">
                            <Plane
                              aria-hidden="true"
                              className="h-4 w-4 text-emerald-200"
                            />
                          </div>
                          <div className="min-w-0 flex-1 pt-1 text-[15px]">
                            <TravelResponseCard
                              content={msg.content}
                              budget={msg.budget_assessment}
                              travelResult={msg.travel_result}
                            />
                            {index === conversationMessages.length - 1 &&
                              view.phase !== "deleting" && (
                                <TravelFollowUpActions
                                  kind={
                                    parseTravelResult(msg.travel_result)?.kind
                                  }
                                  retryHotels={msg.retry_hotels}
                                  onAction={(prompt) =>
                                    void handleUserInput(prompt)
                                  }
                                />
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
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#293c32]">
                        <Plane
                          aria-hidden="true"
                          className="h-4 w-4 text-emerald-200"
                        />
                      </div>
                      <div className="min-w-0 flex-1 space-y-3 pt-1">
                        <p role="status" className="text-sm text-emerald-200">
                          {progressStatus || "Working on your trip"}
                        </p>
                        {partialResult && (
                          <StructuredTravelResultCard result={partialResult} />
                        )}
                        {outboundPreview && (
                          <OutboundPreviewCard flights={outboundPreview} />
                        )}
                        {verifiedFlight && (
                          <section
                            aria-label="First checked round trip"
                            className="space-y-3"
                          >
                            <h3 className="text-lg font-semibold tracking-tight text-white">
                              First checked round trip
                            </h3>
                            <FlightOptionCard
                              leg={verifiedFlight.outbound}
                              quote={{
                                state: "complete",
                                fare: verifiedFlight.total_usd,
                                oneWay: false,
                                returned: verifiedFlight.returned,
                              }}
                            />
                          </section>
                        )}
                        {streamText && (
                          <p className="text-sm whitespace-pre-wrap text-gray-300">
                            {streamText}
                          </p>
                        )}
                        <button
                          type="button"
                          aria-expanded={showAgentActivity}
                          aria-controls="pending-agent-activity"
                          onClick={() => setShowAgentActivity((open) => !open)}
                          className="min-h-11 rounded-md px-2 text-sm text-gray-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-emerald-300"
                        >
                          {showAgentActivity
                            ? "Hide agent graph"
                            : "Show agent graph"}
                        </button>
                        <div
                          id="pending-agent-activity"
                          hidden={!showAgentActivity}
                        >
                          {showAgentActivity && (
                            <div className="h-64">
                              <MainArea
                                pattern={selectedPattern}
                                buttonClicked={false}
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
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex w-full flex-none flex-col items-center justify-end bg-[#212121] px-4 pt-2 pb-6">
              {tripContext && (
                <TripSummary
                  key={`${currentChatId}-${conversationMessages.length}-${view.phase}`}
                  trip={tripContext}
                  disabled={isAgentLoading || view.phase === "deleting"}
                  onSearch={(prompt) => {
                    if (activeChatRef.current === currentChatId)
                      void handleUserInput(prompt)
                  }}
                />
              )}
              <ChatArea
                setMessages={setMessages}
                setButtonClicked={setButtonClicked}
                setAiReplied={ignoreAnimationReply}
                isBottomLayout={true}
                showTravelStarters={showWelcome}
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
                onStop={isAgentLoading ? handleStop : undefined}
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
