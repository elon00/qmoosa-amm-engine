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
const MIN_FEE_BPS = 1;
const MAX_FEE_BPS = 1000;

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
    feeBps: number = 30,
    chainId: number = 1,
    networkType: "evm" | "non-evm" = "evm"
  ): { poolId: string; lpTokensMinted: bigint } {
    if (!tokenA || !tokenB || typeof tokenA !== "string" || typeof tokenB !== "string") {
      throw new AmmError("AMM_INVALID_TOKEN", "Tokens must be non-empty strings");
    }
    const isEvm = networkType === "evm";
    const canonA = isEvm ? tokenA.trim().toLowerCase() : tokenA.trim();
    const canonB = isEvm ? tokenB.trim().toLowerCase() : tokenB.trim();

    if (canonA === canonB) {
      throw new AmmError("AMM_IDENTICAL_ADDRESSES", "Cannot create pool with identical token identifiers");
    }
    if (!Number.isInteger(feeBps) || feeBps < MIN_FEE_BPS || feeBps > MAX_FEE_BPS) {
      throw new AmmError("AMM_INVALID_FEE_BPS", `feeBps must be an integer between ${MIN_FEE_BPS} and ${MAX_FEE_BPS}`);
    }
    if (initialAmountA <= 0n || initialAmountB <= 0n) {
      throw new ZeroAmountError("initialAmount");
    }

    const isTokenAFirst = canonA < canonB;
    const [normTokenA, normTokenB] = isTokenAFirst ? [canonA, canonB] : [canonB, canonA];
    const [normReserveA, normReserveB] = isTokenAFirst ? [initialAmountA, initialAmountB] : [initialAmountB, initialAmountA];

    const poolId = this.store.getPoolId(normTokenA, normTokenB, feeBps, chainId, networkType);
    if (this.store.hasPool(poolId)) {
      throw new AmmError("AMM_POOL_ALREADY_EXISTS", `Pool ${poolId} already exists`);
    }

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

    const rawPool = this.store.getPool(poolId);
    if (!rawPool) {
      throw new PoolNotFoundError(poolId);
    }

    // Atomic working copy - state will only commit if all invariants hold
    const pool = JSON.parse(JSON.stringify(rawPool)) as SerializedPool;

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

    // Strict K Invariant Verification (Must never decrease)
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

    // Commit state atomically
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
    amountADesired: bigint,
    amountBDesired: bigint,
    amountAMin: bigint,
    amountBMin: bigint,
    provider: string,
    deadline: number
  ): { amountA: bigint; amountB: bigint; refundA: bigint; refundB: bigint; lpTokensMinted: bigint; pool: SerializedPool } {
    if (Date.now() > deadline) {
      throw new DeadlineExpiredError(deadline, Date.now());
    }
    // 1. Strict positive desired amounts
    if (amountADesired <= 0n || amountBDesired <= 0n) {
      throw new ZeroAmountError("amountDesired");
    }
    // 2. Strict non-negative and valid minimum thresholds
    if (amountAMin < 0n || amountBMin < 0n) {
      throw new ZeroAmountError("amountMin");
    }
    if (amountAMin > amountADesired) {
      throw new ExcessiveSlippageError(amountADesired.toString(), amountAMin.toString());
    }
    if (amountBMin > amountBDesired) {
      throw new ExcessiveSlippageError(amountBDesired.toString(), amountBMin.toString());
    }

    const rawPool = this.store.getPool(poolId);
    if (!rawPool) {
      throw new PoolNotFoundError(poolId);
    }

    const pool = JSON.parse(JSON.stringify(rawPool)) as SerializedPool;

    const rA = BigInt(pool.reserveA);
    const rB = BigInt(pool.reserveB);
    const totalLp = BigInt(pool.totalLpSupply);

    if (rA <= 0n || rB <= 0n || totalLp <= 0n) {
      throw new InsufficientLiquidityError("Pool reserves or total LP supply exhausted");
    }

    // Compute optimal deposit enforcing pool ratio and refunding excess
    let actualA: bigint;
    let actualB: bigint;
    let refundA = 0n;
    let refundB = 0n;

    const amountBOptimal = (amountADesired * rB) / rA;
    if (amountBOptimal <= amountBDesired) {
      actualA = amountADesired;
      actualB = amountBOptimal;
      refundB = amountBDesired - amountBOptimal;
    } else {
      const amountAOptimal = (amountBDesired * rA) / rB;
      if (amountAOptimal > amountADesired) {
        throw new AmmError("AMM_SUB_OPTIMAL_RATIO", "Inconsistent optimal deposit calculation");
      }
      actualA = amountAOptimal;
      actualB = amountBDesired;
      refundA = amountADesired - amountAOptimal;
    }

    // Enforce both minimum bounds strictly on actual deposit amounts
    if (actualA < amountAMin) {
      throw new ExcessiveSlippageError(amountAMin.toString(), actualA.toString());
    }
    if (actualB < amountBMin) {
      throw new ExcessiveSlippageError(amountBMin.toString(), actualB.toString());
    }
    // Enforce non-zero actual deposit amounts
    if (actualA <= 0n || actualB <= 0n) {
      throw new ZeroAmountError("actualDeposit");
    }

    const lpA = (actualA * totalLp) / rA;
    const lpB = (actualB * totalLp) / rB;
    const lpToMint = lpA < lpB ? lpA : lpB;

    // Enforce non-zero LP minting
    if (lpToMint <= 0n) {
      throw new InsufficientLiquidityError("Deposit yields 0 LP tokens minted due to extreme dilution or rounding");
    }

    pool.reserveA = (rA + actualA).toString();
    pool.reserveB = (rB + actualB).toString();
    pool.totalLpSupply = (totalLp + lpToMint).toString();

    const provKey = provider.toLowerCase();
    const curBalance = BigInt(pool.lpBalances[provKey] || "0");
    pool.lpBalances[provKey] = (curBalance + lpToMint).toString();
    pool.lastUpdatedAt = Date.now();

    this.store.savePool(pool);
    this.store.logAudit("ADD_LIQUIDITY", poolId, {
      provider,
      actualA: actualA.toString(),
      actualB: actualB.toString(),
      refundA: refundA.toString(),
      refundB: refundB.toString(),
      lpTokensMinted: lpToMint.toString()
    });

    return { amountA: actualA, amountB: actualB, refundA, refundB, lpTokensMinted: lpToMint, pool };
  }

  public removeLiquidity(
    poolId: string,
    lpTokensToBurn: bigint,
    amountAMin: bigint,
    amountBMin: bigint,
    provider: string,
    deadline: number
  ): { amountA: bigint; amountB: bigint; pool: SerializedPool } {
    if (Date.now() > deadline) {
      throw new DeadlineExpiredError(deadline, Date.now());
    }
    if (lpTokensToBurn <= 0n) {
      throw new ZeroAmountError("lpTokensToBurn");
    }
    if (amountAMin < 0n || amountBMin < 0n) {
      throw new ZeroAmountError("amountMin");
    }

    const rawPool = this.store.getPool(poolId);
    if (!rawPool) {
      throw new PoolNotFoundError(poolId);
    }

    const pool = JSON.parse(JSON.stringify(rawPool)) as SerializedPool;

    const provKey = provider.toLowerCase();
    const userLp = BigInt(pool.lpBalances[provKey] || "0");
    if (userLp < lpTokensToBurn) {
      throw new AmmError("AMM_INSUFFICIENT_LP_BALANCE", `User LP balance (${userLp}) is less than burn amount (${lpTokensToBurn})`);
    }

    const rA = BigInt(pool.reserveA);
    const rB = BigInt(pool.reserveB);
    const totalLp = BigInt(pool.totalLpSupply);

    if (lpTokensToBurn > totalLp - MINIMUM_LIQUIDITY) {
      throw new InsufficientLiquidityError("Cannot redeem permanently locked minimum liquidity");
    }

    const amountA = (lpTokensToBurn * rA) / totalLp;
    const amountB = (lpTokensToBurn * rB) / totalLp;

    if (amountA <= 0n && amountB <= 0n) {
      throw new ZeroAmountError("redeemedAmounts");
    }

    if (amountA < amountAMin) {
      throw new ExcessiveSlippageError(amountAMin.toString(), amountA.toString());
    }
    if (amountB < amountBMin) {
      throw new ExcessiveSlippageError(amountBMin.toString(), amountB.toString());
    }

    pool.reserveA = (rA - amountA).toString();
    pool.reserveB = (rB - amountB).toString();
    pool.totalLpSupply = (totalLp - lpTokensToBurn).toString();
    pool.lpBalances[provKey] = (userLp - lpTokensToBurn).toString();
    pool.lastUpdatedAt = Date.now();

    this.store.savePool(pool);
    this.store.logAudit("REMOVE_LIQUIDITY", poolId, {
      provider,
      lpTokensBurned: lpTokensToBurn.toString(),
      amountA: amountA.toString(),
      amountB: amountB.toString()
    });

    return { amountA, amountB, pool };
  }
}
