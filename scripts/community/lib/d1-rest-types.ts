export type D1DatabaseTarget = {
  name: string
  id: string
}

export type D1QueryResult = {
  results?: unknown[]
  success?: boolean
  meta?: Record<string, unknown>
}

export type D1ApiError = {
  code?: number | string
  message?: string
}

export type D1ApiEnvelope = {
  success?: boolean
  errors?: D1ApiError[]
  result?: D1QueryResult[]
}

export type D1QueryMetrics = {
  logical_batches: number
  statements_submitted: number
  http_attempts: number
  retries: number
  errors_by_code: Record<string, number>
  cumulative_http_attempt_duration_ms: number
}

export type D1RestClient = {
  accountId: string
  apiToken: string
  fetch: typeof fetch
  sleep: (milliseconds: number) => Promise<void>
  metrics?: D1QueryMetrics
}

export type D1ProbeResult = {
  row: Record<string, number>
  inventoryRows: D1SchemaObjectRow[]
}

export type D1SchemaObjectRow = { type: "index" | "table"; name: string; sql: string | null }

export type D1ProbeRunner = (statements: string[]) => Promise<D1QueryResult[]>
