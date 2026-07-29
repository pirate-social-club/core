CREATE SCHEMA IF NOT EXISTS promotion_shadow;

CREATE SEQUENCE promotion_shadow.fencing_sequence AS bigint START 1;

CREATE TABLE promotion_shadow.schema_metadata (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  installed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO promotion_shadow.schema_metadata (schema_version) VALUES (1);

CREATE TABLE promotion_shadow.candidates (
  candidate_id TEXT PRIMARY KEY CHECK (candidate_id ~ '^shc_'),
  web_sha TEXT NOT NULL,
  api_sha TEXT NOT NULL,
  core_sha TEXT NOT NULL,
  manifest JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE promotion_shadow.promoter_leases (
  lane TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  fencing_epoch BIGINT NOT NULL CHECK (fencing_epoch > 0),
  fencing_token BIGINT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (fencing_epoch, fencing_token),
  CONSTRAINT promoter_leases_expiry_after_acquisition
    CHECK (expires_at > acquired_at)
);

CREATE TABLE promotion_shadow.attempt_counters (
  candidate_id TEXT NOT NULL REFERENCES promotion_shadow.candidates(candidate_id) ON DELETE CASCADE,
  gate_id TEXT NOT NULL,
  gate_version INTEGER NOT NULL CHECK (gate_version > 0),
  next_attempt_no INTEGER NOT NULL DEFAULT 1 CHECK (next_attempt_no > 0),
  PRIMARY KEY (candidate_id, gate_id, gate_version)
);

CREATE TABLE promotion_shadow.gate_deliveries (
  delivery_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES promotion_shadow.candidates(candidate_id) ON DELETE CASCADE,
  gate_id TEXT NOT NULL,
  gate_version INTEGER NOT NULL CHECK (gate_version > 0),
  source_run_id TEXT NOT NULL,
  source_run_attempt INTEGER NOT NULL CHECK (source_run_attempt > 0),
  classified_as TEXT NOT NULL CHECK (classified_as IN ('attempt', 'observation')),
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (candidate_id, gate_id, gate_version, source_run_id, source_run_attempt),
  UNIQUE (delivery_id, candidate_id, gate_id, gate_version, classified_as)
);

CREATE TABLE promotion_shadow.attestation_attempts (
  attempt_id TEXT PRIMARY KEY,
  delivery_id TEXT UNIQUE,
  delivery_kind TEXT NOT NULL DEFAULT 'attempt' CHECK (delivery_kind = 'attempt'),
  candidate_id TEXT NOT NULL REFERENCES promotion_shadow.candidates(candidate_id) ON DELETE CASCADE,
  gate_id TEXT NOT NULL,
  gate_version INTEGER NOT NULL CHECK (gate_version > 0),
  attempt_no INTEGER NOT NULL CHECK (attempt_no > 0),
  status TEXT NOT NULL CHECK (status IN ('running', 'terminal')),
  result TEXT CHECK (result IN ('pass', 'fail', 'inconclusive')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (candidate_id, gate_id, gate_version, attempt_no),
  FOREIGN KEY (delivery_id, candidate_id, gate_id, gate_version, delivery_kind)
    REFERENCES promotion_shadow.gate_deliveries (
      delivery_id, candidate_id, gate_id, gate_version, classified_as
    ),
  CONSTRAINT attestation_attempts_terminal_result
    CHECK ((status = 'terminal') = (result IS NOT NULL)),
  CONSTRAINT attestation_attempts_terminal_completion
    CHECK ((status = 'terminal') = (completed_at IS NOT NULL)),
  CONSTRAINT attestation_attempts_completion_order
    CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE UNIQUE INDEX attestation_attempt_single_flight
  ON promotion_shadow.attestation_attempts (candidate_id, gate_id, gate_version)
  WHERE status = 'running';

CREATE TABLE promotion_shadow.gate_observations (
  observation_id TEXT PRIMARY KEY,
  delivery_id TEXT UNIQUE NOT NULL,
  delivery_kind TEXT NOT NULL DEFAULT 'observation' CHECK (delivery_kind = 'observation'),
  candidate_id TEXT NOT NULL REFERENCES promotion_shadow.candidates(candidate_id) ON DELETE CASCADE,
  gate_id TEXT NOT NULL,
  gate_version INTEGER NOT NULL CHECK (gate_version > 0),
  observation TEXT NOT NULL CHECK (observation IN ('absent', 'skipped')),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (delivery_id, candidate_id, gate_id, gate_version, delivery_kind)
    REFERENCES promotion_shadow.gate_deliveries (
      delivery_id, candidate_id, gate_id, gate_version, classified_as
    )
);

CREATE TABLE promotion_shadow.shadow_decisions (
  decision_id TEXT PRIMARY KEY,
  candidate_id TEXT REFERENCES promotion_shadow.candidates(candidate_id) ON DELETE SET NULL,
  scenario TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (
    decision IN ('admitted', 'superseded', 'blocked', 'halted')
  ),
  hypothetical_deployed_sha TEXT,
  decided_at TIMESTAMPTZ NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE promotion_shadow.promotion_anomalies (
  anomaly_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  candidate_id TEXT REFERENCES promotion_shadow.candidates(candidate_id) ON DELETE SET NULL,
  gate_id TEXT,
  gate_version INTEGER CHECK (gate_version > 0),
  attempt_no INTEGER CHECK (attempt_no > 0),
  detected_by TEXT NOT NULL,
  fencing_token BIGINT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb
);
