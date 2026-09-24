/**
 * Copyright AGNTCY Contributors (https://github.com/agntcy)
 * SPDX-License-Identifier: Apache-2.0
 **/

import React, { useState } from "react"
import { HelpCircle, Plane, PanelLeftClose, PanelLeft } from "lucide-react"
import ThemeToggleIcon from "../icons/ThemeToggleIcon"
import { useTheme } from "@/hooks/useTheme"
import InfoModal from "./InfoModal"

interface NavigationProps {
  onToggleSidebar?: () => void
  isSidebarOpen?: boolean
}

const Navigation: React.FC<NavigationProps> = ({
  onToggleSidebar,
  isSidebarOpen = true,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const { isLightMode, toggleTheme } = useTheme()

  const handleHelpClick = () => {
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
  }

  const handleThemeToggle = () => {
    toggleTheme()
  }

  return (
    <div className="order-0 box-border flex h-[56px] w-full flex-none flex-grow-0 flex-col items-start self-stretch p-0">
      <div
        className="order-0 box-border flex h-[56px] w-full flex-none flex-grow-0 flex-row items-center justify-between gap-2 self-stretch border-b border-emerald-400/30 px-2 py-[10px] shadow-lg sm:px-4"
        style={{
          backgroundImage:
            "linear-gradient(to right, #3ce98a, #5feb9b, #7becac, #94edbb, #abedc9)",
        }}
      >
        {/* Left - Sidebar toggle */}
        <div className="flex w-[100px] items-center">
          <button
            onClick={onToggleSidebar}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 p-2 transition-all hover:bg-white/30"
            title={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            {isSidebarOpen ? (
              <PanelLeftClose className="h-4 w-4 text-gray-800" />
            ) : (
              <PanelLeft className="h-4 w-4 text-gray-800" />
            )}
          </button>
        </div>

        {/* Center - Logo and Brand */}
        <div className="flex items-center gap-3">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-white/30 shadow-sm">
            <Plane className="h-5 w-5 text-gray-800" strokeWidth={2} />
          </div>
          <span className="text-lg font-semibold tracking-tight text-gray-800">
            Travel AGNTCY
          </span>
        </div>

        {/* Right Actions */}
        <div className="flex w-[100px] flex-row items-center justify-end gap-1">
          <button
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 p-2 transition-all hover:bg-white/30"
            title={`Switch to ${isLightMode ? "dark" : "light"} mode`}
            aria-label={`Switch to ${isLightMode ? "dark" : "light"} mode`}
            onClick={handleThemeToggle}
          >
            <ThemeToggleIcon className="h-4 w-4 text-gray-800" />
          </button>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 p-2 transition-all hover:bg-white/30"
            title="Help"
            onClick={handleHelpClick}
          >
            <HelpCircle className="h-4 w-4 text-gray-800" />
          </button>
        </div>
      </div>

      <InfoModal isOpen={isModalOpen} onClose={handleCloseModal} />
    </div>
  )
}

export default Navigation
