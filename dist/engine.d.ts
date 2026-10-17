import { EngineStateStore, SerializedPool } from "./state.js";
export declare function sqrtBigInt(n: bigint): bigint;
export declare class AmmEngine {
    store: EngineStateStore;
    constructor(store?: EngineStateStore);
    createPool(tokenA: string, tokenB: string, initialAmountA: bigint, initialAmountB: bigint, creator: string, feeBps?: number): {
        poolId: string;
        lpTokensMinted: bigint;
    };
    swap(poolId: string, tokenIn: string, amountIn: bigint, minAmountOut: bigint, recipient: string, deadline: number): {
        amountOut: bigint;
        feeAmount: bigint;
        pool: SerializedPool;
    };
    addLiquidity(poolId: string, amountADesired: bigint, amountBDesired: bigint, amountAMin: bigint, amountBMin: bigint, provider: string, deadline: number): {
        amountA: bigint;
        amountB: bigint;
        refundA: bigint;
        refundB: bigint;
        lpTokensMinted: bigint;
        pool: SerializedPool;
    };
    removeLiquidity(poolId: string, lpTokensToBurn: bigint, amountAMin: bigint, amountBMin: bigint, provider: string, deadline: number): {
        amountA: bigint;
        amountB: bigint;
        pool: SerializedPool;
    };
}
