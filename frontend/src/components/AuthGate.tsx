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
          "That access key did not unlock the app. Check your local setup instructions and try again.",
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
            className="fixed right-4 bottom-4 z-[100] max-w-sm rounded-lg border border-amber-300/40 bg-[#292929] px-4 py-3 text-sm text-amber-100 shadow-xl"
          >
            {error}
          </p>
        )}
      </>
    )

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#212121] px-4 text-white">
      <section className="w-full max-w-md rounded-2xl border border-gray-700 bg-[#292929] p-7 shadow-xl">
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300">
          <KeyRound aria-hidden="true" className="h-5 w-5" />
        </div>
        <h1 className="text-2xl font-semibold">Unlock Travel AGNTCY</h1>
        {state === "checking" ? (
          <p role="status" className="mt-3 text-sm text-gray-300">
            Checking local app access…
          </p>
        ) : state === "unavailable" ? (
          <div className="mt-3 space-y-4">
            <p role="alert" className="text-sm text-amber-200">
              {error}
            </p>
            <button
              type="button"
              onClick={retryStatus}
              className="rounded-lg bg-emerald-400 px-4 py-2 font-medium text-gray-950 hover:bg-emerald-300"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm leading-6 text-gray-300">
              Enter the local app access key from your setup instructions. This
              is separate from provider API keys.
            </p>
            <form className="mt-5 space-y-4" onSubmit={handleLogin}>
              <label
                htmlFor="local-access-key"
                className="block text-sm font-medium text-gray-200"
              >
                Local access key
              </label>
              <input
                id="local-access-key"
                type="password"
                autoComplete="current-password"
                required
                value={accessKey}
                onChange={(event) => setAccessKey(event.target.value)}
                className="w-full rounded-lg border border-gray-600 bg-[#1f1f1f] px-3 py-2.5 text-white outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-300/30"
              />
              {error && (
                <p role="alert" className="text-sm text-amber-200">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={busy || !accessKey}
                className="w-full rounded-lg bg-emerald-400 px-4 py-2.5 font-semibold text-gray-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
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
