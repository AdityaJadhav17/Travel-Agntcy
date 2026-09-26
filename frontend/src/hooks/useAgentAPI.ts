/**
 * Copyright AGNTCY Contributors (https://github.com/agntcy)
 * SPDX-License-Identifier: Apache-2.0
 **/

import React, { useRef, useState, useEffect } from "react"
import axios from "axios"
import { v4 as uuid } from "uuid"
import { Message } from "@/types/message"
import { BudgetAssessment } from "@/types/budget"
import type { TravelResult } from "@/types/travelResult"
import { isLocalDev, parseApiError, Role } from "@/utils/const"
import { withRetry, RETRY_CONFIG } from "@/utils/retryUtils"
import { shouldEnableRetries, getApiUrlForPattern } from "@/utils/patternUtils"

interface ApiResponse {
  response: string
  session_id?: string
  conversation_id?: string
  trip_state?: Record<string, unknown>
  budget_assessment?: BudgetAssessment | null
  travel_result?: TravelResult | null
  retry_hotels?: boolean
}

export type TravelStreamEvent =
  | { type: "status"; component: string; message: string }
  | { type: "result"; component: string; travel_result: TravelResult }
  | { type: "error"; component: string; message: string }
  | { type: "text"; text: string }

interface UseAgentAPIReturn {
  loading: boolean
  sendMessage: (
    prompt: string,
    pattern?: string,
    conversationId?: string,
  ) => Promise<ApiResponse>
  streamMessage: (
    prompt: string,
    pattern: string,
    conversationId: string,
    onEvent: (event: TravelStreamEvent) => void,
  ) => Promise<ApiResponse>
  cancelStream: (conversationId: string) => void
  deleteConversation: (conversationId: string) => Promise<void>
  sendMessageWithCallback: (
    prompt: string,
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
    callbacks?: {
      onStart?: () => void
      onSuccess?: (response: ApiResponse) => void
      onError?: (error: any) => void
      onRetryAttempt?: (
        attempt: number,
        error: Error,
        nextRetryAt: number,
      ) => void
    },
    pattern?: string,
  ) => Promise<void>
  cancel: () => void
}

export const useAgentAPI = (): UseAgentAPIReturn => {
  const [loading, setLoading] = useState<boolean>(false)
  const abortRef = useRef<AbortController | null>(null)
  const streamControllers = useRef(new Map<string, AbortController>())
  const requestIdRef = useRef<number>(0)

  const cancel = () => {
    if (abortRef.current) {
      abortRef.current.abort()
    }
    requestIdRef.current += 1
  }

  const cancelStream = (conversationId: string) => {
    streamControllers.current.get(conversationId)?.abort()
  }

  useEffect(() => {
    const controllers = streamControllers.current
    return () => {
      if (abortRef.current) {
        abortRef.current.abort()
      }
      controllers.forEach((controller) => controller.abort())
    }
  }, [])

  const sendMessage = async (
    prompt: string,
    pattern?: string,
    conversationId?: string,
  ): Promise<ApiResponse> => {
    if (!prompt.trim()) {
      throw new Error("Prompt cannot be empty")
    }

    const apiUrl = getApiUrlForPattern(pattern)
    setLoading(true)

    const controller = new AbortController()
    abortRef.current = controller
    const myRequestId = requestIdRef.current + 1
    requestIdRef.current = myRequestId

    const requestId = uuid()
    const makeApiCall = async (): Promise<ApiResponse> => {
      const response = await axios.post<ApiResponse>(
        `${apiUrl}/agent/prompt`,
        { prompt, conversation_id: conversationId, request_id: requestId },
        {
          signal: controller.signal,
          withCredentials: !isLocalDev,
        },
      )
      return response.data
    }

    try {
      if (shouldEnableRetries(pattern)) {
        return await withRetry(makeApiCall)
      } else {
        return await makeApiCall()
      }
    } catch (error) {
      const { status, message } = parseApiError(error)
      if (status && status >= 400 && status < 500) {
        throw new Error(`HTTP ${status} - ${message}`)
      }
      throw new Error(message)
    } finally {
      if (requestIdRef.current === myRequestId) {
        setLoading(false)
      }
    }
  }

  const streamMessage = async (
    prompt: string,
    pattern: string,
    conversationId: string,
    onEvent: (event: TravelStreamEvent) => void,
  ): Promise<ApiResponse> => {
    const controller = new AbortController()
    streamControllers.current.set(conversationId, controller)
    const requestId = uuid()
    let answer: ApiResponse | null = null
    let streamError: Error | null = null
    let buffer = ""
    const processLine = (line: string) => {
      if (!line.trim()) return
      const event = JSON.parse(line) as Record<string, unknown>
      if (event.type === "done") {
        const result = event.result as ApiResponse | undefined
        if (!result || typeof result.response !== "string") {
          throw new Error("The travel service returned an invalid result.")
        }
        answer = result
      } else if (
        event.type === "status" ||
        event.type === "result" ||
        event.type === "text" ||
        event.type === "error"
      ) {
        if (event.type === "error" && event.component === "request") {
          streamError = new Error(
            String(event.message || "Travel search failed."),
          )
        } else {
          onEvent(event as TravelStreamEvent)
        }
      }
    }
    try {
      const response = await fetch(
        `${getApiUrlForPattern(pattern)}/agent/prompt/stream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            conversation_id: conversationId,
            request_id: requestId,
          }),
          signal: controller.signal,
          credentials: isLocalDev ? "same-origin" : "include",
        },
      )
      if (!response.ok || !response.body) {
        throw new Error(`Travel service returned HTTP ${response.status}.`)
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { value, done } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        let end = buffer.indexOf("\n")
        while (end !== -1) {
          processLine(buffer.slice(0, end))
          buffer = buffer.slice(end + 1)
          end = buffer.indexOf("\n")
        }
        if (done) break
      }
      if (buffer.trim()) processLine(buffer)
      if (streamError) throw streamError
      if (!answer)
        throw new Error("The travel service ended before sending a result.")
      return answer
    } finally {
      if (streamControllers.current.get(conversationId) === controller) {
        streamControllers.current.delete(conversationId)
      }
    }
  }

  const sendMessageWithCallback = async (
    prompt: string,
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
    callbacks?: {
      onStart?: () => void
      onSuccess?: (response: ApiResponse) => void
      onError?: (error: any) => void
      onRetryAttempt?: (
        attempt: number,
        error: Error,
        nextRetryAt: number,
      ) => void
    },
    pattern?: string,
  ): Promise<void> => {
    if (!prompt.trim()) return

    const apiUrl = getApiUrlForPattern(pattern)
    const controller = new AbortController()
    abortRef.current = controller
    const myRequestId = requestIdRef.current + 1
    requestIdRef.current = myRequestId

    const userMessage: Message = {
      role: Role.USER,
      content: prompt,
      id: uuid(),
      animate: false,
    }

    const loadingMessage: Message = {
      role: "assistant",
      content: "...",
      id: uuid(),
      animate: true,
    }

    setMessages((prevMessages: Message[]) => [
      ...prevMessages,
      userMessage,
      loadingMessage,
    ])
    setLoading(true)

    if (callbacks?.onStart) {
      callbacks.onStart()
    }

    const makeApiCall = async (): Promise<ApiResponse> => {
      const response = await axios.post<ApiResponse>(
        `${apiUrl}/agent/prompt`,
        { prompt },
        {
          signal: controller.signal,
          withCredentials: !isLocalDev,
        },
      )
      return response.data
    }

    const onRetryAttempt = (attempt: number) => {
      const delay =
        RETRY_CONFIG.baseDelay *
        Math.pow(RETRY_CONFIG.backoffMultiplier, attempt - 1)
      const nextRetryAt = Date.now() + delay

      setMessages((prevMessages: Message[]) => {
        const updatedMessages = [...prevMessages]
        updatedMessages[updatedMessages.length - 1] = {
          role: "assistant",
          content: `Retrying... (${attempt}/${RETRY_CONFIG.maxRetries})`,
          id: uuid(),
          animate: true,
        }
        return updatedMessages
      })

      if (callbacks?.onRetryAttempt) {
        callbacks.onRetryAttempt(
          attempt,
          new Error("Retry attempt"),
          nextRetryAt,
        )
      }
    }

    try {
      let apiResponse: ApiResponse

      if (shouldEnableRetries(pattern)) {
        apiResponse = await withRetry(makeApiCall, onRetryAttempt)
      } else {
        apiResponse = await makeApiCall()
      }

      if (requestIdRef.current === myRequestId) {
        setMessages((prevMessages: Message[]) => {
          const updatedMessages = [...prevMessages]
          updatedMessages[updatedMessages.length - 1] = {
            role: "assistant",
            content: apiResponse.response,
            id: uuid(),
            animate: true,
          }
          return updatedMessages
        })
      }

      if (callbacks?.onSuccess) {
        callbacks.onSuccess(apiResponse)
      }
    } catch (error) {
      const { status, message } = parseApiError(error)
      const userMessage =
        status && status >= 400 && status < 500
          ? `HTTP ${status} - ${message}`
          : message

      if (requestIdRef.current === myRequestId) {
        setMessages((prevMessages: Message[]) => {
          const updatedMessages = [...prevMessages]
          updatedMessages[updatedMessages.length - 1] = {
            role: "assistant",
            content: userMessage,
            id: uuid(),
            animate: false,
          }
          return updatedMessages
        })
      }

      if (callbacks?.onError) {
        callbacks.onError(error)
      }
    } finally {
      if (requestIdRef.current === myRequestId) {
        setLoading(false)
      }
    }
  }

  const deleteConversation = async (conversationId: string) => {
    await axios.delete(
      `${getApiUrlForPattern()}/conversations/${conversationId}`,
    )
  }

  return {
    deleteConversation,
    loading,
    sendMessage,
    streamMessage,
    cancelStream,
    sendMessageWithCallback,
    cancel,
  }
}
