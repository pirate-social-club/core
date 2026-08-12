export type ChainHealthReading = {
  indexedHeight: number;
  externalTipHeight: number;
  newestAnchorHeight: number | null;
};

export type ChainHealthSnapshot = {
  ready: boolean;
  checking: boolean;
  indexed_height: number | null;
  external_tip_height: number | null;
  newest_anchor_height: number | null;
  tip_lag_blocks: number | null;
  anchor_lag_blocks: number | null;
  last_index_progress_at: string | null;
  last_checked_at: string | null;
  last_success_at: string | null;
  error: string | null;
};

export function parseExternalTipHeight(value: string): number {
  const height = Number(value.trim());
  if (!Number.isInteger(height) || height < 0) {
    throw new Error("independent Bitcoin tip endpoint returned an invalid height");
  }
  return height;
}

export class ChainHealthMonitor {
  private checking = false;
  private indexedHeight: number | null = null;
  private externalTipHeight: number | null = null;
  private newestAnchorHeight: number | null = null;
  private tipLagBlocks: number | null = null;
  private anchorLagBlocks: number | null = null;
  private lastIndexProgressAt: string | null = null;
  private lastCheckedAt: string | null = null;
  private lastSuccessAt: string | null = null;
  private error: string | null = "chain health has not been checked";

  constructor(
    private readonly maxTipLagBlocks: number,
    private readonly maxAnchorLagBlocks: number,
  ) {}

  async check(read: () => Promise<ChainHealthReading>, now = new Date()): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    const checkedAt = now.toISOString();
    this.lastCheckedAt = checkedAt;

    try {
      const reading = await read();
      if (this.indexedHeight == null || reading.indexedHeight > this.indexedHeight) {
        this.lastIndexProgressAt = checkedAt;
      }
      this.indexedHeight = reading.indexedHeight;
      this.externalTipHeight = reading.externalTipHeight;
      this.newestAnchorHeight = reading.newestAnchorHeight;
      this.tipLagBlocks = Math.max(0, reading.externalTipHeight - reading.indexedHeight);
      this.anchorLagBlocks = reading.newestAnchorHeight == null
        ? null
        : Math.max(0, reading.externalTipHeight - reading.newestAnchorHeight);
      this.lastSuccessAt = checkedAt;
      this.error = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.checking = false;
    }
  }

  snapshot(): ChainHealthSnapshot {
    const ready = this.error == null
      && this.tipLagBlocks != null
      && this.tipLagBlocks <= this.maxTipLagBlocks
      && this.anchorLagBlocks != null
      && this.anchorLagBlocks <= this.maxAnchorLagBlocks;

    return {
      ready,
      checking: this.checking,
      indexed_height: this.indexedHeight,
      external_tip_height: this.externalTipHeight,
      newest_anchor_height: this.newestAnchorHeight,
      tip_lag_blocks: this.tipLagBlocks,
      anchor_lag_blocks: this.anchorLagBlocks,
      last_index_progress_at: this.lastIndexProgressAt,
      last_checked_at: this.lastCheckedAt,
      last_success_at: this.lastSuccessAt,
      error: this.error,
    };
  }
}
