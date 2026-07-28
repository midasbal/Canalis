// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPyth, PythStructs} from "../../src/interfaces/IPyth.sol";

/// @notice Mocks the EXTERNAL Pyth oracle contract for unit tests only — the
/// deployed feature reads the REAL Pyth contract on Arc testnet (see
/// docs/canalis-spec.md section 7.3 #2 / Deploy.s.sol). This mock exists so
/// CanalisExecutor's oracle-condition logic can be unit-tested against
/// settable prices/staleness deterministically, the same way MockERC20
/// stands in for the real USDC/EURC token contracts elsewhere in this
/// suite — it is not itself "the oracle feature".
contract MockPyth is IPyth {
    mapping(bytes32 => PythStructs.Price) private _prices;
    mapping(bytes32 => bool) private _known;

    function setPrice(bytes32 id, int64 price, uint64 conf, int32 expo, uint256 publishTime) external {
        _prices[id] = PythStructs.Price({price: price, conf: conf, expo: expo, publishTime: publishTime});
        _known[id] = true;
    }

    function getPriceUnsafe(bytes32 id) external view returns (PythStructs.Price memory) {
        require(_known[id], "MockPyth: unknown price id");
        return _prices[id];
    }

    function updatePriceFeeds(bytes[] calldata) external payable {
        revert("MockPyth: updatePriceFeeds not used in unit tests");
    }

    function getUpdateFee(bytes[] calldata) external pure returns (uint256) {
        return 0;
    }
}
