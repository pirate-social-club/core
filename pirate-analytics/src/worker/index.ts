type Env = {
  TINYBIRD_TOKEN?: string
  TINYBIRD_URL?: string
  SUPER_ADMIN_EMAILS?: string
  REQUIRE_ACCESS?: string
}

type TinybirdResponse<T> = {
  data: T[]
}

const defaultTinybirdUrl = "https://api.us-east.aws.tinybird.co"

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)

    if (!url.pathname.startsWith("/api/")) {
      return new Response(null, { status: 404 })
    }

    try {
      const actor = authorize(request, env)

      if (url.pathname === "/api/health") {
        return Response.json({ ok: true, actor })
      }

      if (url.pathname !== "/api/dashboard") {
        return Response.json({ error: "Not found" }, { status: 404 })
      }

      const filters = readFilters(url)
      const [conversion, onboarding, verificationFailures, communityImportHealth, eventQuality] =
        await Promise.all([
          tinybird(env, "conversion_overview", filters),
          tinybird(env, "onboarding_funnel", {
            environment: filters.environment,
            cohort_start: filters.start_time,
            cohort_end: filters.end_time,
          }),
          tinybird(env, "verification_failures", { ...filters, limit: "50" }),
          tinybird(env, "community_import_health", { ...filters, limit: "50" }),
          tinybird(env, "event_quality", {
            environment: filters.environment,
            start_time: filters.start_time,
            end_time: filters.end_time,
            limit: "24",
          }),
        ])

      return Response.json({
        actor,
        generatedAt: new Date().toISOString(),
        filters,
        conversion: conversion.data[0] ?? {},
        onboarding: onboarding.data,
        verificationFailures: verificationFailures.data,
        communityImportHealth: communityImportHealth.data,
        eventQuality: eventQuality.data,
      })
    } catch (cause) {
      const error = cause instanceof HttpError ? cause : new HttpError(500, "Analytics request failed")
      return Response.json({ error: error.message }, { status: error.status })
    }
  },
} satisfies ExportedHandler<Env>

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function authorize(request: Request, env: Env) {
  const requireAccess = env.REQUIRE_ACCESS !== "false"
  const hostname = new URL(request.url).hostname
  const isLocalhost = hostname === "127.0.0.1" || hostname === "localhost"
  const email = request.headers.get("Cf-Access-Authenticated-User-Email")?.toLowerCase() ?? ""

  if (requireAccess && !isLocalhost && !email) {
    throw new HttpError(401, "Cloudflare Access identity is required")
  }

  const allowed = (env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)

  if (allowed.length > 0 && !allowed.includes(email)) {
    throw new HttpError(403, "Not allowed")
  }

  return email || "local"
}

function readFilters(url: URL) {
  const environment = url.searchParams.get("environment") || "production"
  const end = url.searchParams.get("end_time") || new Date().toISOString()
  const start = url.searchParams.get("start_time") || daysAgoIso(7)

  return {
    environment,
    start_time: toTinybirdDateTime(start),
    end_time: toTinybirdDateTime(end),
  }
}

function daysAgoIso(days: number) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString()
}

function toTinybirdDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, "Invalid date filter")
  }
  return date.toISOString().replace("T", " ").replace("Z", "")
}

async function tinybird<T>(env: Env, endpoint: string, params: Record<string, string>) {
  const token = env.TINYBIRD_TOKEN
  if (!token) {
    throw new HttpError(500, "TINYBIRD_TOKEN is not configured")
  }

  const baseUrl = env.TINYBIRD_URL || defaultTinybirdUrl
  const url = new URL(`/v0/pipes/${endpoint}.json`, baseUrl)

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new HttpError(response.status, `Tinybird ${endpoint} failed: ${body.slice(0, 240)}`)
  }

  return response.json() as Promise<TinybirdResponse<T>>
}
