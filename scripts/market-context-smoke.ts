import { hasFlag, readArg, runMarketContextHarness } from "./market-context-harness";

async function main() {
  const url = readArg("--url");
  if (!url) {
    throw new Error("Usage: bun scripts/market-context-smoke.ts --url <article-url> [--title <post-title>]");
  }

  const title = readArg("--title");
  const verbose = hasFlag("--verbose");

  const output = await runMarketContextHarness({
    url,
    title,
    verbose,
  });

  console.log(JSON.stringify(output, null, 2));
}

void main();
