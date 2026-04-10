import type { MarketContextPageFetcher, FetchedPage } from "./types";
import { nowIso } from "../time";

function extractHeaderValue(body: string, label: string): string | null {
  const pattern = new RegExp(`^${label}:\\s*(.+)$`, "mi");
  const match = body.match(pattern);
  return match?.[1]?.trim() || null;
}

function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/[*_~>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripJinaBoilerplate(value: string): string {
  let content = value;

  const markdownMarker = "Markdown Content:";
  const markerIndex = content.indexOf(markdownMarker);
  if (markerIndex !== -1) {
    content = content.slice(markerIndex + markdownMarker.length);
  }

  const stopMarkers = [
    "\n### Recommended Articles",
    "\n### Recommended Videos",
    "\nRecommended Articles",
    "\nRecommended Videos",
    "\nThis material may not be published, broadcast, rewritten, or redistributed.",
    "\nTerms of Use",
    "\nPrivacy Policy",
  ];

  for (const marker of stopMarkers) {
    const stopIndex = content.indexOf(marker);
    if (stopIndex !== -1) {
      content = content.slice(0, stopIndex);
    }
  }

  const filteredLines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Title:\s/i.test(line))
    .filter((line) => !/^URL Source:\s/i.test(line))
    .filter((line) => !/^Published Time:\s/i.test(line))
    .filter((line) => !/^[-*]\s{0,3}\[.*\]\(.*\)$/.test(line))
    .filter((line) => !/^(watch tv|menu|log in|expand\/collapse menu)$/i.test(line))
    .filter((line) => !/^#{1,6}\s*(recommended|related|more)\b/i.test(line))
    .filter((line) => !/^(fox news|cnn|fox business|u\.s\.|politics|world|sports|lifestyle)$/i.test(line));

  const denseLines = filteredLines.filter((line) => {
    if (/^#{1,6}\s+/.test(line)) {
      return true;
    }

    if (line.length >= 80) {
      return true;
    }

    return /[.!?]["')\]]?$/.test(line) && line.length >= 40;
  });

  return denseLines.join("\n\n").trim();
}

export function resolveExtractionText(page: FetchedPage, maxChars: number): string | null {
  const primary = page.content_text?.trim() ?? "";
  if (primary) {
    const cleaned = stripJinaBoilerplate(primary);
    return cleaned ? cleaned.slice(0, maxChars) : null;
  }

  const markdown = page.content_markdown?.trim() ?? "";
  if (!markdown) {
    return null;
  }

  const stripped = stripJinaBoilerplate(stripMarkdown(markdown));
  if (!stripped) {
    return null;
  }

  return stripped.slice(0, maxChars);
}

export class JinaReaderMarketContextPageFetcher implements MarketContextPageFetcher {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | null = null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async fetchPage(url: string): Promise<FetchedPage> {
    const targetUrl = `${this.baseUrl}${url.replace(/^https?:\/\//, "")}`;
    const headers: Record<string, string> = {
      Accept: "text/plain, text/markdown;q=0.9, application/json;q=0.8",
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const response = await this.fetchImpl(targetUrl, {
      headers,
    });

    const body = await response.text();
    const fetchedAt = nowIso();

    if (!response.ok) {
      return {
        final_url: url,
        canonical_url: null,
        http_status: response.status,
        fetched_at: fetchedAt,
        title: null,
        meta_description: null,
        byline: null,
        published_at: null,
        site_name: null,
        content_markdown: null,
        content_text: null,
        excerpt: null,
        language: null,
        failure_code: response.status === 408 ? "timeout" : "network_error",
      };
    }

    const content = body.trim();
    const publishedAt = extractHeaderValue(content, "Published Time");
    const sourceTitle = extractHeaderValue(content, "Title");
    const sourceUrl = extractHeaderValue(content, "URL Source");

    return {
      final_url: sourceUrl ?? url,
      canonical_url: null,
      http_status: response.status,
      fetched_at: fetchedAt,
      title: sourceTitle,
      meta_description: null,
      byline: null,
      published_at: publishedAt,
      site_name: null,
      content_markdown: content || null,
      content_text: stripMarkdown(content) || null,
      excerpt: content.slice(0, 400) || null,
      language: null,
      failure_code: content ? null : "empty_content",
    };
  }
}

type FirecrawlScrapeResponse = {
  success?: boolean;
  data?: {
    markdown?: string | null;
    metadata?: {
      url?: string | null;
      title?: string | null;
      description?: string | null;
      publishedTime?: string | null;
      language?: string | null;
      sourceURL?: string | null;
      statusCode?: number | null;
    } | null;
  } | null;
};

export class FirecrawlMarketContextPageFetcher implements MarketContextPageFetcher {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async fetchPage(url: string): Promise<FetchedPage> {
    const response = await this.fetchImpl(`${this.baseUrl}/v2/scrape`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: 30000,
      }),
    });

    const fetchedAt = nowIso();

    if (!response.ok) {
      return {
        final_url: url,
        canonical_url: null,
        http_status: response.status,
        fetched_at: fetchedAt,
        title: null,
        meta_description: null,
        byline: null,
        published_at: null,
        site_name: null,
        content_markdown: null,
        content_text: null,
        excerpt: null,
        language: null,
        failure_code: response.status === 408 ? "timeout" : "network_error",
      };
    }

    const payload = (await response.json()) as FirecrawlScrapeResponse;
    const metadata = payload.data?.metadata ?? null;
    const markdown = payload.data?.markdown?.trim() ?? "";
    const contentText = markdown ? stripMarkdown(markdown) : "";

    return {
      final_url: metadata?.url ?? url,
      canonical_url: metadata?.sourceURL ?? metadata?.url ?? null,
      http_status: metadata?.statusCode ?? response.status,
      fetched_at: fetchedAt,
      title: metadata?.title ?? null,
      meta_description: metadata?.description ?? null,
      byline: null,
      published_at: metadata?.publishedTime ?? null,
      site_name: null,
      content_markdown: markdown || null,
      content_text: contentText || null,
      excerpt: contentText.slice(0, 400) || null,
      language: metadata?.language ?? null,
      failure_code: contentText ? null : "empty_content",
    };
  }
}
