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
    /**
     * Generates a deterministic, canonical pool identifier independent of input order and case.
     * For EVM tokens, canonicalizes to lowercase and optionally prefixes chainId.
     * For non-EVM tokens, preserves case-sensitive addresses while ordering lexicographically.
     */
    getPoolId(tokenA: string, tokenB: string, feeBps: number, chainId?: number, networkType?: "evm" | "non-evm"): string;
    savePool(pool: SerializedPool): void;
    getPool(poolId: string): SerializedPool | undefined;
    hasPool(poolId: string): boolean;
    listPools(): SerializedPool[];
    logAudit(action: string, poolId: string, details: any): void;
    getAuditLogs(): any[];
}
