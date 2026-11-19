import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import { KeyRound } from "lucide-react"
import { getApiUrlForPattern, PATTERNS } from "@/utils/patternUtils"
import { AUTH_EXPIRED_EVENT } from "@/utils/authSession"

type AuthGateProps = {
  children: (logout: () => Promise<void>) => ReactNode
}

type GateState = "checking" | "locked" | "unavailable" | "unlocked"

const authUrl = `${getApiUrlForPattern(PATTERNS.TRAVEL_SEARCH)}/auth`

export default function AuthGate({ children }: AuthGateProps) {
  const [state, setState] = useState<GateState>("checking")
  const [refresh, setRefresh] = useState(0)
  const [accessKey, setAccessKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    fetch(`${authUrl}/status`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("status")
        const body: unknown = await response.json()
        if (
          !body ||
          typeof body !== "object" ||
          typeof (body as { authenticated?: unknown }).authenticated !==
            "boolean"
        )
          throw new Error("status")
        if (active)
          setState(
            (body as { authenticated: boolean }).authenticated
              ? "unlocked"
              : "locked",
          )
      })
      .catch(() => {
        if (active) {
          setState("unavailable")
          setError(
            "Could not check access with the travel service. Check that it is running, then try again.",
          )
        }
      })
    return () => {
      active = false
    }
  }, [refresh])

  useEffect(() => {
    const relock = () => {
      setAccessKey("")
      setError("Your session expired. Unlock the app again to continue.")
      setState("locked")
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, relock)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, relock)
  }, [])

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!accessKey || busy) return
    setBusy(true)
    setError("")
    try {
      const response = await fetch(`${authUrl}/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_key: accessKey }),
      })
      if (response.status === 401) {
        setError(
          "That key did not unlock the app. Check the local access key and try again.",
        )
        return
      }
      if (response.status === 429) {
        setError("Too many attempts. Wait a little while before trying again.")
        return
      }
      if (response.status === 503) {
        setError(
          "Access is temporarily paused. Check the local service and try again later.",
        )
        return
      }
      if (!response.ok) throw new Error("login")
      setAccessKey("")
      setState("unlocked")
    } catch {
      setError(
        "Could not reach the travel service. Check that it is running, then try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  const logout = useCallback(async () => {
    setError("")
    try {
      const response = await fetch(`${authUrl}/logout`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      if (!response.ok) {
        if (response.status === 401) {
          setState("locked")
          return
        }
        if (response.status === 503) {
          setError("Access is temporarily paused. Try signing out again later.")
          return
        }
        throw new Error("logout")
      }
      setState("locked")
    } catch {
      setError(
        "Could not reach the travel service to sign out. Try again when it is available.",
      )
    }
  }, [])

  const retryStatus = () => {
    setError("")
    setState("checking")
    setRefresh((value) => value + 1)
  }

  if (state === "unlocked")
    return (
      <>
        {children(logout)}
        {error && (
          <p
            role="status"
            className="travel-ui fixed right-4 bottom-4 z-[100] max-w-sm rounded-lg border border-travel-warning-border bg-travel-warning-soft px-4 py-3 text-sm text-travel-warning shadow-xl"
          >
            {error}
          </p>
        )}
      </>
    )

  return (
    <main className="travel-ui flex min-h-dvh items-center justify-center bg-travel-canvas px-4 py-8 text-travel-text">
      <section className="w-full max-w-md rounded-2xl border border-travel-border bg-travel-surface p-6 sm:p-8">
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-travel-accent-soft text-travel-accent">
          <KeyRound aria-hidden="true" className="h-5 w-5" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Unlock Travel AGNTCY
        </h1>
        {state === "checking" ? (
          <p role="status" className="mt-3 text-sm text-travel-muted">
            Checking local app access…
          </p>
        ) : state === "unavailable" ? (
          <div className="mt-3 space-y-4">
            <p role="alert" className="text-sm text-travel-warning">
              {error}
            </p>
            <button
              type="button"
              onClick={retryStatus}
              className="min-h-11 rounded-lg bg-travel-accent px-4 py-2 font-medium text-travel-on-accent hover:bg-travel-accent-hover"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <form className="mt-5 space-y-4" onSubmit={handleLogin}>
              <label
                htmlFor="local-access-key"
                className="block text-sm font-medium"
              >
                Local access key
              </label>
              <input
                id="local-access-key"
                type="password"
                autoComplete="current-password"
                aria-describedby="local-access-help"
                required
                value={accessKey}
                onChange={(event) => setAccessKey(event.target.value)}
                className="w-full rounded-lg border border-travel-control bg-travel-canvas px-3 py-2.5"
              />
              <p
                id="local-access-help"
                className="text-sm leading-6 text-travel-muted"
              >
                Local setup saves the key in{" "}
                <code>.runtime/local-access-key.txt</code>. You can also find it
                as <code>TRAVEL_ACCESS_KEY</code> in the project’s{" "}
                <code>.env</code> file. Keep provider API keys separate.
              </p>
              {error && (
                <p role="alert" className="text-sm text-travel-warning">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={busy || !accessKey}
                className="min-h-11 w-full rounded-lg bg-travel-accent px-4 py-2.5 font-semibold text-travel-on-accent enabled:hover:bg-travel-accent-hover disabled:cursor-not-allowed disabled:bg-travel-raised disabled:text-travel-muted"
              >
                {busy ? "Unlocking…" : "Unlock app"}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  )
}
