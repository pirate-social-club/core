import type { JobRow, NamespaceVerificationRow, NamespaceVerificationSessionRow, RedditVerificationSessionRow, ExternalReputationSnapshotRow } from "../types/db";
import type { OnboardingStatus } from "../types/api";

export type RedditVerificationResponse = {
  reddit_username: string;
  status: "pending" | "verified" | "failed" | "expired";
  verification_hint: string | null;
  code_placement_surface: "profile" | "bio" | "about" | null;
  last_checked_at: string | null;
  failure_code: "code_not_found" | "username_not_found" | "rate_limited" | "source_error" | null;
};

export type RedditImportSummaryResponse = {
  reddit_username: string;
  imported_at: string;
  account_age_days: number | null;
  global_karma: number | null;
  top_subreddits: Array<{
    subreddit: string;
    karma: number | null;
    posts: number | null;
    rank_source: "karma" | "posts" | "source_order" | null;
  }>;
  moderator_of: string[];
  inferred_interests: string[];
  suggested_communities: Array<{
    community_id: string;
    name: string;
    reason: string;
  }>;
  coverage_note: string | null;
};

export type RedditSnapshotPayload = {
  account_age_days?: number | null;
  global_karma?: number | null;
  post_karma?: number | null;
  comment_karma?: number | null;
  subreddit_stats?: Array<{
    subreddit: string;
    post_count: number;
    comment_count: number;
    post_score: number;
    comment_score: number;
    total_score: number;
    first_seen_at?: string | null;
    last_seen_at?: string | null;
  }>;
  subreddit_karma?: Array<{
    subreddit: string;
    karma: number;
  }>;
  top_subreddits?: Array<{
    subreddit: string;
    karma?: number | null;
    posts?: number | null;
    rank_source?: "karma" | "posts" | "source_order" | null;
  }>;
  moderator_of?: string[];
  inferred_interests?: string[];
  suggested_communities?: Array<{
    community_id: string;
    name: string;
    reason: string;
  }>;
  coverage_note?: string | null;
  top_posts?: Array<{
    subreddit: string;
    title: string;
    score: number;
  }>;
  top_comments?: Array<{
    subreddit: string;
    score: number;
  }>;
};

type FetchLike = typeof fetch;

type PullPushThing = {
  id?: string;
  subreddit?: string;
  score?: number;
  created_utc?: number;
  title?: string;
  selftext?: string;
  body?: string;
};

export type RedditProfileCheckResult =
  | { outcome: "verified" }
  | { outcome: "pending"; failure_code: "code_not_found" | "source_error" }
  | { outcome: "failed"; failure_code: "username_not_found" | "source_error" };

const DEFAULT_REDDIT_PROFILE_BASE_URL = "https://old.reddit.com";
const DEFAULT_REDDIT_PROFILE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const DEFAULT_PULLPUSH_BASE_URL = "https://api.pullpush.io/reddit";
const DEFAULT_PULLPUSH_PAGE_SIZE = 100;
const DEFAULT_PULLPUSH_MAX_ITEMS = 1000;

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asInteger(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

export function normalizeRedditUsername(input: string): string {
  return input.trim().replace(/^\/?u\//i, "").replace(/^@/, "").toLowerCase();
}

export function createRedditVerificationCode(): string {
  return `pirate-${Math.random().toString(36).slice(2, 8)}`;
}

function asPositiveEpoch(value: unknown): number | null {
  const parsed = asNumber(value);
  return parsed != null && parsed > 0 ? Math.floor(parsed) : null;
}

function summarizeText(value: string | undefined, maxLength: number): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeSubredditName(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().replace(/^r\//i, "");
  return trimmed.length > 0 ? trimmed : null;
}

function scoreThingDescending<T extends { score: number; created_utc: number }>(left: T, right: T): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  return right.created_utc - left.created_utc;
}

export async function checkRedditProfileForVerificationCode(input: {
  username: string;
  verificationCode: string;
  fetchFn?: FetchLike;
  profileBaseUrl?: string;
  userAgent?: string;
}): Promise<RedditProfileCheckResult> {
  const fetchFn = input.fetchFn ?? fetch;
  const requestedBaseUrl = (input.profileBaseUrl ?? DEFAULT_REDDIT_PROFILE_BASE_URL).replace(/\/$/, "");
  const baseUrls = [requestedBaseUrl, "https://old.reddit.com", "https://www.reddit.com"]
    .filter((value, index, array) => array.indexOf(value) === index);
  let sawNotFound = false;
  let sawReachableProfile = false;

  for (const profileBaseUrl of baseUrls) {
    const profileUrl = `${profileBaseUrl}/user/${encodeURIComponent(input.username)}/`;

    try {
      const response = await fetchFn(profileUrl, {
        headers: {
          "user-agent": input.userAgent ?? DEFAULT_REDDIT_PROFILE_USER_AGENT,
          accept: "text/html,application/xhtml+xml",
        },
      });

      if (response.status === 404) {
        sawNotFound = true;
        continue;
      }

      if (!response.ok) {
        continue;
      }

      const html = await response.text();
      const looksLikeInterstitial =
        html.includes("Please wait for verification") ||
        html.includes("requestSubmit()") ||
        html.includes('name="solution"');
      if (looksLikeInterstitial) {
        continue;
      }

      sawReachableProfile = true;
      if (html.includes(input.verificationCode)) {
        return {
          outcome: "verified",
        };
      }
    } catch {
      continue;
    }
  }

  if (sawReachableProfile) {
    return {
      outcome: "pending",
      failure_code: "code_not_found",
    };
  }

  if (sawNotFound) {
    return {
      outcome: "failed",
      failure_code: "username_not_found",
    };
  }

  return {
    outcome: "pending",
    failure_code: "source_error",
  };
}

async function fetchPullPushListing(input: {
  kind: "submission" | "comment";
  username: string;
  fetchFn?: FetchLike;
  baseUrl?: string;
  maxItems?: number;
}): Promise<PullPushThing[]> {
  const fetchFn = input.fetchFn ?? fetch;
  const baseUrl = (input.baseUrl ?? DEFAULT_PULLPUSH_BASE_URL).replace(/\/$/, "");
  const requestedMaxItems = input.maxItems ?? DEFAULT_PULLPUSH_MAX_ITEMS;
  const maxItems = Number.isFinite(requestedMaxItems) && requestedMaxItems > 0
    ? Math.floor(requestedMaxItems)
    : DEFAULT_PULLPUSH_MAX_ITEMS;
  const rows: PullPushThing[] = [];
  const seenIds = new Set<string>();
  let before: number | null = null;

  while (rows.length < maxItems) {
    const params = new URLSearchParams({
      author: input.username,
      sort: "desc",
      sort_type: "created_utc",
      size: String(Math.min(DEFAULT_PULLPUSH_PAGE_SIZE, maxItems - rows.length)),
    });
    if (before != null) {
      params.set("before", String(before));
    }

    const response = await fetchFn(`${baseUrl}/search/${input.kind}/?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`pullpush_${input.kind}_http_${response.status}`);
    }

    const payload = (await response.json()) as { data?: unknown };
    const page = Array.isArray(payload.data) ? payload.data : [];
    if (page.length === 0) {
      break;
    }

    let oldestCreatedUtc: number | null = null;
    let appended = 0;
    for (const entry of page) {
      const objectEntry = asObject(entry);
      if (!objectEntry) {
        continue;
      }

      const id = asString(objectEntry.id);
      if (id && seenIds.has(id)) {
        continue;
      }

      const createdUtc = asPositiveEpoch(objectEntry.created_utc);
      if (createdUtc != null && (oldestCreatedUtc == null || createdUtc < oldestCreatedUtc)) {
        oldestCreatedUtc = createdUtc;
      }

      if (id) {
        seenIds.add(id);
      }

      rows.push({
        id: id ?? undefined,
        subreddit: asString(objectEntry.subreddit) ?? undefined,
        score: asNumber(objectEntry.score) ?? undefined,
        created_utc: createdUtc ?? undefined,
        title: asString(objectEntry.title) ?? undefined,
        selftext: asString(objectEntry.selftext) ?? undefined,
        body: asString(objectEntry.body) ?? undefined,
      });
      appended += 1;

      if (rows.length >= maxItems) {
        break;
      }
    }

    if (appended === 0 || oldestCreatedUtc == null || oldestCreatedUtc <= 0) {
      break;
    }

    before = oldestCreatedUtc - 1;
  }

  return rows;
}

function inferCommunityMatches(topSubreddits: Array<{ subreddit: string; karma: number; posts: number }>): {
  inferred_interests: string[];
  suggested_communities: RedditSnapshotPayload["suggested_communities"];
} {
  const communityRules = [
    {
      community_id: "cmt_music_01",
      name: "Electronic Music",
      interest: "electronic music",
      reason: "Strong activity in music and production subreddits",
      matches: new Set(["electronicmusic", "ableton", "synthesizers", "musicproduction", "edmproduction", "techno", "house", "djsetups"]),
    },
    {
      community_id: "cmt_design_01",
      name: "Design",
      interest: "design",
      reason: "Strong activity in design and visual craft subreddits",
      matches: new Set(["design", "graphic_design", "web_design", "uxdesign", "userexperience", "typography"]),
    },
    {
      community_id: "cmt_tech_01",
      name: "Technology",
      interest: "technology",
      reason: "Strong activity in programming and technology subreddits",
      matches: new Set(["technology", "programming", "webdev", "javascript", "typescript", "reactjs", "linux"]),
    },
  ] as const;

  const weightedScores = new Map<string, number>();
  for (const subreddit of topSubreddits) {
    const normalized = subreddit.subreddit.toLowerCase();
    const weight = Math.max(1, subreddit.karma) + subreddit.posts * 5;
    for (const rule of communityRules) {
      if (rule.matches.has(normalized)) {
        weightedScores.set(rule.community_id, (weightedScores.get(rule.community_id) ?? 0) + weight);
      }
    }
  }

  const rankedRules = communityRules
    .map((rule) => ({
      rule,
      score: weightedScores.get(rule.community_id) ?? 0,
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return {
    inferred_interests: rankedRules.map((entry) => entry.rule.interest),
    suggested_communities: rankedRules.map((entry) => ({
      community_id: entry.rule.community_id,
      name: entry.rule.name,
      reason: entry.rule.reason,
    })),
  };
}

export async function buildPullPushRedditSnapshotPayload(input: {
  username: string;
  fetchFn?: FetchLike;
  pullpushBaseUrl?: string;
  maxItems?: number;
}): Promise<RedditSnapshotPayload> {
  const [posts, comments] = await Promise.all([
    fetchPullPushListing({
      kind: "submission",
      username: input.username,
      fetchFn: input.fetchFn,
      baseUrl: input.pullpushBaseUrl,
      maxItems: input.maxItems,
    }),
    fetchPullPushListing({
      kind: "comment",
      username: input.username,
      fetchFn: input.fetchFn,
      baseUrl: input.pullpushBaseUrl,
      maxItems: input.maxItems,
    }),
  ]);

  const subredditStats = new Map<
    string,
    {
      subreddit: string;
      post_count: number;
      comment_count: number;
      post_score: number;
      comment_score: number;
      earliest_created_utc: number | null;
      latest_created_utc: number | null;
    }
  >();

  const topPosts = posts
    .map((post) => ({
      subreddit: normalizeSubredditName(post.subreddit) ?? "unknown",
      title: summarizeText(post.title || post.selftext, 120),
      score: Math.trunc(post.score ?? 0),
      created_utc: post.created_utc ?? 0,
    }))
    .filter((entry) => entry.title.length > 0)
    .sort(scoreThingDescending)
    .slice(0, 10)
    .map(({ subreddit, title, score }) => ({
      subreddit,
      title,
      score,
    }));

  const topComments = comments
    .map((comment) => ({
      subreddit: normalizeSubredditName(comment.subreddit) ?? "unknown",
      score: Math.trunc(comment.score ?? 0),
      created_utc: comment.created_utc ?? 0,
    }))
    .sort(scoreThingDescending)
    .slice(0, 10)
    .map(({ subreddit, score }) => ({
      subreddit,
      score,
    }));

  let earliestCreatedUtc: number | null = null;
  let postKarma = 0;
  let commentKarma = 0;

  for (const post of posts) {
    const subreddit = normalizeSubredditName(post.subreddit) ?? "unknown";
    const createdUtc = post.created_utc ?? null;
    const score = Math.trunc(post.score ?? 0);
    const current = subredditStats.get(subreddit) ?? {
      subreddit,
      post_count: 0,
      comment_count: 0,
      post_score: 0,
      comment_score: 0,
      earliest_created_utc: null,
      latest_created_utc: null,
    };

    current.post_count += 1;
    current.post_score += score;
    if (createdUtc != null && (current.earliest_created_utc == null || createdUtc < current.earliest_created_utc)) {
      current.earliest_created_utc = createdUtc;
    }
    if (createdUtc != null && (current.latest_created_utc == null || createdUtc > current.latest_created_utc)) {
      current.latest_created_utc = createdUtc;
    }
    subredditStats.set(subreddit, current);

    postKarma += score;
    if (createdUtc != null && (earliestCreatedUtc == null || createdUtc < earliestCreatedUtc)) {
      earliestCreatedUtc = createdUtc;
    }
  }

  for (const comment of comments) {
    const subreddit = normalizeSubredditName(comment.subreddit) ?? "unknown";
    const createdUtc = comment.created_utc ?? null;
    const score = Math.trunc(comment.score ?? 0);
    const current = subredditStats.get(subreddit) ?? {
      subreddit,
      post_count: 0,
      comment_count: 0,
      post_score: 0,
      comment_score: 0,
      earliest_created_utc: null,
      latest_created_utc: null,
    };

    current.comment_count += 1;
    current.comment_score += score;
    if (createdUtc != null && (current.earliest_created_utc == null || createdUtc < current.earliest_created_utc)) {
      current.earliest_created_utc = createdUtc;
    }
    if (createdUtc != null && (current.latest_created_utc == null || createdUtc > current.latest_created_utc)) {
      current.latest_created_utc = createdUtc;
    }
    subredditStats.set(subreddit, current);

    commentKarma += score;
    if (createdUtc != null && (earliestCreatedUtc == null || createdUtc < earliestCreatedUtc)) {
      earliestCreatedUtc = createdUtc;
    }
  }

  const subredditKarma = [...subredditStats.values()]
    .map((entry) => ({
      subreddit: entry.subreddit,
      karma: entry.post_score + entry.comment_score,
      posts: entry.post_count,
      comments: entry.comment_count,
    }))
    .sort((left, right) => {
      if (right.karma !== left.karma) {
        return right.karma - left.karma;
      }

      return (right.posts + right.comments) - (left.posts + left.comments);
    });

  const topSubreddits = subredditKarma.slice(0, 10).map((entry) => ({
    subreddit: entry.subreddit,
    karma: entry.karma,
    posts: entry.posts,
    rank_source: "karma" as const,
  }));

  const inferred = inferCommunityMatches(topSubreddits);
  const nowEpoch = Math.floor(Date.now() / 1000);
  const accountAgeDays =
    earliestCreatedUtc == null ? null : Math.max(0, Math.floor((nowEpoch - earliestCreatedUtc) / (24 * 60 * 60)));

  return {
    account_age_days: accountAgeDays,
    post_karma: postKarma,
    comment_karma: commentKarma,
    global_karma: postKarma + commentKarma,
    subreddit_stats: subredditKarma.map((entry) => {
      const stats = subredditStats.get(entry.subreddit);
      return {
        subreddit: entry.subreddit,
        post_count: stats?.post_count ?? entry.posts,
        comment_count: stats?.comment_count ?? entry.comments,
        post_score: stats?.post_score ?? entry.karma,
        comment_score: stats?.comment_score ?? 0,
        total_score: entry.karma,
        first_seen_at:
          stats?.earliest_created_utc != null ? new Date(stats.earliest_created_utc * 1000).toISOString() : null,
        last_seen_at:
          stats?.latest_created_utc != null ? new Date(stats.latest_created_utc * 1000).toISOString() : null,
      };
    }),
    subreddit_karma: subredditKarma.map((entry) => ({
      subreddit: entry.subreddit,
      karma: entry.karma,
    })),
    top_subreddits: topSubreddits,
    moderator_of: [],
    inferred_interests: inferred.inferred_interests,
    suggested_communities: inferred.suggested_communities,
    coverage_note:
      "PullPush archival snapshot built from public submissions and comments only. Profile/about fields and moderator data are not included.",
    top_posts: topPosts,
    top_comments: topComments,
  };
}

export function serializeRedditVerification(row: RedditVerificationSessionRow): RedditVerificationResponse {
  return {
    reddit_username: row.reddit_username,
    status: row.status,
    verification_hint: row.verification_hint,
    code_placement_surface: row.code_placement_surface,
    last_checked_at: row.last_checked_at,
    failure_code: row.failure_code,
  };
}

export function parseRedditSnapshotPayload(raw: string): RedditSnapshotPayload {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return asObject(parsed) ?? {};
  } catch {
    return {};
  }
}

export function serializeRedditImportSummary(row: ExternalReputationSnapshotRow): RedditImportSummaryResponse {
  const payload = parseRedditSnapshotPayload(row.snapshot_payload_json);
  const explicitTopSubreddits = Array.isArray(payload.top_subreddits) ? payload.top_subreddits : [];
  const fallbackTopSubreddits = Array.isArray(payload.subreddit_karma)
    ? payload.subreddit_karma.map((entry) => ({
        subreddit: entry.subreddit,
        karma: entry.karma,
        posts: null,
        rank_source: "karma" as const,
      }))
    : [];

  const topSubreddits = (explicitTopSubreddits.length > 0 ? explicitTopSubreddits : fallbackTopSubreddits)
    .map((entry) => {
      const objectEntry = asObject(entry);
      if (!objectEntry) {
        return null;
      }

      const subreddit = asString(objectEntry.subreddit);
      if (!subreddit) {
        return null;
      }

      const rankSource = objectEntry.rank_source;

      return {
        subreddit,
        karma: asInteger(objectEntry.karma),
        posts: asInteger(objectEntry.posts),
        rank_source:
          rankSource === "karma" || rankSource === "posts" || rankSource === "source_order"
            ? rankSource
            : null,
      };
    })
    .filter((entry): entry is RedditImportSummaryResponse["top_subreddits"][number] => entry !== null);

  const suggestedCommunities = (Array.isArray(payload.suggested_communities) ? payload.suggested_communities : [])
    .map((entry) => {
      const objectEntry = asObject(entry);
      if (!objectEntry) {
        return null;
      }

      const communityId = asString(objectEntry.community_id);
      const name = asString(objectEntry.name);
      const reason = asString(objectEntry.reason);
      if (!communityId || !name || !reason) {
        return null;
      }

      return {
        community_id: communityId,
        name,
        reason,
      };
    })
    .filter((entry): entry is RedditImportSummaryResponse["suggested_communities"][number] => entry !== null);

  const globalKarma =
    asInteger(payload.global_karma) ??
    (() => {
      const postKarma = asInteger(payload.post_karma);
      const commentKarma = asInteger(payload.comment_karma);
      if (postKarma == null && commentKarma == null) {
        return null;
      }

      return (postKarma ?? 0) + (commentKarma ?? 0);
    })();

  return {
    reddit_username: row.source_account_handle,
    imported_at: row.captured_at,
    account_age_days: asInteger(payload.account_age_days),
    global_karma: globalKarma,
    top_subreddits: topSubreddits,
    moderator_of: asStringArray(payload.moderator_of),
    inferred_interests: asStringArray(payload.inferred_interests),
    suggested_communities: suggestedCommunities,
    coverage_note: asString(payload.coverage_note),
  };
}

export function deriveOnboardingStatus(input: {
  activeGlobalHandleIssuedByGeneratedSignup: boolean;
  cleanupRenameAvailable: boolean;
  verificationCapabilitiesJson: string;
  latestNamespaceVerificationRow: NamespaceVerificationRow | null;
  latestNamespaceVerificationSessionRow: NamespaceVerificationSessionRow | null;
  latestRedditVerificationRow: RedditVerificationSessionRow | null;
  latestRedditImportJobRow: JobRow | null;
  latestRedditSnapshotRow: ExternalReputationSnapshotRow | null;
}): OnboardingStatus {
  const uniqueHumanState: OnboardingStatus["unique_human_verification_status"] = (() => {
    try {
      const parsed = JSON.parse(input.verificationCapabilitiesJson) as {
        unique_human?: { state?: "unverified" | "pending" | "verified" | "expired" };
      };
      const state = parsed.unique_human?.state;
      if (state === "pending" || state === "verified" || state === "expired") {
        return state;
      }
    } catch {}

    return "not_started";
  })();

  const namespaceStatus: OnboardingStatus["namespace_verification_status"] = (() => {
    if (input.latestNamespaceVerificationRow) {
      return input.latestNamespaceVerificationRow.status;
    }

    if (!input.latestNamespaceVerificationSessionRow) {
      return "not_started";
    }

    switch (input.latestNamespaceVerificationSessionRow.status) {
      case "draft":
      case "inspecting":
      case "dns_setup_required":
      case "challenge_required":
      case "challenge_pending":
      case "verifying":
        return "pending";
      case "verified":
        return "verified";
      case "expired":
        return "expired";
      case "disputed":
        return "disputed";
      case "failed":
        return "failed";
    }
  })();

  const redditVerificationStatus: OnboardingStatus["reddit_verification_status"] = (() => {
    if (input.latestRedditSnapshotRow) {
      return "verified";
    }

    if (!input.latestRedditVerificationRow) {
      return "not_started";
    }

    switch (input.latestRedditVerificationRow.status) {
      case "pending":
        return "pending";
      case "verified":
        return "verified";
      case "failed":
      case "expired":
        return "failed";
    }
  })();

  const redditImportStatus: OnboardingStatus["reddit_import_status"] = (() => {
    if (!input.latestRedditImportJobRow) {
      return input.latestRedditSnapshotRow ? "succeeded" : "not_started";
    }

    return input.latestRedditImportJobRow.status;
  })();

  const missingRequirements: string[] = [];
  if (uniqueHumanState !== "verified") {
    missingRequirements.push("unique_human_verification");
  }
  if (namespaceStatus !== "verified") {
    missingRequirements.push("namespace_verification");
  }

  const suggestedCommunityIds = input.latestRedditSnapshotRow
    ? serializeRedditImportSummary(input.latestRedditSnapshotRow).suggested_communities.map((entry) => entry.community_id)
    : [];

  return {
    generated_handle_assigned: input.activeGlobalHandleIssuedByGeneratedSignup,
    cleanup_rename_available: input.cleanupRenameAvailable,
    unique_human_verification_status: uniqueHumanState,
    namespace_verification_status: namespaceStatus,
    community_creation_ready: missingRequirements.length === 0,
    missing_requirements: missingRequirements,
    reddit_verification_status: redditVerificationStatus,
    reddit_import_status: redditImportStatus,
    suggested_community_ids: suggestedCommunityIds,
  };
}

export function buildStubRedditSnapshotPayload(username: string): RedditSnapshotPayload {
  const normalized = normalizeRedditUsername(username);

  if (normalized === "technohippie") {
    return {
      account_age_days: 4320,
      post_karma: 18420,
      comment_karma: 25780,
      global_karma: 44200,
      top_subreddits: [
        { subreddit: "electronicmusic", karma: 12400, posts: 84, rank_source: "karma" },
        { subreddit: "ableton", karma: 9100, posts: 61, rank_source: "karma" },
        { subreddit: "synthesizers", karma: 7050, posts: 42, rank_source: "karma" },
        { subreddit: "design", karma: 3810, posts: 28, rank_source: "karma" },
      ],
      moderator_of: ["leftfieldbeats"],
      inferred_interests: ["electronic", "music production", "design"],
      suggested_communities: [
        {
          community_id: "cmt_music_01",
          name: "Electronic Music",
          reason: "Strong activity in electronic music and production subreddits",
        },
        {
          community_id: "cmt_design_01",
          name: "Design",
          reason: "Meaningful design participation overlaps with Pirate design clubs",
        },
      ],
      coverage_note: "Pushpull archival snapshot; local stub fixture for the reference worker.",
      top_posts: [
        { subreddit: "electronicmusic", title: "Set recap from Tbilisi warehouse night", score: 812 },
        { subreddit: "ableton", title: "Live set routing template", score: 531 },
      ],
      top_comments: [
        { subreddit: "synthesizers", score: 277 },
        { subreddit: "design", score: 191 },
      ],
    };
  }

  const base = normalized.length;
  return {
    account_age_days: 365 + base * 17,
    post_karma: 500 + base * 80,
    comment_karma: 900 + base * 110,
    global_karma: 1400 + base * 190,
    top_subreddits: [
      { subreddit: "technology", karma: 700 + base * 25, posts: 12 + base, rank_source: "karma" },
      { subreddit: "music", karma: 520 + base * 18, posts: 8 + Math.floor(base / 2), rank_source: "karma" },
      { subreddit: "design", karma: 310 + base * 14, posts: 6 + Math.floor(base / 3), rank_source: "karma" },
    ],
    moderator_of: [],
    inferred_interests: ["technology", "music"],
    suggested_communities: [
      {
        community_id: "cmt_starter_01",
        name: "Starter Club",
        reason: "Imported Reddit interests suggest a generalist onboarding match",
      },
    ],
    coverage_note: "Local stub snapshot for the reference worker.",
  };
}
