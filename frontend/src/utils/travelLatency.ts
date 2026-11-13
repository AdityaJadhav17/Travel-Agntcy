/** Local-only, bounded diagnostics for browser travel request latency. */
export type TravelLatencyOutcome = "success" | "error" | "cancelled"

export interface TravelLatencyMeasurement {
  measurementId: string
  backendTimingId?: string
  firstUsefulCardMs?: number
  finalResponseRenderedMs?: number
  terminalReceivedMs?: number
  endedMs?: number
  outcome?: TravelLatencyOutcome
  renderExcluded?: boolean
}

interface InternalMeasurement {
  publicRecord: TravelLatencyMeasurement
  startedAt: number
}

const MAX_MEASUREMENTS = 100
const measurements: InternalMeasurement[] = []
const byId = new Map<string, InternalMeasurement>()

function exposeDiagnostics() {
  if (typeof window === "undefined") return
  const target = window as Window & {
    __travelLatency?: {
      getMeasurements: () => TravelLatencyMeasurement[]
      clear: () => void
      print: () => void
      summary: () => Record<
        string,
        {
          count: number
          medianMs: number | null
          minMs: number | null
          maxMs: number | null
        }
      >
    }
  }
  if (target.__travelLatency) return
  target.__travelLatency = {
    getMeasurements: () =>
      measurements.map(({ publicRecord }) => ({ ...publicRecord })),
    clear: () => {
      measurements.splice(0, measurements.length)
      byId.clear()
    },
    print: () =>
      console.table(
        measurements.map(({ publicRecord }) => ({ ...publicRecord })),
      ),
    summary: () => {
      const summarize = (
        key:
          | "firstUsefulCardMs"
          | "finalResponseRenderedMs"
          | "terminalReceivedMs",
      ) => {
        const values = measurements
          .map(({ publicRecord }) => publicRecord)
          .filter((item) => item.outcome === "success" && !item.renderExcluded)
          .map((item) => item[key])
          .filter(
            (value): value is number =>
              typeof value === "number" && Number.isFinite(value),
          )
          .sort((a, b) => a - b)
        const middle = Math.floor(values.length / 2)
        const medianMs = values.length
          ? values.length % 2
            ? values[middle]
            : (values[middle - 1] + values[middle]) / 2
          : null
        return {
          count: values.length,
          medianMs,
          minMs: values[0] ?? null,
          maxMs: values.at(-1) ?? null,
        }
      }
      return {
        firstUsefulCardMs: summarize("firstUsefulCardMs"),
        finalResponseRenderedMs: summarize("finalResponseRenderedMs"),
        terminalReceivedMs: summarize("terminalReceivedMs"),
      }
    },
  }
}

exposeDiagnostics()

export function startTravelMeasurement(): string {
  exposeDiagnostics()
  const measurementId = crypto.randomUUID()
  const item: InternalMeasurement = {
    publicRecord: { measurementId },
    startedAt: performance.now(),
  }
  measurements.push(item)
  byId.set(measurementId, item)
  while (measurements.length > MAX_MEASUREMENTS) {
    const removed = measurements.shift()
    if (removed) byId.delete(removed.publicRecord.measurementId)
  }
  return measurementId
}

function update(id: string, action: (item: InternalMeasurement) => void) {
  const item = byId.get(id)
  if (item) action(item)
}

export function setTravelBackendTimingId(
  id: string,
  backendTimingId: string | null,
) {
  if (!backendTimingId || !/^[A-Za-z0-9_-]{1,128}$/.test(backendTimingId))
    return
  update(id, (item) => {
    item.publicRecord.backendTimingId = backendTimingId
  })
}

export function markFirstUsefulTravelCard(id: string) {
  update(id, (item) => {
    if (item.publicRecord.firstUsefulCardMs === undefined)
      item.publicRecord.firstUsefulCardMs = performance.now() - item.startedAt
  })
}

export function finishTravelMeasurement(
  id: string,
  outcome: TravelLatencyOutcome,
) {
  update(id, (item) => {
    if (item.publicRecord.outcome) return
    const elapsed = performance.now() - item.startedAt
    item.publicRecord.endedMs = elapsed
    if (outcome === "success") item.publicRecord.terminalReceivedMs = elapsed
    item.publicRecord.outcome = outcome
  })
}

export function markFinalTravelResponseRendered(id: string) {
  update(id, (item) => {
    if (item.publicRecord.finalResponseRenderedMs === undefined)
      item.publicRecord.finalResponseRenderedMs =
        performance.now() - item.startedAt
  })
}

export function excludeTravelRenderMeasurement(id: string) {
  update(id, (item) => {
    if (item.publicRecord.finalResponseRenderedMs === undefined)
      item.publicRecord.renderExcluded = true
  })
}
