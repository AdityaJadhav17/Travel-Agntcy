import { expect, type Page, type Response } from "@playwright/test"

/** Observe consumed wire bytes, not Chromium's response-body cache (which is
 * discarded on reader cancellation). The transform preserves streaming and
 * propagates cancellation upstream; it neither clones nor replays requests.
 */
export async function observeTravelStreams(page: Page) {
  await page.addInitScript(() => {
    const target = window as typeof window & {
      travelStreamBytes: Record<string, string>
    }
    target.travelStreamBytes = {}
    const original = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const response = await original(input, init)
      if (!String(input).endsWith("/agent/prompt/stream") || !response.body)
        return response
      const { request_id: id } = JSON.parse(String(init?.body))
      const decoder = new TextDecoder()
      target.travelStreamBytes[id] = ""
      const body = response.body.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            target.travelStreamBytes[id] += decoder.decode(chunk, {
              stream: true,
            })
            controller.enqueue(chunk)
          },
          flush() {
            target.travelStreamBytes[id] += decoder.decode()
          },
        }),
      )
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }
  })
}

export async function observedStreamResult(page: Page, response: Response) {
  const id = response.request().postDataJSON().request_id
  const handle = await page.waitForFunction((requestId) => {
    const target = window as typeof window & {
      travelStreamBytes: Record<string, string>
    }
    const lines = (target.travelStreamBytes[requestId] || "").split("\n")
    for (const line of lines) {
      try {
        const event = JSON.parse(line)
        if (event.type === "done") return event
        if (event.type === "error" && event.component === "request")
          return event
      } catch {
        /* Wait for the rest of this line. */
      }
    }
    return null
  }, id)
  const event = await handle.jsonValue()
  expect(event.type, JSON.stringify(event)).toBe("done")
  return event.result
}
