export declare class AmmError extends Error {
    code: string;
    constructor(code: string, message: string);
}
export declare class InsufficientLiquidityError extends AmmError {
    constructor(message?: string);
}
export declare class ExcessiveSlippageError extends AmmError {
    constructor(expectedMin: string, actual: string);
}
export declare class DeadlineExpiredError extends AmmError {
    constructor(deadline: number, current: number);
}
export declare class ZeroAmountError extends AmmError {
    constructor(field?: string);
}
export declare class PoolNotFoundError extends AmmError {
    constructor(poolId: string);
}
export declare class InvariantViolationError extends AmmError {
    constructor(kBefore: string, kAfter: string);
}
