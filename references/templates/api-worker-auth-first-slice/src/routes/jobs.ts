import type { Env } from "../types/env";
import type { AuthBootstrapStore } from "../lib/db";
import { serializeJob } from "../lib/job-serializer";
import { notFoundError } from "../lib/errors";
import { verifyPirateAccessToken } from "../lib/pirate-session-jwt";
import type { JsonResponse, RequestLike } from "./http";
import { ok, requireBearerToken, toErrorResponse } from "./http";

export async function getJobById(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
  jobId: string;
}): Promise<JsonResponse<unknown>> {
  try {
    const token = requireBearerToken(input.request);
    await verifyPirateAccessToken(token, input.env);
    const row = await input.store.getJobById(input.jobId);
    if (!row) {
      throw notFoundError("Job not found");
    }

    return ok(serializeJob(row));
  } catch (error) {
    return toErrorResponse(error);
  }
}
