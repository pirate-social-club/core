import type { Job } from "../types/api";
import type { JobRow } from "../types/db";

export function serializeJob(row: JobRow): Job {
  return {
    job_id: row.job_id,
    job_type: row.job_type,
    status: row.status,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    result_ref: row.result_ref,
    error_code: row.error_code,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
