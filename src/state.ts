export interface SerializedPool {
  id: string;
  tokenA: string;
  tokenB: string;
  feeBps: number;
  reserveA: string;
  reserveB: string;
  totalLpSupply: string;
  lpBalances: Record<string, string>;
  createdAt: number;
  lastUpdatedAt: number;
  tradeCount: number;
}

export class EngineStateStore {
  private pools: Map<string, SerializedPool> = new Map();
  private auditLogs: Array<{ action: string; poolId: string; details: any; timestamp: number }> = [];

  /**
   * Generates a deterministic, canonical pool identifier independent of input order and case.
   * For EVM tokens, canonicalizes to lowercase and optionally prefixes chainId.
   * For non-EVM tokens, preserves case-sensitive addresses while ordering lexicographically.
   */
  public getPoolId(
    tokenA: string,
    tokenB: string,
    feeBps: number,
    chainId: number = 1,
    networkType: "evm" | "non-evm" = "evm"
  ): string {
    if (!tokenA || !tokenB || typeof tokenA !== "string" || typeof tokenB !== "string") {
      throw new Error("INVALID_TOKEN_IDENTIFIER: Tokens must be non-empty strings");
    }
    const isEvm = networkType === "evm";
    const canonA = isEvm ? tokenA.trim().toLowerCase() : tokenA.trim();
    const canonB = isEvm ? tokenB.trim().toLowerCase() : tokenB.trim();

    if (canonA === canonB) {
      throw new Error("AMM_IDENTICAL_ADDRESSES: Cannot create or query pool with identical assets");
    }

    const [t0, t1] = canonA < canonB ? [canonA, canonB] : [canonB, canonA];
    return isEvm && chainId !== 1 ? `eip155:${chainId}:${t0}:${t1}:${feeBps}` : `${t0}:${t1}:${feeBps}`;
  }

  public savePool(pool: SerializedPool): void {
    this.pools.set(pool.id, JSON.parse(JSON.stringify(pool)));
  }

  public getPool(poolId: string): SerializedPool | undefined {
    const p = this.pools.get(poolId);
    return p ? JSON.parse(JSON.stringify(p)) : undefined;
  }

  public hasPool(poolId: string): boolean {
    return this.pools.has(poolId);
  }

  public listPools(): SerializedPool[] {
    return Array.from(this.pools.values()).map(p => JSON.parse(JSON.stringify(p)));
  }

  public logAudit(action: string, poolId: string, details: any): void {
    this.auditLogs.push({
      action,
      poolId,
      details,
      timestamp: Date.now()
    });
  }

  public getAuditLogs(): any[] {
    return [...this.auditLogs];
  }
}
