// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal Foundry cheatcode interface — keeps this repo free of git
///      submodule dependencies. Cheatcodes live at the well-known address
///      `uint160(uint256(keccak256("hevm cheat code")))`.
interface Vm {
    function prank(address msgSender) external;
    function startPrank(address msgSender) external;
    function stopPrank() external;
    function deal(address account, uint256 newBalance) external;
    function roll(uint256 newHeight) external;
    function coinbase(address newCoinbase) external;
    function expectRevert() external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData)
        external;
    function envAddress(string calldata name) external view returns (address);
    function envOr(string calldata name, address defaultValue) external view returns (address);
    function envOr(string calldata name, bytes32 defaultValue) external view returns (bytes32);
    function startBroadcast() external;
    function stopBroadcast() external;
}

library VmLib {
    Vm internal constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
}
