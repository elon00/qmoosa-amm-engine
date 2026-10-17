export class AmmError extends Error {
    code;
    constructor(code, message) {
        super(`[${code}] ${message}`);
        this.code = code;
        this.name = "AmmError";
    }
}
export class InsufficientLiquidityError extends AmmError {
    constructor(message = "Pool possesses insufficient reserves for this trade") {
        super("AMM_INSUFFICIENT_LIQUIDITY", message);
    }
}
export class ExcessiveSlippageError extends AmmError {
    constructor(expectedMin, actual) {
        super("AMM_EXCESSIVE_SLIPPAGE", `Execution output ${actual} is strictly less than required minimum ${expectedMin}`);
    }
}
export class DeadlineExpiredError extends AmmError {
    constructor(deadline, current) {
        super("AMM_DEADLINE_EXPIRED", `Transaction deadline ${deadline} has expired (current timestamp: ${current})`);
    }
}
export class ZeroAmountError extends AmmError {
    constructor(field = "amount") {
        super("AMM_ZERO_AMOUNT", `Parameter ${field} must be strictly positive`);
    }
}
export class PoolNotFoundError extends AmmError {
    constructor(poolId) {
        super("AMM_POOL_NOT_FOUND", `Pool ${poolId} does not exist in state registry`);
    }
}
export class InvariantViolationError extends AmmError {
    constructor(kBefore, kAfter) {
        super("AMM_K_INVARIANT_VIOLATION", `Constant-product invariant violated: kBefore=${kBefore}, kAfter=${kAfter}`);
    }
}
