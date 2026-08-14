import { describe, expect, test } from "bun:test";
import {
  constraintAdmitsGenericStoryAssetKinds,
  GENERIC_STORY_ASSET_KINDS,
} from "./control-plane-generic-story-asset-kinds";

describe("generic Story asset-kind control-plane verifier", () => {
  test("accepts the complete live constraint definition", () => {
    expect(constraintAdmitsGenericStoryAssetKinds(
      "CHECK ((asset_kind = ANY (ARRAY['song_audio'::text, 'video_file'::text, 'download_file'::text, 'learning_deck'::text])))",
    )).toBe(true);
  });

  test("fails closed when either generic kind is absent", () => {
    expect(constraintAdmitsGenericStoryAssetKinds(
      "CHECK (asset_kind IN ('song_audio', 'video_file', 'download_file'))",
    )).toBe(false);
  });

  test("keeps the expected registry explicit", () => {
    expect(GENERIC_STORY_ASSET_KINDS).toEqual([
      "song_audio",
      "video_file",
      "download_file",
      "learning_deck",
    ]);
  });
});
