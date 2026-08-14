import { describe, expect, test } from "bun:test"

const fixtureUrl = new URL("../compatibility/fsrs-6-v1.json", import.meta.url)

type FsrsFixture = {
  algorithm: string
  parameters_version: number
  formula: string
  upstream: {
    repository: string
    commit: string
    release_provenance: string
  }
  runtime: {
    package: string
    version: string
    dependency_lock_policy: string
  }
  parameters: {
    weights: number[]
    request_retention: number
    maximum_interval_days: number
    learning_steps: string[]
    relearning_steps: string[]
    enable_short_term: boolean
    enable_fuzz: boolean
  }
  time_units: Record<string, string>
  rounding_rules: Record<string, string>
  reference_vectors: {
    interval_days: { ratings: string[]; expected: number[] }
    memory_state: {
      ratings: string[]
      elapsed_days: number[]
      expected_stability: number
      expected_difficulty: number
      absolute_tolerance: number
    }
  }
}

describe("FSRS-6 scheduler fixture", () => {
  test("pins the algorithm, provenance, and exact runtime dependency", async () => {
    const fixture = (await Bun.file(fixtureUrl).json()) as FsrsFixture
    expect(fixture.algorithm).toBe("fsrs_6_v1")
    expect(fixture.parameters_version).toBe(1)
    expect(fixture.formula).toBe("FSRS-6")
    expect(fixture.upstream.repository).toBe(
      "https://github.com/open-spaced-repetition/ts-fsrs",
    )
    expect(fixture.upstream.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(fixture.runtime).toEqual({
      package: "ts-fsrs",
      version: "6.0.0-beta.2",
      dependency_lock_policy: "exact",
    })
  })

  test("pins every scheduler parameter and unit/rounding rule", async () => {
    const fixture = (await Bun.file(fixtureUrl).json()) as FsrsFixture
    expect(fixture.parameters.weights).toEqual([
      0.212,
      1.2931,
      2.3065,
      8.2956,
      6.4133,
      0.8334,
      3.0194,
      0.001,
      1.8722,
      0.1666,
      0.796,
      1.4835,
      0.0614,
      0.2629,
      1.6483,
      0.6014,
      1.8729,
      0.5425,
      0.0912,
      0.0658,
      0.1542,
    ])
    expect(fixture.parameters.request_retention).toBe(0.9)
    expect(fixture.parameters.maximum_interval_days).toBe(36500)
    expect(fixture.parameters.learning_steps).toEqual(["1m", "10m"])
    expect(fixture.parameters.relearning_steps).toEqual(["10m"])
    expect(fixture.parameters.enable_short_term).toBe(true)
    expect(fixture.parameters.enable_fuzz).toBe(false)
    expect(fixture.time_units).toEqual({
      review_timestamp: "milliseconds since Unix epoch UTC",
      elapsed_time: "fractional days",
      learning_steps: "minutes",
      scheduled_interval: "days",
    })
    expect(fixture.rounding_rules).toEqual({
      formula_intermediates: "Math.round(value * 1e8) / 1e8",
      review_interval_days: "Math.round(candidate_days), clamped to [1, maximum_interval_days]",
      learning_step_minutes: "Math.round(candidate_minutes)",
      multi_day_learning_interval: "Math.floor(scheduled_minutes / 1440)",
      fuzz: "disabled",
    })
  })

  test("contains the accepted deterministic reference vectors", async () => {
    const fixture = (await Bun.file(fixtureUrl).json()) as FsrsFixture
    expect(fixture.reference_vectors.interval_days.ratings).toHaveLength(13)
    expect(fixture.reference_vectors.interval_days.expected).toEqual([
      0, 2, 11, 46, 163, 498, 0, 0, 2, 4, 7, 12, 21,
    ])
    expect(fixture.reference_vectors.memory_state.ratings).toEqual([
      "again",
      "good",
      "good",
      "good",
      "good",
      "good",
    ])
    expect(fixture.reference_vectors.memory_state.elapsed_days).toEqual([0, 0, 1, 3, 8, 21])
    expect(fixture.reference_vectors.memory_state.expected_stability).toBe(53.62691)
    expect(fixture.reference_vectors.memory_state.expected_difficulty).toBe(6.3574867)
    expect(fixture.reference_vectors.memory_state.absolute_tolerance).toBe(0.0001)
  })
})
