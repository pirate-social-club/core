import { timingSafeEqual } from "node:crypto";
import type { ErrorShape } from "../types/api";
import { ApiError } from "../lib/errors";

export type JsonResponse<T> = {
  status: number;
  body: T;
};

export type RequestLike = {
  json(): Promise<unknown>;
  headers: Headers;
  url: string;
};

export function ok<T>(body: T): JsonResponse<T> {
  return {
    status: 200,
    body,
  };
}

export function toErrorResponse(error: unknown): JsonResponse<ErrorShape> {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: error.body,
    };
  }

  return {
    status: 500,
    body: {
      code: "internal_error",
      message: "Internal error",
      retryable: false,
    },
  };
}

export function requireBearerToken(request: RequestLike): string {
  const value = request.headers.get("authorization");
  if (!value || !value.startsWith("Bearer ")) {
    throw new ApiError(401, {
      code: "auth_error",
      message: "Authentication failed",
      retryable: false,
    });
  }

  return value.slice("Bearer ".length);
}

export function requireSharedSecretBearerToken(request: RequestLike, expectedToken: string | undefined): void {
  const value = request.headers.get("authorization");
  const presentedToken = value?.startsWith("Bearer ") ? value.slice("Bearer ".length) : null;
  const matches =
    expectedToken != null &&
    presentedToken != null &&
    Buffer.byteLength(expectedToken) === Buffer.byteLength(presentedToken) &&
    timingSafeEqual(Buffer.from(presentedToken), Buffer.from(expectedToken));

  if (!matches) {
    throw new ApiError(401, {
      code: "auth_error",
      message: "Authentication failed",
      retryable: false,
    });
  }
}
