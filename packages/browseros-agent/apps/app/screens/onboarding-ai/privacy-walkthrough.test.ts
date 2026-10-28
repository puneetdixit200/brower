import { describe, expect, it } from 'bun:test'
import {
  advancePrivacyWalkthrough,
  canShowProviderSetup,
} from './privacy-walkthrough'

describe('first-run privacy walkthrough', () => {
  it('keeps provider setup hidden until every checkpoint is acknowledged', () => {
    const checkpointCount = 4
    let acknowledged = 0

    expect(canShowProviderSetup(acknowledged, checkpointCount)).toBe(false)
    while (acknowledged < checkpointCount) {
      acknowledged = advancePrivacyWalkthrough(acknowledged, checkpointCount)
      expect(canShowProviderSetup(acknowledged, checkpointCount)).toBe(
        acknowledged === checkpointCount,
      )
    }
  })

  it('advances one checkpoint at a time and stops on the final continue action', () => {
    expect(advancePrivacyWalkthrough(0, 4)).toBe(1)
    expect(advancePrivacyWalkthrough(2, 4)).toBe(3)
    expect(advancePrivacyWalkthrough(3, 4)).toBe(4)
    expect(advancePrivacyWalkthrough(4, 4)).toBe(4)
    expect(canShowProviderSetup(4, 4)).toBe(true)
  })

  it('fails closed for invalid or empty walkthrough counts', () => {
    expect(canShowProviderSetup(0, 0)).toBe(false)
    expect(canShowProviderSetup(4, Number.NaN)).toBe(false)
    expect(advancePrivacyWalkthrough(-1, 4)).toBe(0)
  })
})
