function findCriticalExpectedPlaceholders(sourceCode) {
  const found = [];
  if (/contractAddress\s*:\s*["']0x0{40}["']/.test(sourceCode)) found.push("contractAddress");
  if (/pkpAddress\s*:\s*["']0x0{40}["']/.test(sourceCode)) found.push("pkpAddress");
  if (/pkpPublicKey\s*:\s*["']0x["']/.test(sourceCode)) found.push("pkpPublicKey");
  return found;
}

function scanModuleLinkages(sourceCode) {
  const transpiler = new Bun.Transpiler();
  const scanned = transpiler.scanImports(sourceCode);
  const links = scanned.map((entry) => ({
    kind: String(entry.kind || "import-statement"),
    path: String(entry.path || "")
  }));

  if (/^\s*export\s/m.test(sourceCode)) {
    links.push({ kind: "export-statement", path: "<inline>" });
  }

  if (/\bimport\s*\(/.test(sourceCode) && !links.some((entry) => entry.kind === "dynamic-import")) {
    links.push({ kind: "dynamic-import", path: "<non-literal>" });
  }

  return links;
}

function describeModuleLinks(links) {
  return links
    .slice(0, 5)
    .map((entry) => `${entry.kind}:${entry.path || "<unknown>"}`)
    .join(", ");
}

function assertNoModuleLinkage(sourceCode, contextLabel) {
  const links = scanModuleLinkages(sourceCode);
  if (links.length === 0) return;
  throw new Error(
    `${contextLabel} Lit Action source still contains module linkage (${describeModuleLinks(links)}); bundled payloads must be single-file`
  );
}

function parseOptionalPositiveInt(rawValue, label) {
  if (rawValue == null || !String(rawValue).trim()) return undefined;
  const parsed = Number(String(rawValue).trim());
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function sourceByteLength(sourceCode) {
  return new TextEncoder().encode(sourceCode).byteLength;
}

function formatBuildLog(log) {
  const prefix = log.position?.file
    ? `${log.position.file}:${log.position.line}:${log.position.column}`
    : "build";
  return `${prefix} ${log.level} ${log.message}`;
}

async function bundleLitActionSource(filePath, maxBytes) {
  const build = await Bun.build({
    entrypoints: [filePath],
    target: "browser",
    format: "esm",
    minify: false,
    splitting: false
  });

  if (!build.success) {
    const details = build.logs.map(formatBuildLog).join("\n");
    throw new Error(`failed to bundle Lit Action source:\n${details}`);
  }

  if (build.outputs.length !== 1) {
    throw new Error(`unexpected bundle output count: ${build.outputs.length}`);
  }

  let bundledSource = (await build.outputs[0].text()).replace(/\r\n/g, "\n");
  bundledSource = bundledSource.replace(/\nexport\s*\{[\s\S]*?\};?\s*$/m, "\n");
  assertNoModuleLinkage(bundledSource, "bundled");

  const bundledBytes = sourceByteLength(bundledSource);
  if (maxBytes != null && bundledBytes > maxBytes) {
    throw new Error(`bundled Lit Action exceeds max-bytes (${bundledBytes} > ${maxBytes})`);
  }

  return {
    sourceCode: bundledSource,
    sourceBytes: bundledBytes
  };
}

export {
  assertNoModuleLinkage,
  bundleLitActionSource,
  findCriticalExpectedPlaceholders,
  parseOptionalPositiveInt,
  sourceByteLength
};
