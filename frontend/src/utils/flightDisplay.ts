export const formatFare = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
}).format

export function flightStops(count: number) {
  return count === 0 ? "Nonstop" : `${count} ${count === 1 ? "stop" : "stops"}`
}
