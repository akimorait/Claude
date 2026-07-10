// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FlashArbitrage, IWETH} from "../src/FlashArbitrage.sol";
import {Vm, VmLib} from "../test/utils/Vm.sol";

/// @notice Deploys FlashArbitrage. Defaults target Ethereum mainnet
///         (DEX A = Uniswap V2, DEX B = SushiSwap); override via env vars.
///
///         ARB_OWNER=0x... ARB_EXECUTOR=0x... \
///         forge script script/Deploy.s.sol:Deploy \
///             --rpc-url "$RPC_URL" --private-key "$DEPLOYER_KEY" --broadcast
contract Deploy {
    Vm internal constant vm = VmLib.VM;

    address internal constant MAINNET_WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant UNIV2_FACTORY = 0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f;
    bytes32 internal constant UNIV2_INIT_CODE_HASH =
        0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f;
    address internal constant SUSHI_FACTORY = 0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac;
    bytes32 internal constant SUSHI_INIT_CODE_HASH =
        0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303;

    function run() external returns (FlashArbitrage arb) {
        address arbOwner = vm.envAddress("ARB_OWNER");
        address arbExecutor = vm.envAddress("ARB_EXECUTOR");
        address wethAddr = vm.envOr("WETH_ADDRESS", MAINNET_WETH);
        address factoryA = vm.envOr("FACTORY_A", UNIV2_FACTORY);
        bytes32 initHashA = vm.envOr("INIT_CODE_HASH_A", UNIV2_INIT_CODE_HASH);
        address factoryB = vm.envOr("FACTORY_B", SUSHI_FACTORY);
        bytes32 initHashB = vm.envOr("INIT_CODE_HASH_B", SUSHI_INIT_CODE_HASH);

        vm.startBroadcast();
        arb = new FlashArbitrage(
            arbOwner, arbExecutor, IWETH(wethAddr), factoryA, initHashA, factoryB, initHashB
        );
        vm.stopBroadcast();
    }
}
