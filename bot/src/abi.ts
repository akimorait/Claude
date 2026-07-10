export const FLASH_ARBITRAGE_ABI = [
  'function executeFlash(address token, uint256 tokenAmount, uint256 minProfit, uint256 deadlineBlock, bool buyOnA, uint256 bribeBps)',
  'function executeFunded(address token, uint256 wethIn, uint256 minProfit, uint256 deadlineBlock, bool buyOnA, uint256 bribeBps)',
  'function getPairs(address token) view returns (address pairA, address pairB)',
  'function executor() view returns (address)',
  'event ArbitrageExecuted(address indexed token, bool buyOnA, bool flash, uint256 amountIn, uint256 grossProfit, uint256 bribe)',
] as const;

export const PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
] as const;

export const ERC20_ABI = ['function balanceOf(address owner) view returns (uint256)'] as const;

export const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)',
] as const;
