import type { AuthBootstrapStore } from "./db";
import { createId } from "./ids";
import { parseRedditSnapshotPayload, type RedditSnapshotPayload } from "./reddit-onboarding";
import { nowIso } from "./time";
import type { Env } from "../types/env";

const FEATURE_VERSION = "reddit_deterministic_v1";

type DerivedSubredditStat = {
  subreddit: string;
  post_count: number;
  comment_count: number;
  post_score: number;
  comment_score: number;
  total_score: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  weight: number;
};

type TaxonomyRule = {
  tag: string;
  segment_key: string;
  matches: Set<string>;
  aliases?: Set<string>;
};

const TAXONOMY_RULES: TaxonomyRule[] = [
  {
    tag: "electronic music",
    segment_key: "aud_music_production",
    matches: new Set([
      "electronicmusic",
      "ableton",
      "synthesizers",
      "musicproduction",
      "edmproduction",
      "techno",
      "house",
      "djsetups",
    ]),
    aliases: new Set(["electronic", "music production"]),
  },
  {
    tag: "design",
    segment_key: "aud_design_tools",
    matches: new Set(["design", "graphic_design", "web_design", "uxdesign", "userexperience", "typography"]),
  },
  {
    tag: "technology",
    segment_key: "aud_dev_tools",
    matches: new Set([
      "technology",
      "programming",
      "webdev",
      "javascript",
      "typescript",
      "reactjs",
      "linux",
      "golang",
      "python",
      "rust",
    ]),
  },
  {
    tag: "crypto",
    segment_key: "aud_crypto_native",
    matches: new Set(["cryptocurrency", "bitcoin", "ethereum", "ethdev", "solana", "defi", "nft"]),
  },
  {
    tag: "pets",
    segment_key: "aud_pet_owners",
    matches: new Set(["cats", "dogs", "pets", "catadvice", "dogtraining"]),
    aliases: new Set(["cats", "dogs"]),
  },
  {
    tag: "gaming",
    segment_key: "aud_gaming",
    matches: new Set(["gaming", "pcgaming", "games", "steam", "nintendo", "playstation", "xbox"]),
  },
  {
    tag: "fitness",
    segment_key: "aud_fitness",
    matches: new Set(["fitness", "bodyweightfitness", "running", "weightlifting", "nutrition"]),
  },
  {
    tag: "photography",
    segment_key: "aud_photography",
    matches: new Set(["photography", "analog", "filmmakers", "cinematography"]),
  },
];

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeSubreddit(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().replace(/^r\//i, "").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function parseSnapshotSubredditStats(payload: RedditSnapshotPayload): DerivedSubredditStat[] {
  const bySubreddit = new Map<string, DerivedSubredditStat>();

  const subredditStats = Array.isArray(payload.subreddit_stats) ? payload.subreddit_stats : [];
  for (const rawEntry of subredditStats) {
    const entry = asObject(rawEntry);
    if (!entry) {
      continue;
    }

    const subreddit = normalizeSubreddit(asString(entry.subreddit));
    if (!subreddit) {
      continue;
    }

    const postCount = Math.max(0, Math.trunc(asNumber(entry.post_count) ?? 0));
    const commentCount = Math.max(0, Math.trunc(asNumber(entry.comment_count) ?? 0));
    const postScore = Math.trunc(asNumber(entry.post_score) ?? 0);
    const commentScore = Math.trunc(asNumber(entry.comment_score) ?? 0);
    const totalScore = Math.trunc(asNumber(entry.total_score) ?? postScore + commentScore);

    bySubreddit.set(subreddit, {
      subreddit,
      post_count: postCount,
      comment_count: commentCount,
      post_score: postScore,
      comment_score: commentScore,
      total_score: totalScore,
      first_seen_at: asString(entry.first_seen_at),
      last_seen_at: asString(entry.last_seen_at),
      weight: Math.max(0, totalScore) + postCount * 5 + commentCount * 3,
    });
  }

  const subredditKarma = Array.isArray(payload.subreddit_karma) ? payload.subreddit_karma : [];
  for (const rawEntry of subredditKarma) {
    const entry = asObject(rawEntry);
    if (!entry) {
      continue;
    }

    const subreddit = normalizeSubreddit(asString(entry.subreddit));
    if (!subreddit) {
      continue;
    }

    const existing = bySubreddit.get(subreddit);
    const karma = Math.trunc(asNumber(entry.karma) ?? 0);
    if (existing) {
      if (existing.total_score === 0 && existing.post_score === 0 && existing.comment_score === 0) {
        existing.total_score = karma;
      }
      existing.weight = Math.max(existing.weight, Math.max(0, existing.total_score) + existing.post_count * 5 + existing.comment_count * 3);
      continue;
    }

    bySubreddit.set(subreddit, {
      subreddit,
      post_count: 0,
      comment_count: 0,
      post_score: karma,
      comment_score: 0,
      total_score: karma,
      first_seen_at: null,
      last_seen_at: null,
      weight: Math.max(0, karma),
    });
  }

  const topSubreddits = Array.isArray(payload.top_subreddits) ? payload.top_subreddits : [];
  for (const rawEntry of topSubreddits) {
    const entry = asObject(rawEntry);
    if (!entry) {
      continue;
    }

    const subreddit = normalizeSubreddit(asString(entry.subreddit));
    if (!subreddit) {
      continue;
    }

    const existing = bySubreddit.get(subreddit) ?? {
      subreddit,
      post_count: 0,
      comment_count: 0,
      post_score: 0,
      comment_score: 0,
      total_score: 0,
      first_seen_at: null,
      last_seen_at: null,
      weight: 0,
    };

    const posts = Math.max(0, Math.trunc(asNumber(entry.posts) ?? existing.post_count));
    const karma = Math.trunc(asNumber(entry.karma) ?? existing.total_score);
    existing.post_count = Math.max(existing.post_count, posts);
    existing.total_score = existing.total_score || karma;
    if (existing.post_score === 0 && karma !== 0) {
      existing.post_score = karma;
    }
    existing.weight = Math.max(0, existing.total_score) + existing.post_count * 5 + existing.comment_count * 3;
    bySubreddit.set(subreddit, existing);
  }

  return [...bySubreddit.values()].sort((left, right) => {
    if (right.total_score !== left.total_score) {
      return right.total_score - left.total_score;
    }

    return right.weight - left.weight;
  });
}

function buildInterestScores(payload: RedditSnapshotPayload, subredditStats: DerivedSubredditStat[]): Array<{
  tag: string;
  segment_key: string | null;
  score: number;
  matched_subreddits: string[];
  direct_interest_match: boolean;
}> {
  const ranked = new Map<
    string,
    { segment_key: string | null; score: number; matched_subreddits: Set<string>; direct_interest_match: boolean }
  >();

  for (const subreddit of subredditStats) {
    for (const rule of TAXONOMY_RULES) {
      if (!rule.matches.has(subreddit.subreddit)) {
        continue;
      }

      const current = ranked.get(rule.tag) ?? {
        segment_key: rule.segment_key,
        score: 0,
        matched_subreddits: new Set<string>(),
        direct_interest_match: false,
      };
      current.score += subreddit.weight;
      current.matched_subreddits.add(subreddit.subreddit);
      ranked.set(rule.tag, current);
    }
  }

  const inferredInterests = Array.isArray(payload.inferred_interests) ? payload.inferred_interests : [];
  for (const rawInterest of inferredInterests) {
    const interest = asString(rawInterest)?.trim().toLowerCase();
    if (!interest) {
      continue;
    }

    const matchedRule = TAXONOMY_RULES.find((rule) => rule.tag === interest || rule.aliases?.has(interest));
    const tag = matchedRule?.tag ?? interest;
    const current = ranked.get(tag) ?? {
      segment_key: matchedRule?.segment_key ?? null,
      score: 0,
      matched_subreddits: new Set<string>(),
      direct_interest_match: false,
    };
    current.score += 40;
    current.direct_interest_match = true;
    ranked.set(tag, current);
  }

  return [...ranked.entries()]
    .map(([tag, value]) => ({
      tag,
      segment_key: value.segment_key,
      score: value.score,
      matched_subreddits: [...value.matched_subreddits].sort(),
      direct_interest_match: value.direct_interest_match,
    }))
    .sort((left, right) => right.score - left.score);
}

function scoreToConfidence(score: number): number {
  const bounded = Math.max(0, score);
  if (bounded >= 250) {
    return 0.95;
  }
  if (bounded >= 120) {
    return 0.82;
  }
  if (bounded >= 60) {
    return 0.68;
  }
  if (bounded >= 25) {
    return 0.54;
  }
  return 0.38;
}

function deriveAudienceSegments(input: {
  payload: RedditSnapshotPayload;
  subredditStats: DerivedSubredditStat[];
  interestScores: ReturnType<typeof buildInterestScores>;
}): Array<{
  segment_key: string;
  confidence: number;
  evidence_json: string;
}> {
  const segments = new Map<string, { confidence: number; evidence_json: string }>();

  for (const interest of input.interestScores) {
    if (!interest.segment_key || interest.score < 35) {
      continue;
    }

    segments.set(interest.segment_key, {
      confidence: scoreToConfidence(interest.score),
      evidence_json: JSON.stringify({
        tag: interest.tag,
        matched_subreddits: interest.matched_subreddits,
        direct_interest_match: interest.direct_interest_match,
        score: interest.score,
      }),
    });
  }

  const totalPostCount = input.subredditStats.reduce((sum, entry) => sum + entry.post_count, 0);
  const totalCommentCount = input.subredditStats.reduce((sum, entry) => sum + entry.comment_count, 0);
  const creativeTags = new Set(["electronic music", "design", "photography"]);
  const creativeScore = input.interestScores
    .filter((entry) => creativeTags.has(entry.tag))
    .reduce((sum, entry) => sum + entry.score, 0);
  const commentKarma = Math.trunc(asNumber(input.payload.comment_karma) ?? 0);

  if (totalCommentCount >= 10 || commentKarma >= 80) {
    segments.set("aud_high_engagement_commenter", {
      confidence: scoreToConfidence(Math.max(commentKarma, totalCommentCount * 20)),
      evidence_json: JSON.stringify({
        total_comment_count: totalCommentCount,
        comment_karma: commentKarma,
      }),
    });
  }

  if (totalPostCount >= 2 || creativeScore >= 60) {
    segments.set("aud_creator_operator", {
      confidence: scoreToConfidence(Math.max(totalPostCount * 25, creativeScore)),
      evidence_json: JSON.stringify({
        total_post_count: totalPostCount,
        creative_score: creativeScore,
        top_subreddits: input.subredditStats.slice(0, 3).map((entry) => entry.subreddit),
      }),
    });
  }

  return [...segments.entries()].map(([segment_key, value]) => ({
    segment_key,
    confidence: value.confidence,
    evidence_json: value.evidence_json,
  }));
}

function parseJobPayload(raw: string | null): { snapshot_id?: string } {
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as { snapshot_id?: string };
  } catch {
    return {};
  }
}

export async function runRedditFeatureDerivationJob(input: {
  env: Env;
  store: AuthBootstrapStore;
  jobId: string;
}): Promise<void> {
  const job = await input.store.getJobById(input.jobId);
  if (!job) {
    throw new Error(`job_not_found:${input.jobId}`);
  }

  const timestamp = nowIso();
  const payload = parseJobPayload(job.payload_json);
  const snapshotId = payload.snapshot_id ?? job.result_ref;
  if (!snapshotId) {
    await input.store.withTransaction(async (tx) => {
      await tx.updateJobStatus({
        job_id: job.job_id,
        status: "failed",
        result_ref: null,
        error_code: "bad_payload",
        available_at: null,
        updated_at: timestamp,
      });
    });
    return;
  }

  const snapshot = await input.store.getExternalReputationSnapshotById(snapshotId);
  if (!snapshot) {
    await input.store.withTransaction(async (tx) => {
      await tx.updateJobStatus({
        job_id: job.job_id,
        status: "failed",
        result_ref: null,
        error_code: "snapshot_not_found",
        available_at: null,
        updated_at: timestamp,
      });
    });
    return;
  }

  try {
    const parsedPayload = parseRedditSnapshotPayload(snapshot.snapshot_payload_json);
    const subredditStats = parseSnapshotSubredditStats(parsedPayload);
    const interestScores = buildInterestScores(parsedPayload, subredditStats);
    const audienceSegments = deriveAudienceSegments({
      payload: parsedPayload,
      subredditStats,
      interestScores,
    });

    await input.store.withTransaction(async (tx) => {
      await tx.deleteUserRedditSubredditAffinitiesForSnapshot(snapshot.external_reputation_snapshot_id);
      await tx.deleteUserInterestTagsForSnapshot(snapshot.external_reputation_snapshot_id);
      await tx.deleteUserAudienceSegmentsForSnapshot(snapshot.external_reputation_snapshot_id);
      await tx.deleteUserRedditFeatureProfilesForSnapshot(snapshot.external_reputation_snapshot_id);

      for (const subreddit of subredditStats) {
        await tx.upsertUserRedditSubredditAffinity({
          affinity_id: createId("raf"),
          user_id: snapshot.user_id,
          source_snapshot_id: snapshot.external_reputation_snapshot_id,
          subreddit: subreddit.subreddit,
          post_count: subreddit.post_count,
          comment_count: subreddit.comment_count,
          post_score: subreddit.post_score,
          comment_score: subreddit.comment_score,
          total_score: subreddit.total_score,
          first_seen_at: subreddit.first_seen_at,
          last_seen_at: subreddit.last_seen_at,
          weight: subreddit.weight,
          feature_version: FEATURE_VERSION,
          derived_at: timestamp,
          created_at: timestamp,
          updated_at: timestamp,
        });
      }

      for (const interest of interestScores) {
        await tx.upsertUserInterestTag({
          interest_tag_id: createId("rit"),
          user_id: snapshot.user_id,
          source_snapshot_id: snapshot.external_reputation_snapshot_id,
          tag: interest.tag,
          source: "taxonomy",
          confidence: scoreToConfidence(interest.score),
          weight: interest.score,
          evidence_json: JSON.stringify({
            matched_subreddits: interest.matched_subreddits,
            direct_interest_match: interest.direct_interest_match,
            score: interest.score,
          }),
          feature_version: FEATURE_VERSION,
          derived_at: timestamp,
          created_at: timestamp,
          updated_at: timestamp,
        });
      }

      for (const segment of audienceSegments) {
        await tx.upsertUserAudienceSegment({
          audience_segment_id: createId("uas"),
          user_id: snapshot.user_id,
          source_snapshot_id: snapshot.external_reputation_snapshot_id,
          segment_key: segment.segment_key,
          source: "deterministic",
          confidence: segment.confidence,
          eligibility_state: "eligible",
          evidence_json: segment.evidence_json,
          derivation_version: FEATURE_VERSION,
          derived_at: timestamp,
          expires_at: null,
          created_at: timestamp,
          updated_at: timestamp,
        });
      }

      await tx.updateJobStatus({
        job_id: job.job_id,
        status: "succeeded",
        result_ref: snapshot.external_reputation_snapshot_id,
        error_code: null,
        available_at: null,
        updated_at: timestamp,
      });
    });
  } catch {
    await input.store.withTransaction(async (tx) => {
      await tx.updateJobStatus({
        job_id: job.job_id,
        status: "failed",
        result_ref: snapshot.external_reputation_snapshot_id,
        error_code: "derivation_error",
        available_at: null,
        updated_at: nowIso(),
      });
    });
  }
}
