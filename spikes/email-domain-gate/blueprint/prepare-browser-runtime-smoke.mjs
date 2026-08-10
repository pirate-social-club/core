#!/usr/bin/env bun

import { execFile } from "node:child_process"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("usage: prepare-browser-runtime-smoke.mjs --python <path> --out-dir <path>")
    }
    values.set(key.slice(2), value)
  }
  if (!values.get("python") || !values.get("out-dir")) {
    throw new Error("usage: prepare-browser-runtime-smoke.mjs --python <path> --out-dir <path>")
  }
  return {
    python: resolve(values.get("python")),
    outputDirectory: resolve(values.get("out-dir")),
  }
}

const { python, outputDirectory } = parseArguments(process.argv.slice(2))
await mkdir(outputDirectory, { recursive: true, mode: 0o700 })
await chmod(outputDirectory, 0o700)

const emailPath = join(outputDirectory, "synthetic.eml")
const evidencePath = join(outputDirectory, "synthetic.crypto.json")
const dnsPath = join(outputDirectory, "synthetic.dns.json")
try {
  await execFileAsync(python, [
    resolve(import.meta.dir, "../synthetic-adapter-evidence.py"),
    "--email-out", emailPath,
    "--evidence-out", evidencePath,
    "--dns-out", dnsPath,
  ], { maxBuffer: 1024 * 1024 })
} catch {
  throw new Error("synthetic browser fixture generation failed")
}

const build = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "browser-runtime-smoke-entry.mjs")],
  outdir: outputDirectory,
  naming: "smoke.js",
  target: "browser",
  plugins: [{
    name: "browser-node-crypto",
    setup(builder) {
      builder.onResolve({ filter: /^crypto$/ }, () => ({
        path: fileURLToPath(import.meta.resolve("crypto-browserify")),
      }))
      builder.onResolve({ filter: /^stream$/ }, () => ({
        path: fileURLToPath(import.meta.resolve("stream-browserify")),
      }))
    },
  }],
})
if (!build.success) throw new Error("browser smoke bundle failed")

const rawEmail = await readFile(emailPath)
const verifierResult = JSON.parse(await readFile(evidencePath, "utf8"))
const { record } = JSON.parse(await readFile(dnsPath, "utf8"))
const bundle = (await readFile(join(outputDirectory, "smoke.js"), "utf8"))
  .replace(/<\/script/gi, "<\\/script")
const fixture = {
  email_base64: rawEmail.toString("base64"),
  dns_record: record,
  observed_at_unix: verifierResult.observed_at_unix,
}
const html = [
  "<!doctype html>",
  '<meta charset="utf-8">',
  "<title>Email-domain browser adapter smoke</title>",
  "<body>pending</body>",
  `<script>globalThis.global ??= globalThis;globalThis.setImmediate ??= (callback, ...args) => setTimeout(callback, 0, ...args);globalThis.clearImmediate ??= clearTimeout;globalThis.__EMAIL_DOMAIN_SMOKE_FIXTURE__=${JSON.stringify(fixture)}</script>`,
  `<script type="module">${bundle}</script>`,
].join("\n")
const htmlPath = join(outputDirectory, "index.html")
await writeFile(htmlPath, html, { encoding: "utf8", mode: 0o600 })
await chmod(htmlPath, 0o600)
process.stdout.write(`${htmlPath}\n`)
