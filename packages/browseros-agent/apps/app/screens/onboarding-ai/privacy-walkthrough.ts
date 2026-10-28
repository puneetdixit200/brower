/** Sequential acknowledgement state for the first-run privacy walkthrough. */
export function advancePrivacyWalkthrough(
  currentStep: number,
  stepCount: number,
): number {
  if (!Number.isInteger(stepCount) || stepCount < 0) return 0
  if (!Number.isInteger(currentStep) || currentStep < 0) return 0
  return Math.min(currentStep + 1, stepCount)
}

export function canShowProviderSetup(
  acknowledgedSteps: number,
  stepCount: number,
): boolean {
  return (
    Number.isInteger(stepCount) &&
    stepCount > 0 &&
    Number.isInteger(acknowledgedSteps) &&
    acknowledgedSteps >= stepCount
  )
}
