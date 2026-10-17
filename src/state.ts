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

  public getPoolId(tokenA: string, tokenB: string, feeBps: number): string {
    const [t0, t1] = tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
    return `${t0}:${t1}:${feeBps}`;
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
