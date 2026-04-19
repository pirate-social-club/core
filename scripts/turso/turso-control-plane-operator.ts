#!/usr/bin/env bun

import {
  createTursoControlPlaneOperatorHandler,
  resolveOperatorHost,
  resolveOperatorPort,
  type TursoControlPlaneOperatorEnv,
} from "../lib/turso-control-plane-operator";

function requireEnv(name: keyof TursoControlPlaneOperatorEnv): string {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    console.error(`missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function requirePositiveIntEnv(name: keyof TursoControlPlaneOperatorEnv): void {
  const raw = requireEnv(name);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.error(`${name} must be a positive integer`);
    process.exit(1);
  }
}

const env = process.env as TursoControlPlaneOperatorEnv;

requireEnv("CONTROL_PLANE_DATABASE_URL");
requireEnv("TURSO_PLATFORM_API_TOKEN");
requireEnv("TURSO_ORGANIZATION_SLUG");
requireEnv("TURSO_COMMUNITY_DB_WRAP_KEY");
requireEnv("COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN");
requirePositiveIntEnv("TURSO_COMMUNITY_DB_WRAP_KEY_VERSION");

const hostname = resolveOperatorHost(env);
const port = resolveOperatorPort(env);

Bun.serve({
  hostname,
  port,
  fetch: createTursoControlPlaneOperatorHandler(env),
});

console.log(`community provision operator listening on http://${hostname}:${port}`);
