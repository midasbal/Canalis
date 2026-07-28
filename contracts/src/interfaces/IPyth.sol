// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal hand-written slice of Pyth Network's on-chain interface
/// (matches the pyth-sdk-solidity package's IPyth/PythStructs.Price
/// field-for-field) — only what CanalisExecutor needs to READ a stored
/// price. Hand-rolled rather than pulling the npm/forge package to avoid an
/// extra dependency for two structs and one view function; the deployed
/// Pyth contract on Arc testnet implements the full interface, this is just
/// the subset we call against it.
library PythStructs {
    /// @dev `price` is the signed, `expo`-scaled price (real value =
    /// `price * 10**expo`); `publishTime` is the unix timestamp the price
    /// was last updated on-chain (via `updatePriceFeeds`), NOT "now".
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }
}

interface IPyth {
    /// @notice Returns the stored price for `id` without any staleness
    /// check (reverts only if the feed itself doesn't exist / was never
    /// updated) — CanalisExecutor does its own staleness check against the
    /// flow's configured `maxStaleness` instead of using
    /// `getPriceNoOlderThan`, since that staleness bound is per-flow, not a
    /// single fixed value.
    function getPriceUnsafe(bytes32 id) external view returns (PythStructs.Price memory price);

    /// @notice Pushes a signed price update (fetched off-chain from Pyth's
    /// Hermes API) on-chain, paying `getUpdateFee(updateData)`. Never
    /// called from CanalisExecutor itself (it's a `view`-path read-only
    /// consumer) — the keeper calls this directly before evaluating flows
    /// that carry an oracle condition. See keeper/README.md.
    function updatePriceFeeds(bytes[] calldata updateData) external payable;

    /// @notice The native-token fee required to submit `updateData` via
    /// `updatePriceFeeds`.
    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256 feeAmount);
}
