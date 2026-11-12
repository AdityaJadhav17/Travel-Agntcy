export const AUTH_EXPIRED_EVENT = "travel-auth-expired"

export const signalAuthExpired = () => {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
}
