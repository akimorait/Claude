// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FlashArbitrage, IWETH} from "../src/FlashArbitrage.sol";
import {MockERC20, MockWETH, MockPair, MockFactory} from "./mocks/Mocks.sol";
import {Vm, VmLib} from "./utils/Vm.sol";

contract FlashArbitrageTest {
    Vm internal constant vm = VmLib.VM;

    address internal owner = address(0xA11CE);
    address internal executor = address(0xE9EC);
    address internal rando = address(0xBAD);

    MockWETH internal weth;
    MockERC20 internal tkn;
    MockFactory internal factoryA; // "Uniswap"
    MockFactory internal factoryB; // "Sushiswap"
    MockPair internal pairA;
    MockPair internal pairB;
    FlashArbitrage internal arb;

    // Liquidity: token cheaper on A (2000 TKN/WETH) than on B (1900 TKN/WETH),
    // so the profitable direction is buyOnA = true.
    uint256 internal constant WETH_A = 100 ether;
    uint256 internal constant TKN_A = 200_000 ether;
    uint256 internal constant WETH_B = 100 ether;
    uint256 internal constant TKN_B = 190_000 ether;

    function setUp() public {
        weth = new MockWETH();
        tkn = new MockERC20();
        factoryA = new MockFactory();
        factoryB = new MockFactory();
        pairA = MockPair(factoryA.createPair(address(tkn), address(weth)));
        pairB = MockPair(factoryB.createPair(address(tkn), address(weth)));

        arb = new FlashArbitrage(
            owner,
            executor,
            IWETH(address(weth)),
            address(factoryA),
            factoryA.pairInitCodeHash(),
            address(factoryB),
            factoryB.pairInitCodeHash()
        );

        weth.deposit{value: 400 ether}();
        weth.transfer(address(pairA), WETH_A);
        tkn.mint(address(pairA), TKN_A);
        pairA.sync();
        weth.transfer(address(pairB), WETH_B);
        tkn.mint(address(pairB), TKN_B);
        pairB.sync();

        vm.roll(100);
    }

    /*//////////////////////////////////////////////////////////////////////
                                  DERIVATION
    //////////////////////////////////////////////////////////////////////*/

    function test_PairDerivationMatchesCreate2() public view {
        (address a, address b) = arb.getPairs(address(tkn));
        require(a == address(pairA), "pairA derivation mismatch");
        require(b == address(pairB), "pairB derivation mismatch");
    }

    /*//////////////////////////////////////////////////////////////////////
                                 FLASH MODE
    //////////////////////////////////////////////////////////////////////*/

    function test_FlashArbitrage_HappyPath() public {
        uint256 borrow = 3_000 ether;
        uint256 wethOwed = _getAmountIn(borrow, WETH_A, TKN_A);
        uint256 wethOut = _getAmountOut(borrow, TKN_B, WETH_B);
        uint256 expectedProfit = wethOut - wethOwed;
        require(expectedProfit > 0.01 ether, "test setup: expected a real edge");

        vm.expectEmit(true, false, false, true);
        emit FlashArbitrage.ArbitrageExecuted(address(tkn), true, true, borrow, expectedProfit, 0);

        vm.prank(executor);
        arb.executeFlash(address(tkn), borrow, 0.01 ether, block.number, true, 0);

        require(weth.balanceOf(address(arb)) == expectedProfit, "profit not captured");
        require(tkn.balanceOf(address(arb)) == 0, "no tokens should remain");
    }

    function test_FlashArbitrage_OwnerMayExecute() public {
        vm.prank(owner);
        arb.executeFlash(address(tkn), 1_000 ether, 1, block.number, true, 0);
        require(weth.balanceOf(address(arb)) > 0, "owner execution failed");
    }

    function test_RevertWhen_CallerNotExecutor() public {
        vm.expectRevert(FlashArbitrage.NotExecutor.selector);
        vm.prank(rando);
        arb.executeFlash(address(tkn), 1_000 ether, 1, block.number, true, 0);
    }

    function test_RevertWhen_Expired() public {
        vm.expectRevert(FlashArbitrage.Expired.selector);
        vm.prank(executor);
        arb.executeFlash(address(tkn), 1_000 ether, 1, block.number - 1, true, 0);
    }

    function test_RevertWhen_TokenIsWeth() public {
        vm.expectRevert(FlashArbitrage.InvalidToken.selector);
        vm.prank(executor);
        arb.executeFlash(address(weth), 1 ether, 1, block.number, true, 0);
    }

    function test_RevertWhen_ProfitBelowMinimum() public {
        uint256 borrow = 3_000 ether;
        uint256 wethOwed = _getAmountIn(borrow, WETH_A, TKN_A);
        uint256 wethOut = _getAmountOut(borrow, TKN_B, WETH_B);
        uint256 minProfit = 1_000 ether;

        vm.expectRevert(
            abi.encodeWithSelector(
                FlashArbitrage.InsufficientProfit.selector, wethOut, wethOwed + minProfit
            )
        );
        vm.prank(executor);
        arb.executeFlash(address(tkn), borrow, minProfit, block.number, true, 0);
    }

    function test_RevertWhen_WrongDirection() public {
        // Token is cheaper on A; buying on B must never clear a 1-wei profit gate.
        vm.expectRevert();
        vm.prank(executor);
        arb.executeFlash(address(tkn), 3_000 ether, 1, block.number, false, 0);
    }

    /*//////////////////////////////////////////////////////////////////////
                              CALLBACK SECURITY
    //////////////////////////////////////////////////////////////////////*/

    function test_RevertWhen_CallbackCalledDirectly() public {
        vm.expectRevert(FlashArbitrage.BadCallback.selector);
        arb.uniswapV2Call(address(arb), 1 ether, 0, "");
    }

    function test_RevertWhen_CallbackFromRealPairOutsideExecution() public {
        // Even the genuine pair cannot invoke the callback outside an
        // execute() initiated in the same transaction (transient lock unset).
        vm.expectRevert(FlashArbitrage.BadCallback.selector);
        vm.prank(address(pairA));
        arb.uniswapV2Call(address(arb), 1 ether, 0, "");
    }

    function test_RevertWhen_CallbackSenderNotSelf() public {
        vm.expectRevert(FlashArbitrage.BadCallback.selector);
        vm.prank(address(pairA));
        arb.uniswapV2Call(rando, 1 ether, 0, "");
    }

    /*//////////////////////////////////////////////////////////////////////
                                 FUNDED MODE
    //////////////////////////////////////////////////////////////////////*/

    function test_FundedArbitrage_HappyPath() public {
        weth.transfer(address(arb), 10 ether); // owner pre-funds the contract

        uint256 wethIn = 1.12 ether; // ~optimal for the seeded reserves
        uint256 tokenOut = _getAmountOut(wethIn, WETH_A, TKN_A);
        uint256 wethOut = _getAmountOut(tokenOut, TKN_B, WETH_B);
        uint256 expectedProfit = wethOut - wethIn;
        require(expectedProfit > 0.01 ether, "test setup: expected a real edge");

        vm.expectEmit(true, false, false, true);
        emit FlashArbitrage.ArbitrageExecuted(
            address(tkn), true, false, wethIn, expectedProfit, 0
        );

        vm.prank(executor);
        arb.executeFunded(address(tkn), wethIn, 0.01 ether, block.number, true, 0);

        require(
            weth.balanceOf(address(arb)) == 10 ether + expectedProfit, "funded profit mismatch"
        );
    }

    function test_RevertWhen_FundedWithoutBalance() public {
        // Contract holds no WETH — the first transfer must fail, atomically.
        vm.expectRevert();
        vm.prank(executor);
        arb.executeFunded(address(tkn), 1 ether, 1, block.number, true, 0);
    }

    /*//////////////////////////////////////////////////////////////////////
                                    BRIBE
    //////////////////////////////////////////////////////////////////////*/

    function test_BribePaidToCoinbase() public {
        address builder = address(0xB111D);
        vm.coinbase(builder);

        uint256 borrow = 3_000 ether;
        uint256 profit = _getAmountOut(borrow, TKN_B, WETH_B) - _getAmountIn(borrow, WETH_A, TKN_A);
        uint256 expectedBribe = profit * 2_500 / 10_000;

        vm.prank(executor);
        arb.executeFlash(address(tkn), borrow, 0.01 ether, block.number, true, 2_500);

        require(builder.balance == expectedBribe, "bribe not paid");
        require(weth.balanceOf(address(arb)) == profit - expectedBribe, "net profit mismatch");
    }

    function test_RevertWhen_BribeAboveHundredPercent() public {
        vm.expectRevert(FlashArbitrage.InvalidBribe.selector);
        vm.prank(executor);
        arb.executeFlash(address(tkn), 1_000 ether, 1, block.number, true, 10_001);
    }

    /*//////////////////////////////////////////////////////////////////////
                                    ADMIN
    //////////////////////////////////////////////////////////////////////*/

    function test_WithdrawToken() public {
        vm.prank(executor);
        arb.executeFlash(address(tkn), 3_000 ether, 1, block.number, true, 0);
        uint256 profit = weth.balanceOf(address(arb));

        vm.prank(owner);
        arb.withdrawToken(address(weth), profit);
        require(weth.balanceOf(owner) == profit, "owner did not receive profit");
    }

    function test_WithdrawETH() public {
        vm.deal(address(arb), 2 ether);
        vm.prank(owner);
        arb.withdrawETH(2 ether);
        require(owner.balance == 2 ether, "owner did not receive eth");
    }

    function test_RevertWhen_WithdrawNotOwner() public {
        vm.expectRevert(FlashArbitrage.NotOwner.selector);
        vm.prank(executor);
        arb.withdrawToken(address(weth), 1);
    }

    function test_SetExecutor() public {
        vm.prank(owner);
        arb.setExecutor(rando);
        require(arb.executor() == rando, "executor not rotated");

        vm.prank(rando);
        arb.executeFlash(address(tkn), 1_000 ether, 1, block.number, true, 0);
    }

    function test_RevertWhen_SetExecutorNotOwner() public {
        vm.expectRevert(FlashArbitrage.NotOwner.selector);
        vm.prank(rando);
        arb.setExecutor(rando);
    }

    /*//////////////////////////////////////////////////////////////////////
                               FUZZ INVARIANTS
    //////////////////////////////////////////////////////////////////////*/

    /// @dev Whatever amount the executor requests, the call either reverts or
    ///      the contract's WETH balance grows by at least minProfit. It can
    ///      never settle at a loss.
    function testFuzz_FlashNeverSettlesAtLoss(uint128 rawAmount, bool buyOnA) public {
        uint256 tokenAmount = uint256(rawAmount) % (TKN_B - 1 ether) + 1;
        uint256 balanceBefore = weth.balanceOf(address(arb));

        vm.prank(executor);
        try arb.executeFlash(address(tkn), tokenAmount, 1, block.number, buyOnA, 0) {
            require(weth.balanceOf(address(arb)) >= balanceBefore + 1, "no profit captured");
        } catch {
            require(weth.balanceOf(address(arb)) == balanceBefore, "balance changed on revert");
        }
        require(tkn.balanceOf(address(arb)) == 0, "token dust left behind");
    }

    function testFuzz_FundedNeverSettlesAtLoss(uint96 rawWethIn, bool buyOnA) public {
        weth.transfer(address(arb), 50 ether);
        uint256 wethIn = uint256(rawWethIn) % 50 ether + 1;
        uint256 balanceBefore = weth.balanceOf(address(arb));

        vm.prank(executor);
        try arb.executeFunded(address(tkn), wethIn, 1, block.number, buyOnA, 0) {
            require(weth.balanceOf(address(arb)) >= balanceBefore + 1, "no profit captured");
        } catch {
            require(weth.balanceOf(address(arb)) == balanceBefore, "balance changed on revert");
        }
    }

    /*//////////////////////////////////////////////////////////////////////
                             UNISWAP V2 MATH (test oracle)
    //////////////////////////////////////////////////////////////////////*/

    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        internal
        pure
        returns (uint256)
    {
        uint256 amountInWithFee = amountIn * 997;
        return (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
    }

    function _getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
        internal
        pure
        returns (uint256)
    {
        return (reserveIn * amountOut * 1000) / ((reserveOut - amountOut) * 997) + 1;
    }
}
