import type { AuthBootstrapStore, InsertDeviceSessionInput } from "./db";
import { buildSessionExchangeForUser } from "./auth-bootstrap-service";
import { conflictError, notFoundError } from "./errors";
import { createId } from "./ids";
import { verifyPirateAccessToken } from "./pirate-session-jwt";
import { nowIso } from "./time";
import type { Env } from "../types/env";
import type { DeviceSessionRow } from "../types/db";

type CreateDeviceSessionRequestBody = {
  client_name?: string | null;
  verification_origin?: string | null;
};

function randomUint32(): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] as number;
}

function randomCode(length: number, alphabet: string): string {
  let result = "";
  for (let i = 0; i < length; i += 1) {
    result += alphabet[randomUint32() % alphabet.length];
  }
  return result;
}

function randomHex(bytesLength: number): string {
  const bytes = new Uint8Array(bytesLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function addMinutes(now: Date, minutes: number): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

function serializeDeviceSessionPending(row: DeviceSessionRow, verificationUri: string) {
  return {
    device_session_id: row.device_session_id,
    device_code: row.device_code,
    user_code: row.user_code,
    verification_uri: verificationUri,
    status: row.status,
    expires_at: row.expires_at,
    interval_seconds: 5,
  };
}

export async function createDeviceSession(input: {
  requestBody: CreateDeviceSessionRequestBody;
  requestOrigin: string;
  store: AuthBootstrapStore;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const nowString = nowIso(now);
  const row: InsertDeviceSessionInput = {
    device_session_id: createId("dev_sess"),
    device_code: `dev_code_${randomHex(32)}`,
    user_code: `${randomCode(4, "ABCDEFGHJKLMNPQRSTUVWXYZ")}-${randomCode(4, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789")}`,
    authorized_user_id: null,
    status: "pending",
    client_name: input.requestBody.client_name ?? null,
    created_at: nowString,
    updated_at: nowString,
    expires_at: addMinutes(now, 15),
    authorized_at: null,
    completed_at: null,
  };

  await input.store.withTransaction(async (tx) => {
    await tx.insertDeviceSession(row);
  });

  const verificationOrigin = input.requestBody.verification_origin?.trim() || input.requestOrigin;
  const verificationUri = new URL(
    `/auth/device?user_code=${encodeURIComponent(row.user_code)}&device_session_id=${encodeURIComponent(row.device_session_id)}`,
    verificationOrigin,
  ).toString();

  return serializeDeviceSessionPending(row as DeviceSessionRow, verificationUri);
}

function requireDeviceSession(row: DeviceSessionRow | null): DeviceSessionRow {
  if (!row) {
    throw notFoundError("Device session not found");
  }
  return row;
}

function isExpired(row: DeviceSessionRow, now: Date): boolean {
  return Date.parse(row.expires_at) <= now.getTime();
}

function serializeDeviceSessionStatus(row: DeviceSessionRow, now: Date) {
  if (isExpired(row, now)) {
    return {
      device_session_id: row.device_session_id,
      status: "expired",
      expires_at: row.expires_at,
    };
  }

  return {
    device_session_id: row.device_session_id,
    status: row.status,
    expires_at: row.expires_at,
    authorized_at: row.authorized_at,
    completed_at: row.completed_at,
  };
}

export async function authorizeDeviceSession(input: {
  bearerToken: string;
  deviceSessionId: string;
  userCode: string;
  env: Env;
  store: AuthBootstrapStore;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const nowString = nowIso(now);
  const browserSession = await verifyPirateAccessToken(input.bearerToken, input.env);
  const row = requireDeviceSession(await input.store.getDeviceSessionById(input.deviceSessionId));

  if (isExpired(row, now)) {
    throw conflictError("Device session expired");
  }

  if (row.status !== "pending") {
    throw conflictError("Device session is no longer pending");
  }

  if (row.user_code !== input.userCode) {
    throw conflictError("User code does not match device session");
  }

  const updatedRow: InsertDeviceSessionInput = {
    ...row,
    authorized_user_id: browserSession.userId,
    status: "authorized",
    updated_at: nowString,
    authorized_at: nowString,
    completed_at: row.completed_at,
  };

  await input.store.withTransaction(async (tx) => {
    await tx.updateDeviceSession(updatedRow);
  });

  return {
    device_session_id: updatedRow.device_session_id,
    status: updatedRow.status,
    authorized_at: updatedRow.authorized_at,
    expires_at: updatedRow.expires_at,
  };
}

export async function getDeviceSession(input: {
  deviceSessionId: string;
  store: AuthBootstrapStore;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const row = requireDeviceSession(await input.store.getDeviceSessionById(input.deviceSessionId));

  return serializeDeviceSessionStatus(row, now);
}

export async function getDeviceSessionByDeviceCode(input: {
  deviceCode: string;
  store: AuthBootstrapStore;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const row = requireDeviceSession(await input.store.getDeviceSessionByDeviceCode(input.deviceCode));

  return serializeDeviceSessionStatus(row, now);
}

export async function claimDeviceSession(input: {
  deviceCode: string;
  env: Env;
  store: AuthBootstrapStore;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const nowString = nowIso(now);
  const row = requireDeviceSession(await input.store.getDeviceSessionByDeviceCode(input.deviceCode));

  if (isExpired(row, now)) {
    throw conflictError("Device session expired");
  }

  if (row.status === "authorized" && row.authorized_user_id) {
    const response = await buildSessionExchangeForUser({
      userId: row.authorized_user_id,
      env: input.env,
      store: input.store,
      now,
    });

    await input.store.withTransaction(async (tx) => {
      await tx.updateDeviceSession({
        ...row,
        status: "completed",
        updated_at: nowString,
        authorized_at: row.authorized_at,
        completed_at: nowString,
      });
    });

    return {
      device_session_id: row.device_session_id,
      status: "completed",
      completed_at: nowString,
      session: response,
    };
  }

  if (row.status === "completed" && row.authorized_user_id) {
    // Claim is intentionally idempotent in this slice so terminal clients can retry
    // safely after transport failures and still obtain a valid Pirate session.
    return {
      device_session_id: row.device_session_id,
      status: "completed",
      completed_at: row.completed_at,
      session: await buildSessionExchangeForUser({
        userId: row.authorized_user_id,
        env: input.env,
        store: input.store,
        now,
      }),
    };
  }

  throw conflictError("Device session is not ready to be claimed");
}
