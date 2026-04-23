import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

function defaultApiContractsDir(): string {
  if (existsSync("pirate-api/services/contracts")) {
    return "pirate-api/services/contracts";
  }
  if (existsSync("../../pirate-api/services/contracts")) {
    return "../../pirate-api/services/contracts";
  }
  return "pirate-api/services/contracts";
}

const API_CONTRACTS_DIR = process.env.API_CONTRACTS_DIR || defaultApiContractsDir();
const tsc = `${API_CONTRACTS_DIR}/node_modules/.bin/tsc`;
const tsconfig = `${API_CONTRACTS_DIR}/tsconfig.json`;

const result = spawnSync(tsc, ["--noEmit", "-p", tsconfig], {
  cwd: process.cwd(),
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
