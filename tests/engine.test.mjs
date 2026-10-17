import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AmmEngine, EngineStateStore } from "../dist/index.js";

describe("AMM Engine Domain Logic & State Machine", () => {
  const creator = "0xCreatorAddress123";
  const trader = "0xTraderAddress456";

  test("Create pool initializes reserves and locks minimum liquidity", () => {
    const engine = new AmmEngine();
    const { poolId, lpTokensMinted } = engine.createPool("USDC", "ETH", 100000n, 50n, creator, 30);
    assert.ok(poolId);
    assert.equal(lpTokensMinted > 0n, true);

    const pool = engine.store.getPool(poolId);
    assert.equal(pool.reserveA, "50"); // canonical ETH is first
    assert.equal(pool.reserveB, "100000"); // USDC is second
    assert.equal(pool.feeBps, 30);
  });

  test("Fee validation rejects invalid fee configurations", () => {
    const engine = new AmmEngine();
    assert.throws(() => engine.createPool("USDC", "ETH", 1000n, 1000n, creator, 0), /AMM_INVALID_FEE_BPS/);
    assert.throws(() => engine.createPool("USDC", "ETH", 1000n, 1000n, creator, 1500), /AMM_INVALID_FEE_BPS/);
  });

  test("Swap executes correctly, updates reserves, and respects slippage limits", () => {
    const engine = new AmmEngine();
    const { poolId } = engine.createPool("USDC", "ETH", 100000000n, 50000n, creator, 30);

    const deadline = Date.now() + 60000;
    // Swap 1,000,000 USDC for ETH
    const { amountOut, feeAmount } = engine.swap(poolId, "USDC", 1000000n, 400n, trader, deadline);

    assert.equal(amountOut > 400n, true);
    assert.equal(feeAmount, 3000n); // 0.3% of 1,000,000

    // Swap with excessive slippage requirement fails and preserves pool state
    const poolBefore = engine.store.getPool(poolId);
    assert.throws(
      () => engine.swap(poolId, "USDC", 1000000n, 999999999n, trader, deadline),
      /AMM_EXCESSIVE_SLIPPAGE/
    );
    const poolAfter = engine.store.getPool(poolId);
    assert.equal(poolBefore.reserveA, poolAfter.reserveA, "State must not mutate on reverted swap");
    assert.equal(poolBefore.reserveB, poolAfter.reserveB, "State must not mutate on reverted swap");
  });

  test("Add liquidity enforces optimal ratio and refunds excess deposit", () => {
    const engine = new AmmEngine();
    const { poolId } = engine.createPool("ETH", "USDC", 10000n, 20000n, creator, 30);

    const deadline = Date.now() + 60000;
    // Provider offers 1,000 ETH and 3,000 USDC (ratio is 1:2, so 2,000 USDC needed, 1,000 USDC should refund)
    const { amountA, amountB, refundA, refundB, lpTokensMinted } = engine.addLiquidity(
      poolId, 1000n, 3000n, 1000n, 2000n, trader, deadline
    );

    assert.equal(amountA, 1000n);
    assert.equal(amountB, 2000n);
    assert.equal(refundA, 0n);
    assert.equal(refundB, 1000n, "Excess 1,000 USDC must be refunded");
    assert.equal(lpTokensMinted > 0n, true);
  });

  test("Add liquidity validates deposit bounds and rejects invalid inputs", () => {
    const engine = new AmmEngine();
    const { poolId } = engine.createPool("ETH", "USDC", 10000n, 20000n, creator, 30);
    const deadline = Date.now() + 60000;

    // Minimum exceeds desired
    assert.throws(
      () => engine.addLiquidity(poolId, 1000n, 2000n, 1001n, 2000n, trader, deadline),
      /AMM_EXCESSIVE_SLIPPAGE/
    );
    assert.throws(
      () => engine.addLiquidity(poolId, 1000n, 2000n, 1000n, 2001n, trader, deadline),
      /AMM_EXCESSIVE_SLIPPAGE/
    );

    // Negative amounts
    assert.throws(
      () => engine.addLiquidity(poolId, -100n, 2000n, 0n, 0n, trader, deadline),
      /AMM_ZERO_AMOUNT/
    );
    assert.throws(
      () => engine.addLiquidity(poolId, 1000n, 2000n, -1n, 0n, trader, deadline),
      /AMM_ZERO_AMOUNT/
    );

    // Zero actual deposit due to ratio rounding
    const freshEngine = new AmmEngine();
    const { poolId: dilutedPoolId } = freshEngine.createPool("ETH", "USDC", 1000000000000n, 10000n, creator, 30);
    assert.throws(
      () => freshEngine.addLiquidity(dilutedPoolId, 1000n, 10n, 0n, 0n, trader, deadline),
      /AMM_ZERO_AMOUNT/
    );

    // Insufficient liquidity when pool total LP supply is exhausted
    const { poolId: microPoolId } = freshEngine.createPool("DAI", "USDC", 1001n, 1001n, creator, 30);
    const pool = freshEngine.store.getPool(microPoolId);
    pool.totalLpSupply = "0";
    freshEngine.store.savePool(pool);
    assert.throws(
      () => freshEngine.addLiquidity(microPoolId, 500n, 500n, 0n, 0n, trader, deadline),
      /AMM_INSUFFICIENT_LIQUIDITY/
    );
  });

  test("State store rollback preserves state on failed atomic transaction", () => {
    const engine = new AmmEngine();
    const { poolId } = engine.createPool("ETH", "USDC", 10000n, 20000n, creator, 30);
    const poolBefore = JSON.parse(JSON.stringify(engine.store.getPool(poolId)));

    // Fail addLiquidity with expired deadline
    assert.throws(
      () => engine.addLiquidity(poolId, 1000n, 2000n, 0n, 0n, trader, Date.now() - 1000),
      /AMM_DEADLINE_EXPIRED/
    );

    const poolAfter = engine.store.getPool(poolId);
    assert.deepEqual(poolAfter, poolBefore, "State must not mutate on failed transaction");
  });

  test("Remove liquidity redeems proportional assets and burns LP tokens", () => {
    const engine = new AmmEngine();
    const { poolId, lpTokensMinted } = engine.createPool("ETH", "USDC", 10000n, 20000n, creator, 30);

    const deadline = Date.now() + 60000;
    const halfLp = lpTokensMinted / 2n;

    const { amountA, amountB } = engine.removeLiquidity(
      poolId, halfLp, 0n, 0n, creator, deadline
    );

    assert.equal(amountA > 0n, true);
    assert.equal(amountB > 0n, true);

    const pool = engine.store.getPool(poolId);
    assert.equal(BigInt(pool.lpBalances[creator.toLowerCase()]), lpTokensMinted - halfLp);
  });

  test("Canonical pool identity rejects duplicate logical pools across case, order, and formatting", () => {
    const engine = new AmmEngine();

    // 1. Initial pool creation
    const { poolId } = engine.createPool("USDC", "ETH", 100000n, 50n, creator, 30);
    assert.equal(poolId, "eth:usdc:30");

    // 2. Reject duplicate creation with lowercase
    assert.throws(
      () => engine.createPool("usdc", "eth", 100000n, 50n, creator, 30),
      /AMM_POOL_ALREADY_EXISTS/
    );

    // 3. Reject duplicate creation with mixed case and reversed order
    assert.throws(
      () => engine.createPool("eTh", "UsDc", 100000n, 50n, creator, 30),
      /AMM_POOL_ALREADY_EXISTS/
    );

    // 4. Reject duplicate creation with reversed lowercase order
    assert.throws(
      () => engine.createPool("eth", "usdc", 100000n, 50n, creator, 30),
      /AMM_POOL_ALREADY_EXISTS/
    );

    // 5. Reject identical assets (same token in both positions)
    assert.throws(
      () => engine.createPool("USDC", "usdc", 1000n, 1000n, creator, 30),
      /AMM_IDENTICAL_ADDRESSES/
    );
    assert.throws(
      () => engine.createPool("ETH", "ETH", 1000n, 1000n, creator, 30),
      /AMM_IDENTICAL_ADDRESSES/
    );

    // 6. Real EVM hex address canonicalization
    const usdcAddr = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    const wethAddr = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

    const { poolId: hexPoolId } = engine.createPool(usdcAddr, wethAddr, 1000000n, 500n, creator, 30);
    assert.equal(hexPoolId.startsWith("0xa0b8"), true);

    // Re-creating with lowercase addresses or inverted order must strictly fail
    assert.throws(
      () => engine.createPool(wethAddr.toLowerCase(), usdcAddr.toLowerCase(), 1000000n, 500n, creator, 30),
      /AMM_POOL_ALREADY_EXISTS/
    );
  });
});

