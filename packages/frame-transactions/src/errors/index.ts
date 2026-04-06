import { BaseError } from "viem";

/** Shared constructor args for all frame transaction errors */
type FrameTransactionErrorArgs = {
    cause?: BaseError | Error | undefined;
    details?: string | undefined;
    metaMessages?: string[] | undefined;
};

export type FrameTransactionErrorType = FrameTransactionError & {
    name: "FrameTransactionError";
};
/** Base error for frame transaction operations */
export class FrameTransactionError extends BaseError {
    constructor(shortMessage: string, args?: FrameTransactionErrorArgs) {
        super(shortMessage, { ...args, name: "FrameTransactionError" });
    }
}

export type InvalidFrameErrorType = InvalidFrameError & {
    name: "InvalidFrameError";
};
/** Thrown when frame validation fails against EIP-8141 constraints */
export class InvalidFrameError extends FrameTransactionError {
    constructor(shortMessage: string, args?: FrameTransactionErrorArgs) {
        super(shortMessage, args);
        this.name = "InvalidFrameError";
    }
}

export type InvalidValidationPrefixErrorType = InvalidValidationPrefixError & {
    name: "InvalidValidationPrefixError";
};
/** Thrown when the validation prefix does not match a recognized pattern */
export class InvalidValidationPrefixError extends FrameTransactionError {
    constructor(shortMessage: string, args?: FrameTransactionErrorArgs) {
        super(shortMessage, args);
        this.name = "InvalidValidationPrefixError";
    }
}

export type SerializationErrorType = SerializationError & {
    name: "SerializationError";
};
/** Thrown when serialization or deserialization fails */
export class SerializationError extends FrameTransactionError {
    constructor(shortMessage: string, args?: FrameTransactionErrorArgs) {
        super(shortMessage, args);
        this.name = "SerializationError";
    }
}

export type AccountErrorType = AccountError & {
    name: "AccountError";
};
/** Thrown when the account is missing or doesn't support a required operation */
export class AccountError extends FrameTransactionError {
    constructor(shortMessage: string, args?: FrameTransactionErrorArgs) {
        super(shortMessage, args);
        this.name = "AccountError";
    }
}
