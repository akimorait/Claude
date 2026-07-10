// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*//////////////////////////////////////////////////////////////////////////
                                 INTERFACES
//////////////////////////////////////////////////////////////////////////*/

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IWETH is IERC20 {
    function withdraw(uint256 amount) external;
}

interface IUniswapV2Pair {
    function getReserves()
        external
        view
        returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);

    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

/// @title FlashArbitrage
/// @notice Atomic TOKEN/WETH arbitrage between two UniswapV2-style DEXes
///         (e.g. Uniswap V2 and SushiSwap). Two execution modes:
///
///         * `executeFlash`  — flash-swap mode: borrows the token from the cheap
///           pool via a V2 flash swap, sells it on the expensive pool, repays the
///           loan in WETH and keeps the difference. Requires zero capital; only
///           gas is at risk.
///         * `executeFunded` — uses WETH held by this contract. Saves the flash
///           callback overhead (~30k gas) by chaining the two swaps
///           pair-to-pair, but requires the contract to be pre-funded.
///
///         Both modes recompute amounts from live reserves and revert with
///         `InsufficientProfit` unless gross profit >= `minProfit`, so the
///         transaction can never settle at a loss (worst case: revert, gas only).
///
/// @dev    Security model:
///         - `owner` (cold key): withdrawals + executor rotation. Immutable.
///         - `executor` (hot key used by the off-chain bot): may only trigger
///           arbitrage. A compromised executor cannot move funds out.
///         - Pair addresses are derived on-chain via CREATE2 from the factory +
///           init code hash, so a malicious "pair" address can never be injected.
///         - The flash callback is authenticated with an EIP-1153 transient lock:
///           only the exact pair we are mid-flight with can call it, and only
///           within the same transaction. This doubles as reentrancy protection.
///         - Profits accrue in the contract and are withdrawable only to `owner`.
contract FlashArbitrage {
    /*//////////////////////////////////////////////////////////////////////
                                    ERRORS
    //////////////////////////////////////////////////////////////////////*/

    error NotOwner();
    error NotExecutor();
    error Expired();
    error InvalidToken();
    error InvalidBribe();
    error InvalidParams();
    error InsufficientProfit(uint256 wethOut, uint256 wethRequired);
    error BadCallback();
    error TransferFailed();
    error ZeroAddress();

    /*//////////////////////////////////////////////////////////////////////
                                    EVENTS
    //////////////////////////////////////////////////////////////////////*/

    /// @param amountIn token amount borrowed (flash mode) or WETH spent (funded mode)
    event ArbitrageExecuted(
        address indexed token,
        bool buyOnA,
        bool flash,
        uint256 amountIn,
        uint256 grossProfit,
        uint256 bribe
    );
    event ExecutorUpdated(address indexed executor);
    event Withdrawn(address indexed asset, uint256 amount);

    /*//////////////////////////////////////////////////////////////////////
                                    STORAGE
    //////////////////////////////////////////////////////////////////////*/

    address public immutable owner;
    IWETH public immutable weth;
    /// @notice DEX A (e.g. Uniswap V2)
    address public immutable factoryA;
    bytes32 public immutable initCodeHashA;
    /// @notice DEX B (e.g. SushiSwap)
    address public immutable factoryB;
    bytes32 public immutable initCodeHashB;

    /// @notice Hot key allowed to trigger arbitrage. Rotatable by owner.
    address public executor;

    /// @dev Transient storage slot holding the only pair allowed to invoke
    ///      `uniswapV2Call` during the current transaction (0 otherwise).
    uint256 private constant LOCK_SLOT = 0;
    uint256 private constant BPS = 10_000;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        address _owner,
        address _executor,
        IWETH _weth,
        address _factoryA,
        bytes32 _initCodeHashA,
        address _factoryB,
        bytes32 _initCodeHashB
    ) {
        if (
            _owner == address(0) || address(_weth) == address(0) || _factoryA == address(0)
                || _factoryB == address(0)
        ) revert ZeroAddress();
        // Identical DEX config would derive identical pairs (self-arb is nonsense).
        if (_factoryA == _factoryB) revert InvalidParams();
        owner = _owner;
        executor = _executor;
        weth = _weth;
        factoryA = _factoryA;
        initCodeHashA = _initCodeHashA;
        factoryB = _factoryB;
        initCodeHashB = _initCodeHashB;
    }

    /// @dev Required for WETH.withdraw when paying the builder bribe.
    receive() external payable {}

    /*//////////////////////////////////////////////////////////////////////
                                   ARBITRAGE
    //////////////////////////////////////////////////////////////////////*/

    /// @notice Flash-swap arbitrage: borrow `tokenAmount` of `token` from the buy
    ///         pool, sell it on the other DEX for WETH, repay the loan in WETH.
    /// @param token         ERC20 traded against WETH on both DEXes
    /// @param tokenAmount   token amount to flash-borrow from the cheap pool
    /// @param minProfit     minimum gross WETH profit (pre-bribe) or revert
    /// @param deadlineBlock last block number in which this call is valid
    /// @param buyOnA        true: token is cheaper on DEX A (borrow from A, sell on B)
    /// @param bribeBps      share of profit (in 1/10000) paid to block.coinbase
    function executeFlash(
        address token,
        uint256 tokenAmount,
        uint256 minProfit,
        uint256 deadlineBlock,
        bool buyOnA,
        uint256 bribeBps
    ) external {
        (address buyPair, address sellPair, bool tokenIs0) =
            _validate(token, tokenAmount, deadlineBlock, buyOnA, bribeBps);

        uint256 profit;
        bytes memory data;
        {
            // Quote both legs from live reserves; revert early (cheaply) if the
            // opportunity is gone by the time we are included.
            uint256 wethOwed;
            uint256 wethOut;
            {
                (uint256 rToken, uint256 rWeth) = _orientedReserves(buyPair, tokenIs0);
                wethOwed = _getAmountIn(tokenAmount, rWeth, rToken);
                (rToken, rWeth) = _orientedReserves(sellPair, tokenIs0);
                wethOut = _getAmountOut(tokenAmount, rToken, rWeth);
            }
            if (wethOut < wethOwed + minProfit) {
                revert InsufficientProfit(wethOut, wethOwed + minProfit);
            }
            data = abi.encode(token, sellPair, wethOwed, wethOut, tokenIs0);
            unchecked {
                profit = wethOut - wethOwed; // gate above guarantees no underflow
            }
        }

        // Arm the callback lock for exactly this pair, this transaction.
        assembly ("memory-safe") {
            tstore(LOCK_SLOT, buyPair)
        }
        if (tokenIs0) {
            IUniswapV2Pair(buyPair).swap(tokenAmount, 0, address(this), data);
        } else {
            IUniswapV2Pair(buyPair).swap(0, tokenAmount, address(this), data);
        }
        assembly ("memory-safe") {
            tstore(LOCK_SLOT, 0)
        }

        emit ArbitrageExecuted(token, buyOnA, true, tokenAmount, profit, _payBribe(profit, bribeBps));
    }

    /// @notice V2 flash-swap callback (SushiSwap pairs use the same signature).
    ///         Only callable by the pair armed in `executeFlash`, in the same tx.
    function uniswapV2Call(address sender, uint256 amount0, uint256 amount1, bytes calldata data)
        external
    {
        address expectedPair;
        assembly ("memory-safe") {
            expectedPair := tload(LOCK_SLOT)
        }
        if (msg.sender != expectedPair || sender != address(this)) revert BadCallback();

        (address token, address sellPair, uint256 wethOwed, uint256 wethOut, bool tokenIs0) =
            abi.decode(data, (address, address, uint256, uint256, bool));

        // Forward the borrowed tokens to the sell pool and take WETH out.
        _safeTransfer(token, sellPair, tokenIs0 ? amount0 : amount1);
        if (tokenIs0) {
            IUniswapV2Pair(sellPair).swap(0, wethOut, address(this), "");
        } else {
            IUniswapV2Pair(sellPair).swap(wethOut, 0, address(this), "");
        }

        // Repay the flash swap; the pair's K-check enforces sufficiency.
        if (!weth.transfer(msg.sender, wethOwed)) revert TransferFailed();
    }

    /// @notice Capital-funded arbitrage using this contract's WETH balance.
    ///         Cheaper than flash mode (no callback, swaps chained pair-to-pair).
    /// @param wethIn WETH amount to spend on the buy pool
    function executeFunded(
        address token,
        uint256 wethIn,
        uint256 minProfit,
        uint256 deadlineBlock,
        bool buyOnA,
        uint256 bribeBps
    ) external {
        (address buyPair, address sellPair, bool tokenIs0) =
            _validate(token, wethIn, deadlineBlock, buyOnA, bribeBps);

        uint256 tokenOut;
        uint256 wethOut;
        {
            (uint256 rToken, uint256 rWeth) = _orientedReserves(buyPair, tokenIs0);
            tokenOut = _getAmountOut(wethIn, rWeth, rToken);
            (rToken, rWeth) = _orientedReserves(sellPair, tokenIs0);
            wethOut = _getAmountOut(tokenOut, rToken, rWeth);
        }
        if (wethOut < wethIn + minProfit) revert InsufficientProfit(wethOut, wethIn + minProfit);

        // Pay the buy pool, swap token directly into the sell pool, collect WETH.
        if (!weth.transfer(buyPair, wethIn)) revert TransferFailed();
        if (tokenIs0) {
            IUniswapV2Pair(buyPair).swap(tokenOut, 0, sellPair, "");
            IUniswapV2Pair(sellPair).swap(0, wethOut, address(this), "");
        } else {
            IUniswapV2Pair(buyPair).swap(0, tokenOut, sellPair, "");
            IUniswapV2Pair(sellPair).swap(wethOut, 0, address(this), "");
        }

        uint256 profit;
        unchecked {
            profit = wethOut - wethIn; // gate above guarantees no underflow
        }
        emit ArbitrageExecuted(token, buyOnA, false, wethIn, profit, _payBribe(profit, bribeBps));
    }

    /*//////////////////////////////////////////////////////////////////////
                                     ADMIN
    //////////////////////////////////////////////////////////////////////*/

    function setExecutor(address newExecutor) external onlyOwner {
        executor = newExecutor;
        emit ExecutorUpdated(newExecutor);
    }

    /// @notice Withdraw accrued profits (or rescue any ERC20) to the owner.
    function withdrawToken(address token, uint256 amount) external onlyOwner {
        _safeTransfer(token, owner, amount);
        emit Withdrawn(token, amount);
    }

    /// @notice Rescue native ETH (e.g. leftover from a failed bribe payment).
    function withdrawETH(uint256 amount) external onlyOwner {
        (bool ok,) = owner.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(address(0), amount);
    }

    /*//////////////////////////////////////////////////////////////////////
                                     VIEWS
    //////////////////////////////////////////////////////////////////////*/

    /// @notice CREATE2-derived TOKEN/WETH pair addresses on both DEXes.
    function getPairs(address token) external view returns (address pairA, address pairB) {
        pairA = _pairFor(factoryA, initCodeHashA, token);
        pairB = _pairFor(factoryB, initCodeHashB, token);
    }

    /*//////////////////////////////////////////////////////////////////////
                                   INTERNALS
    //////////////////////////////////////////////////////////////////////*/

    function _validate(
        address token,
        uint256 amountIn,
        uint256 deadlineBlock,
        bool buyOnA,
        uint256 bribeBps
    ) private view returns (address buyPair, address sellPair, bool tokenIs0) {
        if (msg.sender != executor && msg.sender != owner) revert NotExecutor();
        if (block.number > deadlineBlock) revert Expired();
        if (token == address(weth)) revert InvalidToken();
        if (amountIn == 0) revert InvalidParams();
        if (bribeBps > BPS) revert InvalidBribe();

        (buyPair, sellPair) = buyOnA
            ? (_pairFor(factoryA, initCodeHashA, token), _pairFor(factoryB, initCodeHashB, token))
            : (_pairFor(factoryB, initCodeHashB, token), _pairFor(factoryA, initCodeHashA, token));
        tokenIs0 = token < address(weth);
    }

    /// @dev Best-effort direct payment to the block builder, taken from profit.
    ///      Failure is tolerated: the ETH stays here and is owner-withdrawable.
    function _payBribe(uint256 profit, uint256 bribeBps) private returns (uint256 bribe) {
        if (bribeBps == 0) return 0;
        bribe = profit * bribeBps / BPS;
        if (bribe == 0) return 0;
        weth.withdraw(bribe);
        (bool ok,) = block.coinbase.call{value: bribe}("");
        if (!ok) bribe = 0;
    }

    function _orientedReserves(address pair, bool tokenIs0)
        private
        view
        returns (uint256 rToken, uint256 rWeth)
    {
        (uint112 r0, uint112 r1,) = IUniswapV2Pair(pair).getReserves();
        (rToken, rWeth) = tokenIs0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
    }

    /// @dev CREATE2 pair derivation (UniswapV2Library.pairFor). No external call,
    ///      and immune to spoofed pair addresses by construction.
    function _pairFor(address factory, bytes32 initCodeHash, address token)
        private
        view
        returns (address pair)
    {
        (address t0, address t1) =
            token < address(weth) ? (token, address(weth)) : (address(weth), token);
        pair = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            hex"ff", factory, keccak256(abi.encodePacked(t0, t1)), initCodeHash
                        )
                    )
                )
            )
        );
    }

    /// @dev UniswapV2Library.getAmountOut, 0.3% fee.
    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        private
        pure
        returns (uint256)
    {
        uint256 amountInWithFee = amountIn * 997;
        return (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
    }

    /// @dev UniswapV2Library.getAmountIn, 0.3% fee. Reverts (checked math) if
    ///      amountOut >= reserveOut — i.e. trying to drain the pool.
    function _getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
        private
        pure
        returns (uint256)
    {
        return (reserveIn * amountOut * 1000) / ((reserveOut - amountOut) * 997) + 1;
    }

    /// @dev Transfer that tolerates non-standard ERC20s (no return value, e.g. USDT).
    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory ret) =
            token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
