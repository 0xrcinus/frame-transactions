// Types
export {
    FRAME_TX_TYPE,
    FRAME_TX_INTRINSIC_COST,
    ENTRY_POINT,
    MAX_FRAMES,
    DEFAULT_VERIFY_GAS_LIMIT,
    EMPTY_DATA,
    FrameMode,
    ApprovalScope,
    type Frame,
    type FrameTransaction,
    getExecutionMode,
    getApprovalScope,
    hasAtomicBatchFlag,
    buildMode,
    type AccountType,
    type FrameCall,
    type BuildFrameTransactionParameters,
    type BuildFrameTransactionReturnType,
    type PrepareFrameTransactionReturnType,
    type SerializedFrameTransaction,
} from "./types/index.js";

// Errors
export {
    FrameTransactionError,
    type FrameTransactionErrorType,
    InvalidFrameError,
    type InvalidFrameErrorType,
    InvalidValidationPrefixError,
    type InvalidValidationPrefixErrorType,
    SerializationError,
    type SerializationErrorType,
    AccountError,
    type AccountErrorType,
} from "./errors/index.js";

// Actions
export {
    buildFrameTransaction,
    insertVerifyData,
    type InsertVerifyDataParameters,
    serializeFrameTransaction,
    prepareFrameTransaction,
    type PrepareFrameTransactionParameters,
    sendFrameTransaction,
    type SendFrameTransactionParameters,
    type SendFrameTransactionReturnType,
    sendPreparedFrameTransaction,
    type SendPreparedFrameTransactionParameters,
} from "./actions/index.js";

// Utils
export { computeFrameSigHash } from "./utils/sigHash.js";
export {
    encodeFrameTransactionPayload,
    deserializeFrameTransaction,
    computeTxHash,
} from "./utils/encoding.js";
export { validateFrameTransaction } from "./utils/validation.js";
export { signFrameVerify } from "./utils/signing.js";
export { findVerifyIndices } from "./utils/findVerifyIndices.js";

// EOA helpers
export {
    encodeEcdsaVerifyData,
    encodeEoaSenderData,
    signEoaVerifyFrame,
} from "./eoa.js";

// Decorator
export { frameActions, type FrameActions } from "./decorator/frameActions.js";
