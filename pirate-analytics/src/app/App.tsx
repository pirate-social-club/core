import { useEffect, useMemo, useState } from "react"
import type {
  CommunityImportHealth,
  ConversionOverview,
  DashboardData,
  EventQuality,
  FunnelStep,
  VerificationFailure,
} from "./types"

const environmentOptions = ["production", "staging", "development"]

const emptyConversion: ConversionOverview = {
  page_views: 0,
  unique_visitors: 0,
  auth_started: 0,
  users_created: 0,
  human_verification_started: 0,
  human_verification_succeeded: 0,
  human_verification_failed: 0,
  reddit_import_started: 0,
  reddit_import_succeeded: 0,
  reddit_import_failed: 0,
  onboarding_completed: 0,
  visitor_to_user_rate: 0,
  human_verification_success_rate: 0,
  human_verification_failure_rate: 0,
  onboarding_completion_rate: 0,
}

function isoDaysAgo(days: number) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString()
}

function inputValueFromIso(iso: string) {
  return iso.slice(0, 16)
}

function isoFromInput(value: string) {
  return new Date(value).toISOString()
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0)
}

function formatRate(value: number) {
  return `${Math.round((value || 0) * 1000) / 10}%`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function labelForStep(step: string) {
  return step.replaceAll("_", " ")
}

export function App() {
  const [environment, setEnvironment] = useState("production")
  const [startTime, setStartTime] = useState(isoDaysAgo(7))
  const [endTime, setEndTime] = useState(new Date().toISOString())
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const query = useMemo(() => {
    const params = new URLSearchParams({
      environment,
      start_time: startTime,
      end_time: endTime,
    })
    return `/api/dashboard?${params.toString()}`
  }, [endTime, environment, startTime])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    fetch(query, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({ error: response.statusText }))
          throw new Error(body.error ?? response.statusText)
        }
        return response.json() as Promise<DashboardData>
      })
      .then(setData)
      .catch((cause: unknown) => {
        if ((cause as Error).name !== "AbortError") {
          setError(cause instanceof Error ? cause.message : "Unable to load analytics")
        }
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [query])

  const conversion = data?.conversion ?? emptyConversion

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Pirate Launch Room</p>
          <h1>Analytics</h1>
        </div>
        <div className="filters" aria-label="Dashboard filters">
          <label>
            Environment
            <select value={environment} onChange={(event) => setEnvironment(event.target.value)}>
              {environmentOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input
              type="datetime-local"
              value={inputValueFromIso(startTime)}
              onChange={(event) => setStartTime(isoFromInput(event.target.value))}
            />
          </label>
          <label>
            To
            <input
              type="datetime-local"
              value={inputValueFromIso(endTime)}
              onChange={(event) => setEndTime(isoFromInput(event.target.value))}
            />
          </label>
        </div>
      </header>

      {error ? <div className="alert">{error}</div> : null}

      <section className="metricBand" aria-busy={loading}>
        <Metric label="Unique visitors" value={conversion.unique_visitors} />
        <Metric label="Users created" value={conversion.users_created} accent />
        <Metric label="Visitor to user" value={formatRate(conversion.visitor_to_user_rate)} />
        <Metric label="Palm failures" value={conversion.human_verification_failed} warn />
        <Metric label="Palm failure rate" value={formatRate(conversion.human_verification_failure_rate)} warn />
        <Metric label="Onboarding complete" value={conversion.onboarding_completed} />
      </section>

      <section className="twoColumn">
        <Panel title="Conversion Funnel">
          <Funnel steps={data?.onboarding ?? []} />
        </Panel>
        <Panel title="System Quality">
          <QualityRows rows={data?.eventQuality ?? []} />
        </Panel>
      </section>

      <section className="twoColumn wideLeft">
        <Panel title="Palm Scan Failures">
          <FailureTable rows={data?.verificationFailures ?? []} />
        </Panel>
        <Panel title="Community Imports">
          <CommunityTable rows={data?.communityImportHealth ?? []} />
        </Panel>
      </section>
    </main>
  )
}

function Metric({
  label,
  value,
  accent = false,
  warn = false,
}: {
  label: string
  value: number | string
  accent?: boolean
  warn?: boolean
}) {
  return (
    <article className={`metric ${accent ? "accent" : ""} ${warn ? "warn" : ""}`}>
      <span>{label}</span>
      <strong>{typeof value === "number" ? formatNumber(value) : value}</strong>
    </article>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function Funnel({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(...steps.map((step) => step.users), 1)

  if (steps.length === 0) {
    return <p className="empty">No funnel events in this range.</p>
  }

  return (
    <div className="funnel">
      {steps.map((step) => (
        <div className="funnelRow" key={step.step_name}>
          <div className="funnelLabel">
            <span>{labelForStep(step.step_name)}</span>
            <strong>{formatNumber(step.users)}</strong>
          </div>
          <div className="barTrack" aria-label={`${step.step_name}: ${step.users}`}>
            <div className="barFill" style={{ width: `${Math.max((step.users / max) * 100, 2)}%` }} />
          </div>
          <span className="rate">{formatRate(step.rate_from_start)}</span>
        </div>
      ))}
    </div>
  )
}

function QualityRows({ rows }: { rows: EventQuality[] }) {
  if (rows.length === 0) {
    return <p className="empty">No event quality rows yet.</p>
  }

  return (
    <div className="stackRows">
      {rows.slice(0, 8).map((row) => (
        <div className="qualityRow" key={`${row.hour}-${row.source}`}>
          <div>
            <span>{formatDate(row.hour)}</span>
            <strong>{row.source}</strong>
          </div>
          <div>
            <span>events</span>
            <strong>{formatNumber(row.received_events)}</strong>
          </div>
          <div>
            <span>duplicates</span>
            <strong>{formatNumber(row.duplicate_event_ids)}</strong>
          </div>
          <div>
            <span>missing identity</span>
            <strong>{formatNumber(row.missing_identity)}</strong>
          </div>
        </div>
      ))}
    </div>
  )
}

function FailureTable({ rows }: { rows: VerificationFailure[] }) {
  if (rows.length === 0) {
    return <p className="empty">No palm scan failures in this range.</p>
  }

  return (
    <div className="tableShell">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Provider</th>
            <th>Failure</th>
            <th>Attempt</th>
            <th>Latency</th>
            <th>Request</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.event_time}-${row.request_id}-${row.session_id}`}>
              <td>{formatDate(row.event_time)}</td>
              <td>{row.provider || "unknown"}</td>
              <td>{row.provider_error_code || row.failure_code || "unknown"}</td>
              <td>{row.attempt_number || "-"}</td>
              <td>{row.latency_ms ? `${formatNumber(row.latency_ms)}ms` : "-"}</td>
              <td>{row.request_id || row.session_id || row.anonymous_id || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CommunityTable({ rows }: { rows: CommunityImportHealth[] }) {
  if (rows.length === 0) {
    return <p className="empty">No community import or provisioning events in this range.</p>
  }

  return (
    <div className="tableShell compact">
      <table>
        <thead>
          <tr>
            <th>Day</th>
            <th>TLD</th>
            <th>Create</th>
            <th>Provisioned</th>
            <th>Provision Fail</th>
            <th>Reddit Import</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.day}-${row.tld}`}>
              <td>{row.day}</td>
              <td>{row.tld}</td>
              <td>{formatNumber(row.community_create_started)}</td>
              <td>{formatNumber(row.provisioning_succeeded)}</td>
              <td>{formatNumber(row.provisioning_failed)}</td>
              <td>
                {formatNumber(row.reddit_import_succeeded)} / {formatNumber(row.reddit_import_started)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
