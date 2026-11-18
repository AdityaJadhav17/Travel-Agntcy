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
  onLogout?: () => Promise<void>
}

const toolbarButton =
  "flex size-11 shrink-0 items-center justify-center rounded-md text-gray-300 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-emerald-300"

const Navigation: React.FC<NavigationProps> = ({
  onToggleSidebar,
  isSidebarOpen = true,
  onLogout,
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
    <>
      <header className="flex h-14 w-full flex-none items-center justify-between gap-2 border-b border-white/10 bg-[#171717] px-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={onToggleSidebar}
            className={toolbarButton}
            aria-label={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
            aria-expanded={isSidebarOpen}
            title={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            {isSidebarOpen ? (
              <PanelLeftClose aria-hidden="true" className="size-4" />
            ) : (
              <PanelLeft aria-hidden="true" className="size-4" />
            )}
          </button>
          <Plane
            aria-hidden="true"
            className="size-4 shrink-0 text-[#3ce98a]"
          />
          <span className="truncate text-sm font-semibold text-white">
            Travel AGNTCY
          </span>
        </div>

        <div className="flex shrink-0 items-center">
          {onLogout && (
            <button
              type="button"
              onClick={() => void onLogout()}
              className="min-h-11 rounded-md px-2 text-xs font-medium text-gray-300 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-emerald-300 sm:px-3 sm:text-sm"
            >
              Sign out
            </button>
          )}
          <button
            type="button"
            className={toolbarButton}
            title={`Switch to ${isLightMode ? "dark" : "light"} mode`}
            aria-label={`Switch to ${isLightMode ? "dark" : "light"} mode`}
            onClick={handleThemeToggle}
          >
            <ThemeToggleIcon className="size-4" />
          </button>
          <button
            type="button"
            className={toolbarButton}
            aria-label="Help"
            title="Help"
            onClick={handleHelpClick}
          >
            <HelpCircle aria-hidden="true" className="size-4" />
          </button>
        </div>
      </header>

      <InfoModal isOpen={isModalOpen} onClose={handleCloseModal} />
    </>
  )
}

export default Navigation
