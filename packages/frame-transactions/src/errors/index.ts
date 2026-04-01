/** Base error for frame transaction operations */
export class FrameTransactionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "FrameTransactionError";
    }
}

/** Thrown when frame validation fails against EIP-8141 constraints */
export class InvalidFrameError extends FrameTransactionError {
    constructor(message: string) {
        super(message);
        this.name = "InvalidFrameError";
    }
}

/** Thrown when the validation prefix does not match a recognized pattern */
export class InvalidValidationPrefixError extends FrameTransactionError {
    constructor(message: string) {
        super(message);
        this.name = "InvalidValidationPrefixError";
    }
}

/** Thrown when serialization or deserialization fails */
export class SerializationError extends FrameTransactionError {
    constructor(message: string) {
        super(message);
        this.name = "SerializationError";
    }
}
