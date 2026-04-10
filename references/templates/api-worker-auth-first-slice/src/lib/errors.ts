import type { ErrorShape } from "../types/api";

export class ApiError extends Error {
  public readonly status: number;
  public readonly body: ErrorShape;

  constructor(status: number, body: ErrorShape) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

export function authError(message = "Authentication failed"): ApiError {
  return new ApiError(401, {
    code: "auth_error",
    message,
    retryable: false,
  });
}

export function badRequestError(message = "Bad request"): ApiError {
  return new ApiError(400, {
    code: "bad_request",
    message,
    retryable: false,
  });
}

export function verificationRequired(message = "Verification required"): ApiError {
  return new ApiError(403, {
    code: "verification_required",
    message,
    retryable: false,
  });
}

export function eligibilityFailed(message = "Eligibility failed"): ApiError {
  return new ApiError(403, {
    code: "eligibility_failed",
    message,
    retryable: false,
  });
}

export function gateFailed(message = "Gate failed", retryable = false): ApiError {
  return new ApiError(403, {
    code: "gate_failed",
    message,
    retryable,
  });
}

export function conflictError(message = "Conflict"): ApiError {
  return new ApiError(409, {
    code: "conflict",
    message,
    retryable: false,
  });
}

export function notFoundError(message = "Not found"): ApiError {
  return new ApiError(404, {
    code: "not_found",
    message,
    retryable: false,
  });
}

export function notImplementedError(message = "Not implemented"): ApiError {
  return new ApiError(501, {
    code: "internal_error",
    message,
    retryable: false,
  });
}

export function rateLimitedError(message = "Rate limited"): ApiError {
  return new ApiError(429, {
    code: "rate_limited",
    message,
    retryable: true,
  });
}

export function internalError(message = "Internal error"): ApiError {
  return new ApiError(500, {
    code: "internal_error",
    message,
    retryable: false,
  });
}
