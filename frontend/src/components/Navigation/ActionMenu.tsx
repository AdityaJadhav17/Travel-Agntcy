import { useEffect, useId, useRef, useState, type ReactNode } from "react"

export interface Action {
  label: string
  icon?: ReactNode
  onSelect: () => void
  destructive?: boolean
}

export default function ActionMenu({
  label,
  icon,
  actions,
  buttonClassName,
  panelClassName,
}: {
  label: string
  icon: ReactNode
  actions: Action[]
  buttonClassName: string
  panelClassName: string
}) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const initialItem = useRef(0)
  const menuId = useId()

  const getItems = () =>
    Array.from(
      container.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      ) ?? [],
    )

  useEffect(() => {
    if (!open) return
    getItems()[initialItem.current]?.focus()
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !container.current?.contains(event.target)
      )
        setOpen(false)
    }
    document.addEventListener("pointerdown", dismiss)
    return () => document.removeEventListener("pointerdown", dismiss)
  }, [open])

  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }

  return (
    <div
      ref={container}
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault()
          event.stopPropagation()
          close()
          return
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
        if (!open && event.key !== "ArrowDown" && event.key !== "ArrowUp")
          return
        event.preventDefault()
        if (!open) {
          initialItem.current = event.key === "ArrowUp" ? actions.length - 1 : 0
          setOpen(true)
          return
        }
        const items = getItems()
        const active = items.indexOf(
          document.activeElement as HTMLButtonElement,
        )
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : event.key === "ArrowUp"
                ? (active - 1 + items.length) % items.length
                : (active + 1) % items.length
        items[next]?.focus()
      }}
    >
      <button
        type="button"
        ref={trigger}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={buttonClassName}
        onClick={() => {
          if (open) close()
          else {
            initialItem.current = 0
            setOpen(true)
          }
        }}
      >
        {icon}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className={panelClassName}
        >
          {actions.map(
            ({
              label: actionLabel,
              icon: actionIcon,
              onSelect,
              destructive,
            }) => (
              <button
                key={actionLabel}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={`flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-travel-selected focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-travel-accent ${destructive ? "text-travel-warning" : "text-travel-text"}`}
                onClick={() => {
                  close()
                  onSelect()
                }}
              >
                {actionIcon}
                {actionLabel}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
