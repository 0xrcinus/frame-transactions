import type { Account, Hex, LocalAccount } from "viem";
import { parseSignature } from "viem";
import { AccountError } from "../errors/index.js";
import { encodeEcdsaVerifyData } from "../eoa.js";
import type { AccountType } from "../types/transaction.js";

/**
 * Signs a frame transaction sig hash using the appropriate method for the
 * account type, and returns encoded VERIFY frame data.
 *
 * - EOA (`accountType: 'eoa'`): raw ECDSA signing via `account.sign` (no
 *   EIP-191 prefix). Requires a local account (e.g. `privateKeyToAccount`).
 * - Smart account (default): EIP-191 `signMessage` with the sig hash as raw
 *   bytes.
 *
 * @param account - The viem account to sign with
 * @param sigHash - The frame transaction signature hash
 * @param accountType - 'eoa' or 'smart-account' (default)
 * @returns Encoded verify data ready for insertion into a VERIFY frame
 */
export async function signFrameVerify(
    account: Account,
    sigHash: Hex,
    accountType: AccountType = "smart-account",
): Promise<Hex> {
    if (accountType === "eoa") {
        if (account.type !== "local") {
            throw new AccountError(
                "EOA signing requires a local account (e.g. privateKeyToAccount).",
                {
                    details:
                        "The account must have a sign() method for raw ECDSA signing. " +
                        "JSON-RPC accounts are not supported for EOA frame transactions.",
                },
            );
        }
        const localAccount = account as LocalAccount;
        if (!localAccount.sign) {
            throw new AccountError(
                "Local account is missing the sign() method.",
                {
                    details:
                        "This local account implementation does not expose raw ECDSA signing.",
                },
            );
        }
        const rawSig = await localAccount.sign({ hash: sigHash });
        const { v, r, s } = parseSignature(rawSig);
        if (v === undefined) {
            throw new AccountError(
                "Signature is missing the recovery parameter (v).",
                {
                    details:
                        "parseSignature returned undefined for v. The signing " +
                        "implementation may be returning an incomplete signature.",
                },
            );
        }
        return encodeEcdsaVerifyData({ v, r, s });
    }

    if (!account.signMessage) {
        throw new AccountError(
            "Account does not support signMessage.",
            {
                details:
                    "Smart account frame transactions require an account with " +
                    "signMessage support for EIP-191 signing.",
            },
        );
    }
    return account.signMessage({ message: { raw: sigHash } });
}
