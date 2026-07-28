// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITokenMessengerV2} from "../../src/interfaces/ITokenMessengerV2.sol";

/// @notice Mocks the EXTERNAL CCTP V2 TokenMessengerV2 contract for unit
/// tests only — the deployed feature calls the REAL TokenMessengerV2 on
/// Arc testnet (see docs/canalis-spec.md section 7.3 #3 / Deploy.s.sol).
/// This mock exists so CanalisExecutor's Bridge action can be unit-tested
/// deterministically, the same way MockERC20/MockPyth stand in for their
/// real external contracts elsewhere in this suite — it is not itself "the
/// CCTP feature". Records the exact call arguments and pulls `amount` of
/// `burnToken` via `transferFrom`, mirroring the real contract's actual
/// token-custody behavior (so tests can assert the account was really
/// debited, not just that a call happened).
contract MockTokenMessengerV2 is ITokenMessengerV2 {
    struct Call {
        uint256 amount;
        uint32 destinationDomain;
        bytes32 mintRecipient;
        address burnToken;
        bytes32 destinationCaller;
        uint256 maxFee;
        uint32 minFinalityThreshold;
    }

    Call[] public calls;
    bool public shouldRevert;

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function callCount() external view returns (uint256) {
        return calls.length;
    }

    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external {
        if (shouldRevert) revert("MockTokenMessengerV2: forced revert");

        calls.push(
            Call({
                amount: amount,
                destinationDomain: destinationDomain,
                mintRecipient: mintRecipient,
                burnToken: burnToken,
                destinationCaller: destinationCaller,
                maxFee: maxFee,
                minFinalityThreshold: minFinalityThreshold
            })
        );

        IERC20(burnToken).transferFrom(msg.sender, address(this), amount);
    }
}
