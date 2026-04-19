#!/usr/bin/env bun

import { Wallet } from "ethers"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const SECRET_NAMES = [
  "STORY_OPERATOR_PRIVATE_KEY",
  "STORY_CDR_WRITER_PRIVATE_KEY",
  "STORY_ACCESS_CONTROLLER_PRIVATE_KEY",
  "MUSIC_PURCHASE_STORY_SETTLEMENT_PRIVATE_KEY",
] as const

type SecretName = (typeof SECRET_NAMES)[number]

type CliOptions = {
  env: string
  path: string
  rotate: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    env: process.env.INFISICAL_ENV || "dev",
    path: "/services/api",
    rotate: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--env") {
      options.env = argv[index + 1] || options.env
      index += 1
      continue
    }
    if (arg === "--path") {
      options.path = argv[index + 1] || options.path
      index += 1
      continue
    }
    if (arg === "--rotate") {
      options.rotate = true
      continue
    }
    if (arg === "-h" || arg === "--help") {
      console.log([
        "Usage:",
        "  rtk bun scripts/story/provision-story-runtime-signers.ts [--env dev] [--path /services/api] [--rotate]",
        "",
        "By default this only creates missing direct Story signer keys in Infisical.",
        "Use --rotate to replace the existing keys with newly generated ones.",
      ].join("\n"))
      process.exit(0)
    }
    throw new Error(`unknown argument: ${arg}`)
  }

  return options
}

function runInfisical(args: string[], input?: string): string {
  const result = spawnSync("rtk", ["infisical", ...args], {
    input,
    encoding: "utf8",
  })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `infisical command failed: ${args.join(" ")}`)
  }
  return result.stdout
}

function listSecretNames(options: CliOptions): Set<string> {
  const output = runInfisical(["secrets", "--env", options.env, "--path", options.path, "-o", "json"])
  const parsed = JSON.parse(output) as { secrets?: Array<{ secretKey?: string; key?: string; name?: string }> } | Array<{ secretKey?: string; key?: string; name?: string }>
  const secrets = Array.isArray(parsed) ? parsed : parsed.secrets || []
  return new Set(
    secrets
      .map((secret) => secret.secretKey || secret.key || secret.name || "")
      .filter(Boolean),
  )
}

async function setSecret(options: CliOptions, name: SecretName, value: string): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "pirate-story-signer-"))
  const tempFile = join(tempDir, `${name}.txt`)
  try {
    await writeFile(tempFile, value, { mode: 0o600 })
    runInfisical(["secrets", "set", "--env", options.env, "--path", options.path, `${name}=@${tempFile}`])
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const existing = listSecretNames(options)
  const created: Array<{ name: SecretName; address: string; mode: "created" | "rotated" }> = []
  const retained: SecretName[] = []

  for (const name of SECRET_NAMES) {
    if (!options.rotate && existing.has(name)) {
      retained.push(name)
      continue
    }
    const wallet = Wallet.createRandom()
    await setSecret(options, name, wallet.privateKey)
    created.push({
      name,
      address: wallet.address,
      mode: existing.has(name) ? "rotated" : "created",
    })
  }

  console.log(`Story runtime signer provisioning complete for env=${options.env} path=${options.path}`)
  if (created.length > 0) {
    for (const item of created) {
      console.log(`${item.mode}: ${item.name} -> ${item.address}`)
    }
  } else {
    console.log("no changes: all direct signer secrets already exist")
  }
  if (retained.length > 0) {
    for (const name of retained) {
      console.log(`retained: ${name}`)
    }
  }
}

await main()
