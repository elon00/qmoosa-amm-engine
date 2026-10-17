import {
  AmmError,
  InsufficientLiquidityError,
  ExcessiveSlippageError,
  DeadlineExpiredError,
  ZeroAmountError,
  PoolNotFoundError,
  InvariantViolationError
} from "./errors.js";
import { EngineStateStore, SerializedPool } from "./state.js";

const BPS_DIVISOR = 10000n;
const MINIMUM_LIQUIDITY = 1000n;

export function sqrtBigInt(n: bigint): bigint {
  if (n < 0n) throw new Error("Negative square root");
  if (n < 2n) return n;
  let x0 = n / 2n;
  let x1 = (x0 + n / x0) / 2n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + n / x0) / 2n;
  }
  return x0;
}

export class AmmEngine {
  public store: EngineStateStore;

  constructor(store?: EngineStateStore) {
    this.store = store || new EngineStateStore();
  }

  public createPool(
    tokenA: string,
    tokenB: string,
    initialAmountA: bigint,
    initialAmountB: bigint,
    creator: string,
    feeBps: number = 30
  ): { poolId: string; lpTokensMinted: bigint } {
    if (tokenA.toLowerCase() === tokenB.toLowerCase()) {
      throw new AmmError("AMM_IDENTICAL_ADDRESSES", "Cannot create pool with identical token addresses");
    }
    if (initialAmountA <= 0n || initialAmountB <= 0n) {
      throw new ZeroAmountError("initialAmount");
    }

    const poolId = this.store.getPoolId(tokenA, tokenB, feeBps);
    if (this.store.hasPool(poolId)) {
      throw new AmmError("AMM_POOL_ALREADY_EXISTS", `Pool ${poolId} already exists`);
    }

    const isTokenAFirst = tokenA.toLowerCase() < tokenB.toLowerCase();
    const [normTokenA, normTokenB] = isTokenAFirst ? [tokenA, tokenB] : [tokenB, tokenA];
    const [normReserveA, normReserveB] = isTokenAFirst ? [initialAmountA, initialAmountB] : [initialAmountB, initialAmountA];

    const root = sqrtBigInt(normReserveA * normReserveB);
    if (root <= MINIMUM_LIQUIDITY) {
      throw new InsufficientLiquidityError("Initial liquidity too low to lock minimum shares");
    }

    const userLp = root - MINIMUM_LIQUIDITY;

    const pool: SerializedPool = {
      id: poolId,
      tokenA: normTokenA,
      tokenB: normTokenB,
      feeBps,
      reserveA: normReserveA.toString(),
      reserveB: normReserveB.toString(),
      totalLpSupply: root.toString(),
      lpBalances: {
        "0x0000000000000000000000000000000000000000": MINIMUM_LIQUIDITY.toString(),
        [creator.toLowerCase()]: userLp.toString()
      },
      createdAt: Date.now(),
      lastUpdatedAt: Date.now(),
      tradeCount: 0
    };

    this.store.savePool(pool);
    this.store.logAudit("CREATE_POOL", poolId, { creator, initialAmountA: initialAmountA.toString(), initialAmountB: initialAmountB.toString() });

    return { poolId, lpTokensMinted: userLp };
  }

  public swap(
    poolId: string,
    tokenIn: string,
    amountIn: bigint,
    minAmountOut: bigint,
    recipient: string,
    deadline: number
  ): { amountOut: bigint; feeAmount: bigint; pool: SerializedPool } {
    if (Date.now() > deadline) {
      throw new DeadlineExpiredError(deadline, Date.now());
    }
    if (amountIn <= 0n) {
      throw new ZeroAmountError("amountIn");
    }

    const pool = this.store.getPool(poolId);
    if (!pool) {
      throw new PoolNotFoundError(poolId);
    }

    const isTokenAIn = tokenIn.toLowerCase() === pool.tokenA.toLowerCase();
    const isTokenBIn = tokenIn.toLowerCase() === pool.tokenB.toLowerCase();
    if (!isTokenAIn && !isTokenBIn) {
      throw new AmmError("AMM_INVALID_TOKEN", `Token ${tokenIn} not present in pool ${poolId}`);
    }

    let reserveIn = BigInt(isTokenAIn ? pool.reserveA : pool.reserveB);
    let reserveOut = BigInt(isTokenAIn ? pool.reserveB : pool.reserveA);

    const feeMultiplier = BPS_DIVISOR - BigInt(pool.feeBps);
    const amountInWithFee = amountIn * feeMultiplier;
    const numerator = amountInWithFee * reserveOut;
    const denominator = (reserveIn * BPS_DIVISOR) + amountInWithFee;
    const amountOut = numerator / denominator;

    if (amountOut <= 0n) {
      throw new InsufficientLiquidityError("Trade output calculates to zero");
    }
    if (amountOut < minAmountOut) {
      throw new ExcessiveSlippageError(minAmountOut.toString(), amountOut.toString());
    }

    const feeAmount = (amountIn * BigInt(pool.feeBps)) / BPS_DIVISOR;

    const newReserveIn = reserveIn + amountIn;
    const newReserveOut = reserveOut - amountOut;

    // Strict K Invariant Verification
    const kBefore = reserveIn * reserveOut;
    const kAfter = newReserveIn * newReserveOut;
    if (kAfter < kBefore) {
      throw new InvariantViolationError(kBefore.toString(), kAfter.toString());
    }

    if (isTokenAIn) {
      pool.reserveA = newReserveIn.toString();
      pool.reserveB = newReserveOut.toString();
    } else {
      pool.reserveB = newReserveIn.toString();
      pool.reserveA = newReserveOut.toString();
    }

    pool.tradeCount += 1;
    pool.lastUpdatedAt = Date.now();

    this.store.savePool(pool);
    this.store.logAudit("SWAP", poolId, {
      tokenIn,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      feeAmount: feeAmount.toString(),
      recipient
    });

    return { amountOut, feeAmount, pool };
  }

  public addLiquidity(
    poolId: string,
    amountA: bigint,
    amountB: bigint,
    minLp: bigint,
    provider: string,
    deadline: number
  ): { lpTokensMinted: bigint; pool: SerializedPool } {
    if (Date.now() > deadline) {
      throw new DeadlineExpiredError(deadline, Date.now());
    }
    if (amountA <= 0n || amountB <= 0n) {
      throw new ZeroAmountError("amount");
    }

    const pool = this.store.getPool(poolId);
    if (!pool) {
      throw new PoolNotFoundError(poolId);
    }

    const rA = BigInt(pool.reserveA);
    const rB = BigInt(pool.reserveB);
    const totalLp = BigInt(pool.totalLpSupply);

    const lpA = (amountA * totalLp) / rA;
    const lpB = (amountB * totalLp) / rB;
    const lpToMint = lpA < lpB ? lpA : lpB;

    if (lpToMint < minLp) {
      throw new ExcessiveSlippageError(minLp.toString(), lpToMint.toString());
    }

    pool.reserveA = (rA + amountA).toString();
    pool.reserveB = (rB + amountB).toString();
    pool.totalLpSupply = (totalLp + lpToMint).toString();

    const provKey = provider.toLowerCase();
    const curBalance = BigInt(pool.lpBalances[provKey] || "0");
    pool.lpBalances[provKey] = (curBalance + lpToMint).toString();
    pool.lastUpdatedAt = Date.now();

    this.store.savePool(pool);
    this.store.logAudit("ADD_LIQUIDITY", poolId, { provider, amountA: amountA.toString(), amountB: amountB.toString(), lpToMint: lpToMint.toString() });

    return { lpTokensMinted: lpToMint, pool };
  }
}
