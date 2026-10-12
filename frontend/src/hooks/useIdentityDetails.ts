import { useEffect, useState } from "react"
import type { CustomNodeData } from "@/components/MainArea/Graph/Elements/types"

export function useIdentityDetails<T>(
  nodeData: CustomNodeData,
  fetchDetails: (nodeData: CustomNodeData) => Promise<T>,
  fallbackError: string,
) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{
    nodeData: CustomNodeData
    attempt: number
    data?: T
    error?: string
  } | null>(null)

  useEffect(() => {
    let active = true
    void fetchDetails(nodeData).then(
      (data) => {
        if (active) setResult({ nodeData, attempt, data })
      },
      (error: unknown) => {
        if (active) {
          setResult({
            nodeData,
            attempt,
            error:
              typeof error === "object" &&
              error !== null &&
              "message" in error &&
              typeof error.message === "string" &&
              error.message
                ? error.message
                : fallbackError,
          })
        }
      },
    )
    return () => {
      active = false
    }
  }, [nodeData, fetchDetails, attempt, fallbackError])

  const current =
    result?.nodeData === nodeData && result.attempt === attempt ? result : null
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: current === null,
    retry: () => setAttempt((previous) => previous + 1),
  }
}
