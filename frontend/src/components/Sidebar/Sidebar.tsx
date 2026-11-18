/**
 * Copyright AGNTCY Contributors (https://github.com/agntcy)
 * SPDX-License-Identifier: Apache-2.0
 **/

import React from "react"
import { Plus, Trash2 } from "lucide-react"
import { PatternType } from "@/utils/patternUtils"
import { ChatHistoryItem } from "@/App"

interface SidebarProps {
  selectedPattern: PatternType
  onPatternChange: (pattern: PatternType) => void
  onNewChat?: () => void
  onSelectChat?: (chatId: string) => void
  onDeleteChat?: (chatId: string) => void
  chatHistory: ChatHistoryItem[]
  currentChatId: string | null
  isOpen?: boolean
}

const Sidebar: React.FC<SidebarProps> = ({
  onNewChat,
  onSelectChat,
  onDeleteChat,
  chatHistory,
  currentChatId,
  isOpen = true,
}) => {
  const handleNewChat = () => {
    if (onNewChat) onNewChat()
  }

  const handleSelectChat = (chatId: string) => {
    if (onSelectChat) onSelectChat(chatId)
  }

  const handleDeleteChat = (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation()
    if (onDeleteChat) onDeleteChat(chatId)
  }

  // Group chats by time period
  const groupChats = () => {
    const now = new Date()
    const groups: { [key: string]: ChatHistoryItem[] } = {
      Today: [],
      Yesterday: [],
      "Previous 7 Days": [],
      "Previous 30 Days": [],
    }

    chatHistory.forEach((chat) => {
      const chatDate = new Date(chat.timestamp)
      const diffMs = now.getTime() - chatDate.getTime()
      const diffDays = Math.floor(diffMs / 86400000)

      if (diffDays === 0) groups["Today"].push(chat)
      else if (diffDays === 1) groups["Yesterday"].push(chat)
      else if (diffDays < 7) groups["Previous 7 Days"].push(chat)
      else groups["Previous 30 Days"].push(chat)
    })

    return groups
  }

  const groupedChats = groupChats()

  // Don't render if closed
  if (!isOpen) return null

  return (
    <div className="flex h-full w-[260px] flex-none flex-col bg-[#171717]">
      {/* New Chat Button - ChatGPT style */}
      <div className="p-2">
        <button
          onClick={handleNewChat}
          className="group flex w-full items-center gap-2 rounded-lg px-3 py-3 text-sm text-gray-200 transition-colors hover:bg-[#2f2f2f]"
        >
          <Plus className="h-4 w-4" />
          <span className="font-medium">New chat</span>
        </button>
      </div>

      {/* Chat History Section */}
      <nav
        aria-label="Chat history"
        className="flex-1 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent overflow-y-auto px-2"
      >
        {chatHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-xs text-gray-500">No conversation history</p>
          </div>
        ) : (
          Object.entries(groupedChats).map(
            ([period, chats]) =>
              chats.length > 0 && (
                <div key={period} className="mb-2">
                  <div className="sticky top-0 bg-[#171717] px-3 py-2">
                    <span className="text-xs font-medium text-gray-500">
                      {period}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {chats.map((chat) => (
                      <div
                        key={chat.id}
                        className={`group relative flex w-full items-center rounded-lg px-3 py-2 text-left transition-colors ${
                          currentChatId === chat.id
                            ? "bg-[#2f2f2f]"
                            : "hover:bg-[#2f2f2f]/50"
                        }`}
                      >
                        <button
                          onClick={() => handleSelectChat(chat.id)}
                          className="min-w-0 flex-1 truncate pr-6 text-left text-sm text-gray-300"
                        >
                          {chat.title}
                        </button>

                        <button
                          aria-label={`Delete chat: ${chat.title}`}
                          onClick={(e) => handleDeleteChat(e, chat.id)}
                          className={`absolute right-2 rounded p-1 text-gray-400 hover:bg-[#404040] hover:text-red-400 focus-visible:outline-2 focus-visible:outline-emerald-300 ${currentChatId === chat.id ? "" : "group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0"}`}
                        >
                          <Trash2 aria-hidden="true" className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ),
          )
        )}
      </nav>
    </div>
  )
}

export default Sidebar
