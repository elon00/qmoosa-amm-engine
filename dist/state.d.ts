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
export declare class EngineStateStore {
    private pools;
    private auditLogs;
    getPoolId(tokenA: string, tokenB: string, feeBps: number): string;
    savePool(pool: SerializedPool): void;
    getPool(poolId: string): SerializedPool | undefined;
    hasPool(poolId: string): boolean;
    listPools(): SerializedPool[];
    logAudit(action: string, poolId: string, details: any): void;
    getAuditLogs(): any[];
}
