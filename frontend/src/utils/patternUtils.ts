/**
 * Copyright AGNTCY Contributors (https://github.com/agntcy)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pattern Utilities for Travel Agent
 *
 * This module provides pattern-based configuration for the Travel Planning Agent.
 * The travel agent uses HTTP communication between the supervisor and agents.
 **/

export const PATTERNS = {
  // Travel agent patterns
  TRAVEL_SEARCH: "travel_search",
  TRAVEL_SEARCH_STREAMING: "travel_search_streaming",

  // Legacy patterns (mapped to travel search for compatibility)
  GROUP_COMMUNICATION: "travel_search",
  PUBLISH_SUBSCRIBE: "travel_search",
  PUBLISH_SUBSCRIBE_STREAMING: "travel_search_streaming",
} as const

export type PatternType = (typeof PATTERNS)[keyof typeof PATTERNS]

/**
 * Check if the pattern requires group communication
 * Travel agent doesn't use complex group communication
 */
export const isGroupCommunication = (_pattern?: string): boolean => {
  return false
}

/**
 * Determine if retries should be enabled for a pattern
 */
export const shouldEnableRetries = (_pattern?: string): boolean => {
  return false
}

/**
 * Get the API URL for the travel supervisor
 * The travel agent runs on port 8000 by default
 */
export const getApiUrlForPattern = (_pattern?: string): string => {
  const DEFAULT_TRAVEL_API_URL = "http://127.0.0.1:8000"
  const TRAVEL_APP_API_URL =
    import.meta.env.VITE_EXCHANGE_APP_API_URL || DEFAULT_TRAVEL_API_URL

  // All travel patterns use the same API URL
  return TRAVEL_APP_API_URL
}

/**
 * Check if pattern supports Server-Sent Events
 */
export const supportsSSE = (_pattern?: string): boolean => {
  return false
}

/**
 * Get the streaming endpoint URL for a pattern
 */
export const getStreamingEndpointForPattern = (pattern?: string): string => {
  return `${getApiUrlForPattern(pattern)}/agent/prompt/stream`
}

/**
 * Check if a pattern uses streaming responses
 */
export const isStreamingPattern = (pattern?: string): boolean => {
  return pattern === PATTERNS.TRAVEL_SEARCH_STREAMING
}

/**
 * Check if pattern supports transport updates (NATS/SLIM display)
 */
export const supportsTransportUpdates = (_pattern?: string): boolean => {
  return true
}

/**
 * Get a human-readable display name for a pattern
 */
export const getPatternDisplayName = (pattern?: string): string => {
  switch (pattern) {
    case PATTERNS.TRAVEL_SEARCH:
      return "Travel Search"
    case PATTERNS.TRAVEL_SEARCH_STREAMING:
      return "Travel Search: Streaming"
    default:
      return "Travel Agent"
  }
}
