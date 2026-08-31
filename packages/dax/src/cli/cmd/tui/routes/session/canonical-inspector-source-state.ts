export function shouldApplyCanonicalRefresh(input: {
  requestEpoch: number
  currentEpoch: number
  requestedRunId: string
  currentRunId: string
}) {
  return input.requestEpoch === input.currentEpoch && input.requestedRunId === input.currentRunId
}
