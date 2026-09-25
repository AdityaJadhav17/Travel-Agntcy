export interface BudgetAssessment {
  status: "within" | "over" | "unknown"
  currency: "USD"
  limit: number
  quoted_total: number | null
  scope: string
  message: string
}
