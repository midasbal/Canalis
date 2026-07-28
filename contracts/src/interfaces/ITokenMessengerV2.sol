// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal hand-written slice of Circle CCTP V2's TokenMessengerV2
/// interface — only the burn-side entrypoint CanalisExecutor calls.
/// Signature confirmed against Circle's own source
/// (github.com/circlefin/evm-cctp-contracts, src/v2/TokenMessengerV2.sol)
/// and cross-checked live on Arc testnet (see docs/canalis-spec.md section
/// 7.3 #3) — not guessed. Hand-rolled rather than pulling the npm/forge
/// package to avoid an extra dependency for one function.
interface ITokenMessengerV2 {
    /// @notice Deposits and burns `amount` of `burnToken` from the caller,
    /// to be minted as `mintRecipient` on `destinationDomain` once Circle's
    /// attestation service signs the corresponding message (async — the
    /// mint is a SEPARATE transaction on the destination chain, submitted
    /// via MessageTransmitterV2.receiveMessage there; see
    /// docs/canalis-spec.md section 7.3 #3 "burn-on-Arc + async-mint
    /// model").
    /// @param amount amount of `burnToken` to burn
    /// @param destinationDomain CCTP domain id of the destination chain
    /// (0 = Ethereum Sepolia)
    /// @param mintRecipient the recipient on the destination chain, as
    /// bytes32 (an EVM address left-padded with zeros)
    /// @param burnToken the token to burn on this (source) domain — Arc
    /// testnet USDC
    /// @param destinationCaller bytes32(0) = anyone may submit the mint on
    /// the destination chain (the "standard", permissionless convention)
    /// @param maxFee maximum fee (in units of `burnToken`) the caller is
    /// willing to pay on the destination domain — 0 is valid whenever the
    /// domain's live `minFee` is 0 (confirmed on Arc testnet at
    /// implementation time, see docs/canalis-spec.md section 7.3 #3)
    /// @param minFinalityThreshold 2000 = "Standard" transfer (wait for
    /// source-chain finality before the message is attestable); CCTP V2
    /// also supports a lower "Fast Transfer" threshold, not used here
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external;
}
