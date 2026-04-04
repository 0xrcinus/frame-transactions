# frame-transactions — Code Quality Fixes

Tracked fixes from architecture/quality review against viem reference.
Mark each `[ ]` to `[x]` as completed.

---

## 1. Error classes: extend viem's BaseError
**Files:** `src/errors/index.ts`, `src/external.ts`
**What:** All four error classes are thin `Error` wrappers with only `this.name`. Viem's `BaseError` carries `shortMessage`, `details`, `metaMessages`, `cause` chaining, `docsPath`, and `walk()`. Since viem is already a dependency, extend `BaseError` directly. Add structured parameters (cause, details) to each error constructor.

- [x] Refactor `FrameTransactionError` to extend viem `BaseError`
- [x] Refactor `InvalidFrameError`, `InvalidValidationPrefixError`, `SerializationError` to pass structured args
- [x] Export `ErrorType` type aliases (e.g. `InvalidFrameErrorType`) from errors and `external.ts`

---

## 2. `as never` casts on RPC calls
**Files:** `src/actions/sendFrameTransaction.ts:91-94`, `src/actions/sendPreparedFrameTransaction.ts:89-92`
**What:** Triple `as never` to silence the type checker on `client.request()`. Define a typed helper or use viem's `sendRawTransaction` action directly.

- [x] Replace `as never` RPC calls with viem's `sendRawTransaction` or a typed request wrapper

---

## 3. Duplicated signing logic
**Files:** `src/actions/sendFrameTransaction.ts:60-81`, `src/actions/sendPreparedFrameTransaction.ts:53-72`
**What:** Identical EOA-vs-smart-account signing blocks with the same runtime type checks, casts, and error messages. Extract a shared helper.

- [x] Create `signVerifyFrame(account, sigHash, accountType)` helper
- [x] Use `LocalAccount` type narrowing instead of `"sign" in account` checks
- [x] Deduplicate into both action files

---

## 4. Bare `throw new Error(...)` outside error hierarchy
**Files:** `src/actions/sendFrameTransaction.ts:63-66,77`, `src/actions/sendPreparedFrameTransaction.ts:55-58,67`
**What:** Raw `Error` thrown instead of `FrameTransactionError` subclasses. Breaks consistent catch patterns.

- [x] Replace bare `Error` throws with appropriate `FrameTransactionError` subclass (new `AccountError` or similar)

---

## 5. No `ErrorType` exports for actions
**Files:** `src/actions/*.ts`, `src/external.ts`
**What:** Viem exports composed error types for every action so callers can type catch blocks. frame-transactions exports none.

- [x] Add `ErrorType` exports for each action (at minimum the key public ones)

---

## 6. No `@example` JSDoc blocks
**Files:** All action files, `src/decorator/frameActions.ts`
**What:** Decent `@param`/`@returns` but zero runnable examples. These are the most valuable part of SDK docs.

- [x] Add `@example` blocks to public action functions
- [x] Add `@example` to `frameActions()` decorator

---

## 7. Enums -> `as const` objects
**Files:** `src/types/frame.ts`
**What:** `FrameMode` and `ApprovalScope` use TypeScript `enum`. Viem avoids enums everywhere, using `as const` objects + literal unions. Enums emit runtime code, have nominal typing quirks, and don't tree-shake well.

- [x] Convert `FrameMode` enum to `as const` object + type
- [x] Convert `ApprovalScope` enum to `as const` object + type
- [x] Update all usages across src and tests

---

## 8. Weak address validation
**Files:** `src/utils/validation.ts:55`
**What:** `frame.target.startsWith("0x")` validates almost nothing — `"0xZZZ"` passes. Use viem's `isAddress()`.

- [x] Replace `.startsWith("0x")` with `isAddress()` from viem

---

## 9. Incorrect type assertions on `toRlp` calls
**Files:** `src/utils/encoding.ts:66`, `src/eoa.ts:47`
**What:** Nested array structures cast to `Hex[]` to satisfy `toRlp`. Should use viem's `RecursiveArray<Hex>` or the correct overload.

- [x] Fix type assertions to use correct `toRlp` input types

---

## 10. Hardcoded client generic parameters
**Files:** `src/actions/sendFrameTransaction.ts:43`, `src/actions/prepareFrameTransaction.ts:47`, `src/actions/sendPreparedFrameTransaction.ts:36`, `src/decorator/frameActions.ts:54`
**What:** All actions hardcode `Client<Transport, Chain, Account>` (non-optional). Viem uses generic parameters with `| undefined` and runtime assertions. This prevents usage with partially configured clients.

- [x] Add generic type parameters to action signatures
- [x] Add runtime assertions for required chain/account with descriptive errors

---

## 11. `"0x" as Hex` magic literal for VERIFY placeholder
**Files:** `src/actions/buildFrameTransaction.ts:62,68,76`
**What:** Repeated `"0x" as Hex` as VERIFY data placeholder. Should be a named constant.

- [x] Add `EMPTY_DATA` or `VERIFY_PLACEHOLDER` constant
- [x] Replace all occurrences

---

## 12. Verbose parameter pass-through in `prepareFrameTransaction`
**Files:** `src/actions/prepareFrameTransaction.ts:61-73`
**What:** Manual field-by-field copy instead of spread. Maintenance trap when adding new fields.

- [x] Replace with `{ ...params, chainId, nonce, sender }` spread pattern

---

## 13. `internal.ts` wildcard leaks non-public API
**Files:** `src/internal.ts`
**What:** `export * from` every submodule bleeds out internals like `serializeFrameTransactionRlp`. Either make exports explicit or remove `internal.ts` if unused.

- [x] Make `internal.ts` exports explicit, or remove if only `external.ts` is needed

---

## 14. `serializeFrameTransactionRlp` exported from `utils/index.ts` but not `external.ts`
**Files:** `src/utils/index.ts:6`
**What:** Ambiguous public/private status. Either promote to `external.ts` or remove from `utils/index.ts`.

- [x] Decide: promote to public or make internal-only

---

## 15. Hardcoded VERIFY `gasLimit: 100000n`
**Files:** `src/actions/buildFrameTransaction.ts:61,66,76`
**What:** Every VERIFY frame gets `100000n` gas with no override. Should be a named constant and configurable via params.

- [x] Extract `DEFAULT_VERIFY_GAS_LIMIT` constant
- [x] Make configurable via `BuildFrameTransactionParameters`

---

## 16. No tests for `sendFrameTransaction` / `sendPreparedFrameTransaction`
**Files:** `test/actions/` (missing files)
**What:** The two most complex async actions — with signing logic, RPC calls, and error branching — have zero test coverage. Mock the client transport to test.

- [x] Add test file for `sendFrameTransaction` with mocked client
- [x] Add test file for `sendPreparedFrameTransaction` with mocked client
- [x] Cover EOA and smart-account signing branches
- [x] Cover error cases (missing account, missing signMessage)

---

## 17. `findVerifyIndices` logic duplicated
**Files:** `src/actions/prepareFrameTransaction.ts:78-90`, `test/actions/prepareFrameCalls.spec.ts:21-31`
**What:** Same VERIFY-index-finding loop in production code and test helper. Extract to a utility.

- [x] Extract `findVerifyIndices` to `src/utils/` as a public utility
- [x] Use in `prepareFrameTransaction` and tests

---

## 18. Tests import from deep internal paths
**Files:** All test files
**What:** Tests import from `../../src/actions/buildFrameTransaction.js` etc. At least spec/integration tests should import from the barrel export to validate the public API surface.

- [x] Update spec tests to import from package entry point

---

## 19. Silent `v ?? 27n` fallback
**Files:** `src/actions/sendFrameTransaction.ts:72`, `src/actions/sendPreparedFrameTransaction.ts:64`, `src/eoa.ts:84`
**What:** `parseSignature` can return `undefined` for `v`, silently defaulted to `27n`. Should throw if `v` is missing — a missing recovery parameter indicates a bad signature.

- [x] Replace `v ?? 27n` with explicit check and throw

---

## 20. Operator precedence in test `as Hex` casts
**Files:** `test/spec/examples.spec.ts:68`, `test/actions/serializeFrameTransaction.spec.ts:25`
**What:** `"0x" + "ab".repeat(65) as Hex` — `as` binds to the right operand only. Should be `("0x" + "ab".repeat(65)) as Hex`.

- [x] Fix parenthesization in all test files

---

## 21. Null target `"0x"` sentinel undocumented
**Files:** `src/utils/encoding.ts:34,129`
**What:** `null` target encodes as `"0x"` (empty bytes) in RLP and `"0x"` decodes back to `null`. This round-trips correctly but the convention is implicit. Add a comment or constant.

- [x] Add documenting comment or named constant for the null-target encoding convention

---

## 22. Double validation on serialize path
**Files:** `src/actions/serializeFrameTransaction.ts:17`, `src/utils/encoding.ts:47-51`
**What:** `serializeFrameTransaction` calls `validateFrameTransaction`, then `encodeFrameTransactionPayload` re-checks frame count. The low-level encoder shouldn't duplicate validation the action layer already performed.

- [x] Remove frame-count check from `encodeFrameTransactionPayload` (let caller validate)

---

## 23. No defensive check on `client.chain` / `client.account`
**Files:** `src/actions/prepareFrameTransaction.ts:50-51`
**What:** `client.chain.id` and `client.account.address` accessed without guards. If either is `undefined`, throws unhelpful `Cannot read properties of undefined`. Viem guards with descriptive errors.

- [x] Add explicit checks with descriptive error messages before accessing `client.chain` and `client.account`

---

## 24. `frameActions()` decorator still hardcodes client generics
**Files:** `src/decorator/frameActions.ts:66`
**What:** The decorator — the primary consumer-facing API — still requires `Client<Transport, Chain, Account>` (non-optional). A user with `Chain | undefined` gets a type error at `.extend(frameActions())`. The standalone actions were fixed but the decorator was missed.

- [x] Add generic type parameters to the decorator closure
- [x] Add runtime guards matching the standalone actions

---

## 25. `prepareFrameTransaction` still has `as never` on RPC call
**Files:** `src/actions/prepareFrameTransaction.ts:106-109`
**What:** `client.request({ ... } as never)` for `eth_getTransactionCount`. Same pattern we eliminated in the send actions. Use viem's `getTransactionCount` action instead.

- [x] Replace manual RPC call with viem's `getTransactionCount`

---

## 26. `signEoaVerifyFrame` duplicates logic now in `signFrameVerify`
**Files:** `src/eoa.ts:62-107`
**What:** Has its own manual sign + encode + bounds-check + insert flow. The bounds check and frame insertion are already in `insertVerifyData`; the sign+encode is in `signFrameVerify`. Refactor to compose from those.

- [x] Refactor `signEoaVerifyFrame` to use `insertVerifyData` and avoid duplicating validation

---

## 27. Error constructor args type repeated 5 times
**Files:** `src/errors/index.ts`
**What:** Each subclass re-declares the identical `args?` parameter type inline. Extract a shared type.

- [x] Extract `FrameTransactionErrorArgs` type and reuse across all error classes

---

## 28. No unit tests for `signFrameVerify` or `findVerifyIndices`
**Files:** `test/utils/` (missing files)
**What:** Both utilities are exercised indirectly through send action tests but have no dedicated tests covering edge cases (wrong account type, json-rpc account, empty frames list, etc.).

- [x] Add `test/utils/signing.spec.ts` with edge cases
- [x] Add `test/utils/findVerifyIndices.spec.ts` with edge cases

---

## 29. Unnecessary `as Hex` cast in `eoa.ts`
**Files:** `src/eoa.ts:43`
**What:** `call.target as Hex` widens `Address` to `Hex`. `Address` is already assignable to `Hex`, so the cast is unnecessary noise.

- [x] Remove the `as Hex` cast
