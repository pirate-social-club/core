export const GENERIC_STORY_ASSET_KINDS = [
  "song_audio",
  "video_file",
  "download_file",
  "learning_deck",
] as const

export function constraintAdmitsGenericStoryAssetKinds(definition: string): boolean {
  const values = [...definition.matchAll(/'([^']+)'/g)].map((match) => match[1])
  const actual = new Set(values)
  return actual.size === GENERIC_STORY_ASSET_KINDS.length
    && GENERIC_STORY_ASSET_KINDS.every((kind) => actual.has(kind))
}
