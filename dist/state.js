export class EngineStateStore {
    pools = new Map();
    auditLogs = [];
    /**
     * Generates a deterministic, canonical pool identifier independent of input order and case.
     * For EVM tokens, canonicalizes to lowercase and optionally prefixes chainId.
     * For non-EVM tokens, preserves case-sensitive addresses while ordering lexicographically.
     */
    getPoolId(tokenA, tokenB, feeBps, chainId = 1, networkType = "evm") {
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
    savePool(pool) {
        this.pools.set(pool.id, JSON.parse(JSON.stringify(pool)));
    }
    getPool(poolId) {
        const p = this.pools.get(poolId);
        return p ? JSON.parse(JSON.stringify(p)) : undefined;
    }
    hasPool(poolId) {
        return this.pools.has(poolId);
    }
    listPools() {
        return Array.from(this.pools.values()).map(p => JSON.parse(JSON.stringify(p)));
    }
    logAudit(action, poolId, details) {
        this.auditLogs.push({
            action,
            poolId,
            details,
            timestamp: Date.now()
        });
    }
    getAuditLogs() {
        return [...this.auditLogs];
    }
}
