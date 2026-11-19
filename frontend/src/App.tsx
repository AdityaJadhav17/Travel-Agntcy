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
  useSyncExternalStore,
} from "react"
import { LOCAL_STORAGE_KEY } from "@/components/Chat/Messages"
import { logger } from "@/utils/logger"
import Navigation from "@/components/Navigation/Navigation"
import MainArea from "@/components/MainArea/MainArea"
import { useAgentAPI, type ApiResponse } from "@/hooks/useAgentAPI"
import ChatArea from "@/components/Chat/ChatArea"
import {
  SavedFlightsProvider,
  SavedFlightsPanel,
} from "@/components/Chat/SavedFlights"
import { clearSavedFlights } from "@/stores/savedFlights"
import Sidebar from "@/components/Sidebar/Sidebar"
import { ThemeProvider } from "@/contexts/ThemeContext"
import { Message } from "./types/message"
import { PATTERNS } from "@/utils/patternUtils"
import TravelResponseCard from "@/components/Chat/TravelResponseCard"
import StructuredTravelResultCard from "@/components/Chat/StructuredTravelResultCard"
import OutboundPreviewCard from "@/components/Chat/OutboundPreviewCard"
import TravelFollowUpActions from "@/components/Chat/TravelFollowUpActions"
import { parseTravelResult } from "@/types/travelResult"
import { latestTripContext, parseTripContext } from "@/types/tripContext"
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

function useTripDetails(messages: ChatHistoryItem["messages"]) {
  return useMemo(() => {
    let latestResultIndex = -1
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (message.role !== "assistant") continue
      if (message.travel_result) {
        latestResultIndex = index
        break
      }
      if (message.trip_state !== undefined) break
    }
    return { tripContext: latestTripContext(messages), latestResultIndex }
  }, [messages])
}
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

const mobileLayoutQuery = "(width < 768px)"
const isMobileLayout = () => window.matchMedia(mobileLayoutQuery).matches

function subscribeToMobileLayout(onChange: () => void) {
  const query = window.matchMedia(mobileLayoutQuery)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
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
  const selectedPattern = PATTERNS.TRAVEL_SEARCH
  const isMobile = useSyncExternalStore(subscribeToMobileLayout, isMobileLayout)
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const sidebarToggle = useRef<HTMLButtonElement>(null)
  const isSidebarOpen = isMobile ? mobileSidebarOpen : desktopSidebarOpen
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<ReadonlyMap<string | null, string>>(
    () => new Map(),
  )
  const updateDraft = (id: string | null, value: string) => {
    setDrafts((previous) => {
      if ((previous.get(id) || "") === value) return previous
      const next = new Map(previous)
      if (value) next.set(id, value)
      else next.delete(id)
      return next
    })
  }
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
  const { tripContext, latestResultIndex } =
    useTripDetails(conversationMessages)
  const isAgentLoading = view.phase === "pending"
  const aiReplied = view.phase === "succeeded" || view.phase === "failed"
  const partialResult = view.phase === "pending" ? view.partial : null
  const outboundPreview = view.phase === "pending" ? view.outboundPreview : null
  const verifiedFlight =
    view.phase === "pending" ? view.verifiedFlightPreview : null
  const progressStatus =
    view.phase === "pending" && view.status !== "Starting search"
      ? view.status
      : "Thinking"
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
  const followConversationRef = useRef(true)
  const latestResultRef = useRef<HTMLDivElement>(null)
  const [visibleHeading, setVisibleHeading] = useState("")
  const latestResultKey =
    latestResultIndex < 0 ? "" : `${currentChatId}-${latestResultIndex}`

  useEffect(() => {
    const scroller = conversationScrollRef.current
    const heading = latestResultRef.current?.querySelector(
      "[data-trip-result-heading]",
    )
    if (!scroller || !heading || !latestResultKey) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1)
        if (entry)
          setVisibleHeading(
            entry.isIntersecting && entry.intersectionRatio >= 0.98
              ? latestResultKey
              : "",
          )
      },
      { root: scroller, threshold: 0.98 },
    )
    observer.observe(heading)
    return () => observer.disconnect()
  }, [latestResultKey, conversationMessages])

  const previousChatId = useRef(currentChatId)
  useLayoutEffect(() => {
    const switchedChat = previousChatId.current !== currentChatId
    previousChatId.current = currentChatId
    const scroller = conversationScrollRef.current
    // Explicit navigation and Send reveal the latest turn. Stream updates
    // follow that turn only while the reader stays near the bottom.
    if (scroller && (switchedChat || animationToken)) {
      followConversationRef.current = true
      const heading = latestResultRef.current?.querySelector(
        "[data-trip-result-heading]",
      )
      if (switchedChat && !animationToken && heading) {
        heading.scrollIntoView({ block: "start" })
      } else {
        scroller.scrollTop = scroller.scrollHeight
      }
    }
  }, [currentChatId, animationToken])

  useLayoutEffect(() => {
    const scroller = conversationScrollRef.current
    if (scroller && isAgentLoading && followConversationRef.current)
      scroller.scrollTop = scroller.scrollHeight
  }, [
    isAgentLoading,
    outboundPreview,
    partialResult,
    progressStatus,
    streamText,
    verifiedFlight,
  ])

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

  const handleUserInput = async (query: string, recover = false) => {
    if (!query.trim()) return
    const chatId = activeChatRef.current || crypto.randomUUID()
    const existingChat = chatHistory.find((chat) => chat.id === chatId)
    const conversationId = existingChat?.conversationId || crypto.randomUUID()
    const token = requests.current.start(chatId, conversationId)
    if (!token) return
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
    setHistoryError("")
    setMessages([])
    setCurrentChatId(null)
  }
  const handleNewChat = () => {
    updateDraft(null, "")
    handleClearConversation()
  }
  const handleSelectChat = (chatId: string) => {
    const chat = chatHistory.find((item) => item.id === chatId)
    if (!chat) return
    if (latencyAttempt.current && latencyAttempt.current.chatId !== chatId)
      invalidateAttemptRender(latencyAttempt.current)
    activeChatRef.current = chatId
    setCurrentChatId(chatId)
    setHistoryError(
      chat.conversationId
        ? ""
        : "You can read this saved trip. To search again, include the route and dates in your next message.",
    )
  }
  const handleDeleteChat = async (chatId: string) => {
    const chat = chatHistory.find((item) => item.id === chatId)
    stopChat(chatId)
    if (!requests.current.beginDelete(chatId)) return false
    dispatch({ type: "delete-start", chatId })
    try {
      if (chat?.conversationId) await deleteConversation(chat.conversationId)
      updateDraft(chatId, "")
      clearSavedFlights(chatId)
      requests.current.finishDelete(chatId, true)
      dispatch({ type: "delete-done", chatId })
      if (activeChatRef.current === chatId) handleClearConversation()
      return true
    } catch {
      requests.current.finishDelete(chatId, false)
      dispatch({ type: "delete-failed", chatId })
      setHistoryError(
        "Could not delete the saved conversation. Please try again.",
      )
      return false
    }
  }
  const handleToggleSidebar = () => {
    if (isMobile) setMobileSidebarOpen((open) => !open)
    else setDesktopSidebarOpen((open) => !open)
  }
  const showWelcome = conversationMessages.length === 0

  return (
    <div className="travel-ui flex h-dvh w-full flex-col overflow-hidden bg-travel-canvas text-travel-text">
      <Navigation
        onToggleSidebar={handleToggleSidebar}
        isSidebarOpen={isSidebarOpen}
        isMobile={isMobile}
        sidebarToggle={sidebarToggle}
        onLogout={onLogout}
        agentGraph={
          <MainArea
            pattern={selectedPattern}
            buttonClicked={false}
            setButtonClicked={setButtonClicked}
            aiReplied={aiReplied}
            setAiReplied={ignoreAnimationReply}
          />
        }
      />
      <div className="relative flex flex-1 overflow-hidden">
        {isSidebarOpen && (
          <Sidebar
            onNewChat={handleNewChat}
            onSelectChat={handleSelectChat}
            onDeleteChat={handleDeleteChat}
            chatHistory={chatHistory}
            currentChatId={currentChatId}
            isMobile={isMobile}
            onClose={() => {
              setMobileSidebarOpen(false)
              sidebarToggle.current?.focus()
            }}
          />
        )}
        <SavedFlightsProvider tripId={currentChatId}>
          <div
            className={`flex min-w-0 flex-1 flex-col bg-travel-canvas ${showWelcome ? "overflow-y-auto" : ""}`}
          >
            {historyError && (
              <p
                role="status"
                className="px-4 py-2 text-sm text-travel-warning"
              >
                {historyError}
              </p>
            )}
            {/* Main content area - scrollable */}
            <SavedFlightsPanel />
            <div
              ref={conversationScrollRef}
              role="region"
              aria-label="Conversation"
              className={
                showWelcome
                  ? "mt-auto flex-none"
                  : "relative flex-1 overflow-y-auto"
              }
              onScroll={(event) => {
                const { scrollHeight, scrollTop, clientHeight } =
                  event.currentTarget
                followConversationRef.current =
                  scrollHeight - scrollTop - clientHeight <= 24
              }}
            >
              {showWelcome && (
                <div className="mx-auto w-full max-w-[928px] px-4 pt-6 sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-x-3">
                    <h1 className="text-2xl font-semibold tracking-tight text-travel-text sm:text-3xl">
                      Plan a trip
                    </h1>
                  </div>
                </div>
              )}
              {conversationMessages.length > 0 && (
                <div className="mx-auto w-full max-w-[928px] px-4 py-6 sm:px-6">
                  {conversationMessages.map((msg, index) => (
                    <div key={`${currentChatId}-${index}`} className="mb-6">
                      {msg.role === "user" ? (
                        /* User Message - right aligned bubble */
                        <div className="mx-auto flex max-w-[704px] justify-end">
                          <div className="max-w-[85%] rounded-3xl bg-travel-raised px-5 py-3 text-[15px] text-travel-text">
                            {msg.content}
                          </div>
                        </div>
                      ) : (
                        <div
                          ref={
                            index === latestResultIndex
                              ? latestResultRef
                              : undefined
                          }
                          className="min-w-0 pt-1 text-[15px]"
                        >
                          <TravelResponseCard
                            content={msg.content}
                            budget={msg.budget_assessment}
                            travelResult={msg.travel_result}
                          />
                          {index === conversationMessages.length - 1 &&
                            view.phase !== "deleting" && (
                              <TravelFollowUpActions
                                result={parseTravelResult(msg.travel_result)}
                                retryHotels={msg.retry_hotels}
                                onAction={(prompt) =>
                                  void handleUserInput(prompt)
                                }
                              />
                            )}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Loading indicator */}
                  {view.phase === "interrupted" && (
                    <div className="mb-6 space-y-3 rounded-lg border border-travel-warning-border bg-travel-warning-soft p-4 text-sm text-travel-warning">
                      <p role="status">
                        {currentChat?.recoveryError?.replace(
                          / Please retry your last message\.$/,
                          "",
                        ) || "Your search was interrupted."}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          const last = conversationMessages.at(-1)
                          if (last?.role === "user")
                            void handleUserInput(last.content, true)
                        }}
                        className="rounded-lg border border-travel-warning-border px-3 py-2 hover:bg-travel-surface"
                      >
                        Retry search
                      </button>
                    </div>
                  )}
                  {view.phase === "deleting" && (
                    <p role="status" className="mb-6 text-sm text-travel-muted">
                      Deleting conversation...
                    </p>
                  )}
                  {isAgentLoading && (
                    <div className="mb-6 min-w-0 space-y-3 pt-1">
                      {partialResult && (
                        <StructuredTravelResultCard result={partialResult} />
                      )}
                      {(outboundPreview || verifiedFlight) && (
                        <OutboundPreviewCard
                          flights={outboundPreview}
                          checked={verifiedFlight}
                        />
                      )}
                      {streamText && (
                        <p className="text-sm whitespace-pre-wrap text-travel-muted">
                          {streamText}
                        </p>
                      )}
                      <p
                        role="status"
                        className="text-sm font-medium text-travel-muted"
                      >
                        <span className="travel-progress">
                          {progressStatus}
                        </span>
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div
              className={`mx-auto flex w-full max-w-[928px] flex-none flex-col items-center justify-end bg-travel-canvas px-4 pt-1 pb-2 sm:px-6 sm:pb-4 ${showWelcome ? "sm:mb-auto" : ""}`}
            >
              <ChatArea
                content={drafts.get(currentChatId) || ""}
                setContent={(value) => updateDraft(currentChatId, value)}
                setMessages={setMessages}
                setButtonClicked={setButtonClicked}
                setAiReplied={ignoreAnimationReply}
                isBottomLayout={true}
                showTravelStarters={showWelcome}
                trip={tripContext}
                tripEditorKey={`${currentChatId}-${conversationMessages.length}-${view.phase}`}
                showTripDetails={
                  !latestResultKey || visibleHeading !== latestResultKey
                }
                onTripSearch={(prompt) => {
                  if (activeChatRef.current === currentChatId)
                    void handleUserInput(prompt)
                }}
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
                auctionState={{
                  events: [],
                  status: "idle",
                  error: null,
                }}
              />
            </div>
          </div>
        </SavedFlightsProvider>
      </div>
    </div>
  )
}

const App: React.FC = () => (
  <ThemeProvider>
    <AuthGate>{(logout) => <TravelApp onLogout={logout} />}</AuthGate>
  </ThemeProvider>
)

export default App
