import { describe, expect, test } from "bun:test"
import { parse } from "yaml"

const schemasPath = new URL("../src/components/schemas/song-study.yaml", import.meta.url)
const pathsPath = new URL("../src/paths/song-study.yaml", import.meta.url)

describe("Song Study orchestration v2 contract", () => {
  test("keeps revision additive while making orchestration authoritative on results", async () => {
    const schemas = parse(await Bun.file(schemasPath).text())
    const request = schemas.SongStudyAttemptRequest
    const result = schemas.SongStudyAttemptResult

    expect(request.required).not.toContain("session_revision")
    expect(request.properties.session_revision).toMatchObject({ type: "integer", minimum: 0 })
    expect(result.required).not.toContain("lesson")
    expect(result.properties.lesson).toBeDefined()
    expect(result.properties.outcome.enum).toContain("ungradable")
    expect(result.properties.lesson.$ref).toBe("#/components/schemas/SongStudyLessonState")
  })

  test("exposes one render-safe lesson projection for attempts, GET, and conflicts", async () => {
    const schemas = parse(await Bun.file(schemasPath).text())
    const lesson = schemas.SongStudyLessonState
    const next = schemas.SongStudyLessonNext

    expect(lesson.required).toEqual([
      "session_revision",
      "resolved_count",
      "total_count",
      "completion_reason",
      "serving_index",
      "next",
    ])
    expect(lesson.properties.completion_reason.enum).toEqual([
      "all_resolved",
      "presentation_budget",
    ])
    expect(next.properties.prompt.$ref).toBe(
      "#/components/schemas/SongStudyRenderSafeExercise",
    )
    expect(schemas.SongStudyPayload.properties.lesson.$ref).toBe(
      "#/components/schemas/SongStudyLessonState",
    )
    expect(schemas.SongStudyRevisionConflict.properties.retryable.enum).toEqual([false])
    expect(schemas.SongStudyRevisionConflict.properties.details.properties.lesson.$ref).toBe(
      "#/components/schemas/SongStudyLessonState",
    )
    expect(schemas.SongStudyRenderSafeExercise.allOf).toEqual([
      { $ref: "#/components/schemas/SongStudyExercise" },
    ])
    expect(JSON.stringify(schemas.SongStudyExercise)).not.toContain("correct_option_id")
    expect(JSON.stringify(schemas.SongStudyExercise)).not.toContain("explanation_text")
  })

  test("publishes the typed stale-revision response", async () => {
    const paths = parse(await Bun.file(pathsPath).text())
    const response = paths.communities_by_community_id_posts_by_post_id_study_attempts
      .post.responses["409"]
    expect(response.content["application/json"].schema.$ref).toBe(
      "../components/schemas/song-study.yaml#/SongStudyRevisionConflict",
    )
  })
})
