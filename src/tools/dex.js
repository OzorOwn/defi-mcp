/**
 * DEX quote tools — swap quotes from 1inch and Jupiter (Solana).
 */
import { fetchJSON } from '../utils/http.js';

const ONEINCH_BASE = 'https://api.1inch.dev/swap/v6.0';
const JUPITER_QUOTE = 'https://quote-api.jup.ag/v6/quote';

/**
 * Common EVM token addresses for convenience.
 */
export const COMMON_TOKENS = {
  ethereum: {
    ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    UNI: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
    LINK: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
  },
};

/**
 * Get a DEX swap quote from 1inch.
 * @param {number} chainId - EVM chain ID (1=ETH, 56=BSC, 137=Polygon, 42161=Arbitrum)
 * @param {string} fromToken - Source token contract address
 * @param {string} toToken - Destination token contract address
 * @param {string} amount - Amount in smallest unit (wei for ETH)
 */
export async function get1inchQuote(chainId, fromToken, toToken, amount) {
  const apiKey = process.env.ONEINCH_API_KEY;
  const headers = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};

  const params = new URLSearchParams({
    src: fromToken,
    dst: toToken,
    amount: amount.toString(),
    includeProtocols: 'true',
    includeGas: 'true',
  });

  const url = `${ONEINCH_BASE}/${chainId}/quote?${params}`;
  const data = await fetchJSON(url, { headers });

  return {
    protocol: '1inch',
    chain_id: chainId,
    from_token: fromToken,
    to_token: toToken,
    from_amount: amount.toString(),
    to_amount: data.dstAmount || data.toAmount,
    estimated_gas: data.gas || data.estimatedGas,
    protocols: data.protocols?.map(p => p.flat().map(r => r.map(x => x.name)).flat()) || [],
    raw: data,
  };
}

/**
 * Get a Solana DEX swap quote from Jupiter.
 * @param {string} inputMint - Input token mint address
 * @param {string} outputMint - Output token mint address
 * @param {number} amount - Amount in lamports (or smallest unit)
 * @param {number} slippageBps - Slippage in basis points (e.g. 50 = 0.5%)
 */
export async function getJupiterQuote(inputMint, outputMint, amount, slippageBps = 50) {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: slippageBps.toString(),
  });

  const url = `${JUPITER_QUOTE}?${params}`;
  const data = await fetchJSON(url);

  return {
    protocol: 'Jupiter',
    chain: 'solana',
    input_mint: inputMint,
    output_mint: outputMint,
    in_amount: data.inAmount,
    out_amount: data.outAmount,
    price_impact_pct: data.priceImpactPct,
    slippage_bps: data.slippageBps,
    route_plan: data.routePlan?.map(r => ({
      swap_info: r.swapInfo?.label,
      percent: r.percent,
    })) || [],
  };
}

/**
 * Estimate value of a token amount at current price.
 * Utility helper: amount (in token units) * price_usd = USD value.
 */
export function estimateUSDValue(amount, decimals, priceUsd) {
  const humanAmount = Number(BigInt(amount)) / Math.pow(10, decimals);
  return {
    token_amount: humanAmount,
    price_usd: priceUsd,
    usd_value: Math.round(humanAmount * priceUsd * 100) / 100,
  };
}
