/**
 * Copyright AGNTCY Contributors (https://github.com/agntcy)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Graph Configurations for Travel Agent
 *
 * This module defines the visual graph configuration for the Travel Planning Agent.
 * The travel agent has a simplified architecture compared to the original coffee demo:
 * - Single supervisor node (Travel Agent)
 * - External API connection (SerpAPI) instead of farm workers
 **/

import { Plane, Hotel, MapPin } from "lucide-react"
import { Node, Edge } from "@xyflow/react"
import supervisorIcon from "@/assets/supervisor.png"
import {
  NODE_IDS,
  EDGE_IDS,
  NODE_TYPES,
  EDGE_TYPES,
  EDGE_LABELS,
  HANDLE_TYPES,
  VERIFICATION_STATUS,
} from "./const"
import { logger } from "./logger"
import urlsConfig from "./urls.json"
import { isGroupCommunication, getApiUrlForPattern } from "./patternUtils"

export interface GraphConfig {
  title: string
  nodes: Node[]
  edges: Edge[]
  animationSequence: { ids: string[] }[]
}

/**
 * Travel Search Configuration with A2A Communication
 *
 * Architecture:
 * - Travel Supervisor: Main agent that coordinates the search (A2A Client)
 * - NATS Transport: A2A message transport layer
 * - Flight Agent: A2A agent that searches flights via SerpAPI
 * - Hotel Agent: A2A agent that searches hotels via SerpAPI
 */
const TRAVEL_SEARCH_CONFIG: GraphConfig = {
  title: "Travel Planning Agent Network (A2A)",
  nodes: [
    // Travel Supervisor Node - Main agent
    {
      id: NODE_IDS.AUCTION_AGENT, // Reusing ID for compatibility
      type: NODE_TYPES.CUSTOM,
      data: {
        icon: (
          <img
            src={supervisorIcon}
            alt="Supervisor Icon"
            className="dark-icon h-4 w-4 object-contain"
          />
        ),
        label1: "Travel Agent",
        label2: "Supervisor",
        handles: HANDLE_TYPES.SOURCE,
        verificationStatus: VERIFICATION_STATUS.VERIFIED,
        hasBadgeDetails: true,
        hasPolicyDetails: true,
        // GitHub link - update this to point to travel supervisor
        githubLink: `${urlsConfig.github.baseUrl}/agents/supervisors/travel`,
        agentDirectoryLink: urlsConfig.agentDirectory.baseUrl,
      },
      position: { x: 450, y: 80 },
    },
    // Transport Node - Shows NATS/SLIM transport
    {
      id: NODE_IDS.TRANSPORT,
      type: NODE_TYPES.TRANSPORT,
      data: {
        label: "Transport: ",
        githubLink: `${urlsConfig.github.appSdkBaseUrl}${urlsConfig.github.transports.general}`,
      },
      position: { x: 350, y: 280 },
    },
    // Flight Search Agent Node - A2A Server
    {
      id: NODE_IDS.BRAZIL_FARM, // Reusing ID for compatibility
      type: NODE_TYPES.CUSTOM,
      data: {
        icon: <Plane className="dark-icon h-4 w-4" />,
        label1: "Flight Agent",
        label2: "A2A Server",
        handles: HANDLE_TYPES.TARGET,
        // A2A agent - verified
        verificationStatus: VERIFICATION_STATUS.VERIFIED,
        githubLink: `${urlsConfig.github.baseUrl}/agents/flight`,
        agentDirectoryLink: urlsConfig.agentDirectory.baseUrl,
      },
      position: { x: 250, y: 480 }, // Left position for 3-agent layout
    },
    // Hotel Search Agent Node - A2A Server
    {
      id: NODE_IDS.COLOMBIA_FARM, // Reusing ID for compatibility
      type: NODE_TYPES.CUSTOM,
      data: {
        icon: <Hotel className="dark-icon h-4 w-4" />,
        label1: "Hotel Agent",
        label2: "A2A Server",
        handles: HANDLE_TYPES.TARGET,
        // A2A agent - verified
        verificationStatus: VERIFICATION_STATUS.VERIFIED,
        githubLink: `${urlsConfig.github.baseUrl}/agents/hotel`,
        agentDirectoryLink: urlsConfig.agentDirectory.baseUrl,
      },
      position: { x: 450, y: 480 },
    },
    // Activity Search Agent Node - A2A Server
    {
      id: NODE_IDS.VIETNAM_FARM, // Reusing ID for compatibility
      type: NODE_TYPES.CUSTOM,
      data: {
        icon: <MapPin className="dark-icon h-4 w-4" />,
        label1: "Activity Agent",
        label2: "A2A Server",
        handles: HANDLE_TYPES.TARGET,
        // A2A agent - verified
        verificationStatus: VERIFICATION_STATUS.VERIFIED,
        githubLink: `${urlsConfig.github.baseUrl}/agents/activity`,
        agentDirectoryLink: urlsConfig.agentDirectory.baseUrl,
      },
      position: { x: 650, y: 480 },
    },
  ],
  edges: [
    // Supervisor to Transport
    {
      id: EDGE_IDS.AUCTION_TO_TRANSPORT,
      source: NODE_IDS.AUCTION_AGENT,
      target: NODE_IDS.TRANSPORT,
      targetHandle: "top",
      data: { label: EDGE_LABELS.A2A },
      type: EDGE_TYPES.CUSTOM,
    },
    // Transport to Flight Agent (A2A)
    {
      id: EDGE_IDS.TRANSPORT_TO_BRAZIL,
      source: NODE_IDS.TRANSPORT,
      target: NODE_IDS.BRAZIL_FARM,
      sourceHandle: "bottom_left",
      data: { label: EDGE_LABELS.A2A }, // A2A protocol over NATS
      type: EDGE_TYPES.CUSTOM,
    },
    // Transport to Hotel Agent (A2A) - uses bottom_center handle for middle position
    {
      id: EDGE_IDS.TRANSPORT_TO_COLOMBIA,
      source: NODE_IDS.TRANSPORT,
      target: NODE_IDS.COLOMBIA_FARM,
      sourceHandle: "bottom_center",
      data: { label: EDGE_LABELS.A2A }, // A2A protocol over NATS
      type: EDGE_TYPES.CUSTOM,
    },
    // Transport to Activity Agent (A2A)
    {
      id: EDGE_IDS.TRANSPORT_TO_VIETNAM,
      source: NODE_IDS.TRANSPORT,
      target: NODE_IDS.VIETNAM_FARM,
      sourceHandle: "bottom_right",
      data: { label: EDGE_LABELS.A2A }, // A2A protocol over NATS
      type: EDGE_TYPES.CUSTOM,
    },
  ],
  // Animation sequence for the graph
  animationSequence: [
    { ids: [NODE_IDS.AUCTION_AGENT] },
    { ids: [EDGE_IDS.AUCTION_TO_TRANSPORT] },
    { ids: [NODE_IDS.TRANSPORT] },
    {
      ids: [
        EDGE_IDS.TRANSPORT_TO_BRAZIL,
        EDGE_IDS.TRANSPORT_TO_COLOMBIA,
        EDGE_IDS.TRANSPORT_TO_VIETNAM,
      ],
    },
    {
      ids: [
        NODE_IDS.BRAZIL_FARM,
        NODE_IDS.COLOMBIA_FARM,
        NODE_IDS.VIETNAM_FARM,
      ],
    },
  ],
}

/**
 * Get the graph configuration for a given pattern
 *
 * Travel agent patterns:
 * - travel_search: Standard travel search
 * - travel_search_streaming: Streaming travel search with real-time updates
 */
export const getGraphConfig = (
  pattern: string,
  _isConnected?: boolean,
): GraphConfig => {
  switch (pattern) {
    case "travel_search":
      return {
        ...TRAVEL_SEARCH_CONFIG,
        nodes: [...TRAVEL_SEARCH_CONFIG.nodes],
        edges: [...TRAVEL_SEARCH_CONFIG.edges],
      }
    case "travel_search_streaming": {
      // Streaming config - same graph with streaming badge
      const streamingConfig = {
        ...TRAVEL_SEARCH_CONFIG,
        title: "Travel Planning Agent Network (Streaming)",
        nodes: TRAVEL_SEARCH_CONFIG.nodes.map((node) => {
          if (node.id === NODE_IDS.AUCTION_AGENT) {
            return {
              ...node,
              data: {
                ...node.data,
                label2: "Supervisor (Streaming)",
              },
            }
          }
          return node
        }),
        edges: [...TRAVEL_SEARCH_CONFIG.edges],
      }
      return streamingConfig
    }
    default:
      // Default to travel search config
      return TRAVEL_SEARCH_CONFIG
  }
}

/**
 * Update transport labels in the graph based on current configuration
 *
 * Fetches the transport type (NATS/SLIM) from the travel supervisor
 * and updates the graph nodes and edges accordingly.
 */
export const updateTransportLabels = async (
  setNodes: (updater: (nodes: any[]) => any[]) => void,
  setEdges: (updater: (edges: any[]) => any[]) => void,
  pattern?: string,
  isStreaming?: boolean,
): Promise<void> => {
  // Travel agent doesn't use group communication
  if (isGroupCommunication(pattern)) {
    return
  }

  try {
    const response = await fetch(
      `${getApiUrlForPattern(pattern)}/transport/config`,
    )
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const data = await response.json()
    const transport = data.transport

    const transportUrls = isStreaming
      ? urlsConfig.github.transports.streaming
      : urlsConfig.github.transports.regular

    // Update transport node label
    setNodes((nodes: any[]) =>
      nodes.map((node: any) =>
        node.id === NODE_IDS.TRANSPORT
          ? {
              ...node,
              data: {
                ...node.data,
                label: `Transport: ${transport}`,
                githubLink:
                  transport === "SLIM"
                    ? `${urlsConfig.github.appSdkBaseUrl}${transportUrls.slim}`
                    : transport === "NATS"
                      ? `${urlsConfig.github.appSdkBaseUrl}${transportUrls.nats}`
                      : `${urlsConfig.github.appSdkBaseUrl}${urlsConfig.github.transports.general}`,
              },
            }
          : node,
      ),
    )

    // Update edge labels (if needed)
    setEdges((edges: any[]) =>
      edges.map((edge: any) => {
        // Travel agent edges use HTTP to SerpAPI, no MCP edges
        return edge
      }),
    )
  } catch (error) {
    logger.apiError("/transport/config", error)
  }
}
