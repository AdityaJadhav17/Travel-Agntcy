/**
 * Copyright AGNTCY Contributors (https://github.com/agntcy)
 * SPDX-License-Identifier: Apache-2.0
 **/

import { useRef, useState, type ReactNode, type Ref } from "react"
import {
  Ellipsis,
  HelpCircle,
  LogOut,
  Plane,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react"
import ThemeToggleIcon from "../icons/ThemeToggleIcon"
import { useTheme } from "@/hooks/useTheme"
import ActionMenu from "./ActionMenu"
import InfoModal from "./InfoModal"

const toolbarButton =
  "flex size-11 shrink-0 items-center justify-center rounded-md text-travel-muted hover:bg-travel-selected hover:text-travel-text focus-visible:outline-2 focus-visible:outline-travel-accent"

export default function Navigation({
  onToggleSidebar,
  isSidebarOpen,
  isMobile,
  sidebarToggle,
  onLogout,
  agentGraph,
}: {
  onToggleSidebar: () => void
  isSidebarOpen: boolean
  isMobile: boolean
  sidebarToggle: Ref<HTMLButtonElement>
  onLogout: () => Promise<void>
  agentGraph: ReactNode
}) {
  const [helpOpen, setHelpOpen] = useState(false)
  const helpButton = useRef<HTMLButtonElement>(null)
  const { isLightMode, toggleTheme } = useTheme()
  const sidebarLabel = isSidebarOpen ? "Close sidebar" : "Open sidebar"
  const themeLabel = `Switch to ${isLightMode ? "dark" : "light"} mode`

  return (
    <>
      <header className="relative z-30 flex h-14 w-full flex-none items-center justify-between gap-2 border-b border-travel-border bg-travel-surface px-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <button
            type="button"
            ref={sidebarToggle}
            onClick={onToggleSidebar}
            className={toolbarButton}
            aria-label={sidebarLabel}
            aria-expanded={isSidebarOpen}
            aria-haspopup={isMobile ? "dialog" : undefined}
            aria-controls={isSidebarOpen ? "trip-sidebar" : undefined}
            title={sidebarLabel}
          >
            {isSidebarOpen ? (
              <PanelLeftClose aria-hidden="true" className="size-4" />
            ) : (
              <PanelLeft aria-hidden="true" className="size-4" />
            )}
          </button>
          <Plane
            aria-hidden="true"
            className="size-4 shrink-0 text-travel-accent"
          />
          <span className="truncate text-sm font-semibold text-travel-text">
            Travel AGNTCY
          </span>
        </div>

        <div className="flex shrink-0 items-center">
          <button
            type="button"
            className={toolbarButton}
            title={themeLabel}
            aria-label={themeLabel}
            onClick={toggleTheme}
          >
            <ThemeToggleIcon className="size-4" />
          </button>
          <button
            type="button"
            ref={helpButton}
            className={toolbarButton}
            aria-label="Help"
            aria-haspopup="dialog"
            title="Help"
            onClick={() => setHelpOpen(true)}
          >
            <HelpCircle aria-hidden="true" className="size-4" />
          </button>
          <ActionMenu
            label="Utilities"
            icon={<Ellipsis aria-hidden="true" className="size-4" />}
            buttonClassName={toolbarButton}
            panelClassName="absolute top-full right-0 min-w-36 rounded-lg border border-travel-border bg-travel-raised p-1 shadow-lg"
            actions={[
              {
                label: "Sign out",
                icon: <LogOut aria-hidden="true" className="size-4" />,
                onSelect: () => void onLogout(),
              },
            ]}
          />
        </div>
      </header>
      {helpOpen && (
        <InfoModal
          onClose={() => {
            setHelpOpen(false)
            helpButton.current?.focus()
          }}
          agentGraph={agentGraph}
        />
      )}
    </>
  )
}
