export class EngineStateStore {
    pools = new Map();
    auditLogs = [];
    getPoolId(tokenA, tokenB, feeBps) {
        const [t0, t1] = tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
        return `${t0}:${t1}:${feeBps}`;
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
