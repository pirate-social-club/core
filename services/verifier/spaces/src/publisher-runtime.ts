export type PublisherExecutionConfig =
  | { mode: "binary"; command: string[] }
  | { mode: "go_dev_fallback"; command: string[] };

export class FabricRecordReaderUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FabricRecordReaderUnavailableError";
  }
}

export function resolvePublisherExecutionConfig(input: {
  publisherBin: string | null;
}): PublisherExecutionConfig {
  return input.publisherBin
    ? { mode: "binary", command: [input.publisherBin] }
    : { mode: "go_dev_fallback", command: ["go", "run", "."] };
}

export async function runPublisher(
  config: PublisherExecutionConfig,
  args: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<{ stdout: string; stderr: string }> {
  let result: ReturnType<typeof Bun.spawn>;
  try {
    result = Bun.spawn([...config.command, ...args], {
      cwd: options.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    throw new FabricRecordReaderUnavailableError(
      `failed to start Spaces Fabric record reader in ${config.mode} mode`,
      { cause: error },
    );
  }

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    try {
      result.kill();
    } catch {
      // best effort timeout cleanup
    }
  }, options.timeoutMs);

  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      result.exited,
      new Response(result.stdout).text(),
      new Response(result.stderr).text(),
    ]);
    const normalizedStdout = stdout.trim();
    const normalizedStderr = stderr.trim();
    if (timedOut || exitCode !== 0) {
      throw new FabricRecordReaderUnavailableError(
        timedOut
          ? `Spaces Fabric record reader timed out after ${options.timeoutMs}ms`
          : normalizedStderr || normalizedStdout || "Spaces Fabric record reader exited unsuccessfully",
      );
    }
    return { stdout: normalizedStdout, stderr: normalizedStderr };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function probePublisher(
  config: PublisherExecutionConfig,
  options: { cwd: string; timeoutMs: number; args?: string[] },
): Promise<{ ready: boolean; error: string | null }> {
  try {
    await runPublisher(config, options.args ?? ["help"], options);
    return { ready: true, error: null };
  } catch (error) {
    return {
      ready: false,
      error: error instanceof Error ? error.message : "Spaces Fabric record reader unavailable",
    };
  }
}
