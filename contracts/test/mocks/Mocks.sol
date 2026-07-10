// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}

interface IUniswapV2Callee {
    function uniswapV2Call(address sender, uint256 amount0, uint256 amount1, bytes calldata data)
        external;
}

contract MockERC20 is IERC20Minimal {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockWETH is IERC20Minimal {
    mapping(address => uint256) public balanceOf;

    function deposit() public payable {
        balanceOf[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "WETH: eth send failed");
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    receive() external payable {
        deposit();
    }
}

/// @dev Faithful reimplementation of UniswapV2Pair's swap accounting:
///      optimistic transfers, flash callback on `to`, balance-based input
///      detection and the 0.3%-fee K-invariant check.
contract MockPair {
    address public token0;
    address public token1;
    uint112 private reserve0;
    uint112 private reserve1;

    function initialize(address _token0, address _token1) external {
        require(token0 == address(0), "PAIR: initialized");
        token0 = _token0;
        token1 = _token1;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, 0);
    }

    /// @dev Test helper: absorb whatever was transferred in as liquidity.
    function sync() external {
        reserve0 = uint112(IERC20Minimal(token0).balanceOf(address(this)));
        reserve1 = uint112(IERC20Minimal(token1).balanceOf(address(this)));
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data)
        external
    {
        require(amount0Out > 0 || amount1Out > 0, "V2: INSUFFICIENT_OUTPUT_AMOUNT");
        (uint112 _reserve0, uint112 _reserve1) = (reserve0, reserve1);
        require(amount0Out < _reserve0 && amount1Out < _reserve1, "V2: INSUFFICIENT_LIQUIDITY");

        if (amount0Out > 0) IERC20Minimal(token0).transfer(to, amount0Out);
        if (amount1Out > 0) IERC20Minimal(token1).transfer(to, amount1Out);
        if (data.length > 0) {
            IUniswapV2Callee(to).uniswapV2Call(msg.sender, amount0Out, amount1Out, data);
        }

        uint256 balance0 = IERC20Minimal(token0).balanceOf(address(this));
        uint256 balance1 = IERC20Minimal(token1).balanceOf(address(this));
        uint256 amount0In = balance0 > _reserve0 - amount0Out ? balance0 - (_reserve0 - amount0Out) : 0;
        uint256 amount1In = balance1 > _reserve1 - amount1Out ? balance1 - (_reserve1 - amount1Out) : 0;
        require(amount0In > 0 || amount1In > 0, "V2: INSUFFICIENT_INPUT_AMOUNT");

        uint256 balance0Adjusted = balance0 * 1000 - amount0In * 3;
        uint256 balance1Adjusted = balance1 * 1000 - amount1In * 3;
        require(
            balance0Adjusted * balance1Adjusted >= uint256(_reserve0) * _reserve1 * 1e6, "V2: K"
        );

        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
    }
}

/// @dev CREATE2 factory mirroring UniswapV2Factory's salt scheme, so the
///      production `_pairFor` derivation works against these mocks unchanged.
contract MockFactory {
    mapping(address => mapping(address => address)) public getPair;

    function pairInitCodeHash() public pure returns (bytes32) {
        return keccak256(type(MockPair).creationCode);
    }

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        pair = address(new MockPair{salt: keccak256(abi.encodePacked(t0, t1))}());
        MockPair(pair).initialize(t0, t1);
        getPair[t0][t1] = pair;
        getPair[t1][t0] = pair;
    }
}
