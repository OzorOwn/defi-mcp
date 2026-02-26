#!/usr/bin/env node
/**
 * DeFi MCP Server
 * Model Context Protocol server exposing crypto/DeFi primitives to AI agents.
 *
 * Tools:
 *   - get_token_price         — current price(s) from CoinGecko
 *   - search_tokens           — search tokens by name/symbol
 *   - get_token_info          — full token metadata + market data
 *   - get_top_tokens          — top N tokens by market cap
 *   - get_eth_balance         — ETH balance of any EVM wallet
 *   - get_token_balance       — ERC-20 token balance
 *   - get_wallet_holdings     — token history for an EVM wallet
 *   - get_multichain_balance  — native balance across 6 EVM chains
 *   - get_eth_gas             — Ethereum gas prices (EIP-1559)
 *   - get_multichain_gas      — gas prices across 6 chains
 *   - get_dex_quote_eth       — 1inch swap quote (EVM)
 *   - get_dex_quote_sol       — Jupiter swap quote (Solana)
 *
 * Usage:
 *   node src/index.js            (stdio transport, for Claude Desktop)
 *   MCP_TRANSPORT=http node src/index.js   (HTTP transport, for remote agents)
 */

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { getTokenPrices, searchTokens, getTokenInfo, getTopTokens } from './tools/prices.js';
import { getEthGasPrices, getMultiChainGasPrices } from './tools/gas.js';
import { getEthBalance, getTokenBalance, getWalletTokenHoldings, getMultiChainBalance } from './tools/wallets.js';
import { get1inchQuote, getJupiterQuote, COMMON_TOKENS } from './tools/dex.js';

// ─── Tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_token_price',
    description: 'Get current price(s) for one or more tokens from CoinGecko. Use CoinGecko token IDs (e.g. "bitcoin", "ethereum", "solana"). Returns price, 24h change %, market cap, and 24h volume.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'CoinGecko token IDs, e.g. ["bitcoin", "ethereum", "solana"]',
          minItems: 1,
        },
        vs_currency: {
          type: 'string',
          description: 'Quote currency (default: "usd"). Supports usd, eur, btc, eth, etc.',
          default: 'usd',
        },
      },
      required: ['ids'],
    },
  },
  {
    name: 'search_tokens',
    description: 'Search for tokens by name or symbol. Returns top 10 matches with CoinGecko IDs, market cap rank.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Token name or symbol to search for' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_token_info',
    description: 'Get full token metadata and market data: description, contract addresses on all chains, ATH/ATL, supply, links.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'CoinGecko token ID (e.g. "bitcoin", "uniswap")' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_top_tokens',
    description: 'Get top N tokens ranked by market cap with price and 24h change.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of tokens to return (default 20, max 250)', default: 20 },
        vs_currency: { type: 'string', description: 'Quote currency (default: "usd")', default: 'usd' },
      },
    },
  },
  {
    name: 'get_eth_balance',
    description: 'Get native ETH balance for any Ethereum wallet address.',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'EVM wallet address (0x...)' },
      },
      required: ['address'],
    },
  },
  {
    name: 'get_token_balance',
    description: 'Get ERC-20 token balance for a wallet. Returns raw balance — divide by 10^decimals for human-readable amount.',
    inputSchema: {
      type: 'object',
      properties: {
        wallet_address: { type: 'string', description: 'EVM wallet address (0x...)' },
        token_address: { type: 'string', description: 'ERC-20 token contract address (0x...)' },
      },
      required: ['wallet_address', 'token_address'],
    },
  },
  {
    name: 'get_wallet_holdings',
    description: 'Get all ERC-20 tokens a wallet has interacted with (historical activity). Returns token contracts for further balance lookups.',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'EVM wallet address (0x...)' },
      },
      required: ['address'],
    },
  },
  {
    name: 'get_multichain_balance',
    description: 'Get native token balance for a wallet across 6 EVM chains simultaneously: Ethereum, BSC, Polygon, Arbitrum, Optimism, Base.',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'EVM wallet address (0x...)' },
      },
      required: ['address'],
    },
  },
  {
    name: 'get_eth_gas',
    description: 'Get current Ethereum gas prices: base fee, and slow/normal/fast priority fee suggestions (EIP-1559). All values in gwei.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_multichain_gas',
    description: 'Get current gas prices across 6 EVM chains: Ethereum, BSC, Polygon, Arbitrum, Optimism, Base.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_dex_quote_eth',
    description: 'Get a DEX swap quote from 1inch for any EVM chain. Returns best route and expected output amount.',
    inputSchema: {
      type: 'object',
      properties: {
        chain_id: { type: 'number', description: 'EVM chain ID: 1=Ethereum, 56=BSC, 137=Polygon, 42161=Arbitrum, 10=Optimism, 8453=Base' },
        from_token: { type: 'string', description: 'Source token contract address. Use 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE for native ETH.' },
        to_token: { type: 'string', description: 'Destination token contract address' },
        amount: { type: 'string', description: 'Amount in smallest unit (wei for ETH). E.g. "1000000000000000000" = 1 ETH' },
      },
      required: ['chain_id', 'from_token', 'to_token', 'amount'],
    },
  },
  {
    name: 'get_dex_quote_sol',
    description: 'Get a DEX swap quote from Jupiter for Solana tokens. Returns best route and output amount.',
    inputSchema: {
      type: 'object',
      properties: {
        input_mint: { type: 'string', description: 'Input token mint address (e.g. "So11111111111111111111111111111111111111112" for SOL)' },
        output_mint: { type: 'string', description: 'Output token mint address (e.g. "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" for USDC)' },
        amount: { type: 'number', description: 'Amount in lamports (1 SOL = 1000000000 lamports)' },
        slippage_bps: { type: 'number', description: 'Slippage tolerance in basis points (default 50 = 0.5%)', default: 50 },
      },
      required: ['input_mint', 'output_mint', 'amount'],
    },
  },
];

// ─── Tool dispatcher ──────────────────────────────────────────────────────────

async function callTool(name, args) {
  switch (name) {
    case 'get_token_price':
      return getTokenPrices(args.ids, args.vs_currency);

    case 'search_tokens':
      return searchTokens(args.query);

    case 'get_token_info':
      return getTokenInfo(args.id);

    case 'get_top_tokens':
      return getTopTokens(args.limit, args.vs_currency);

    case 'get_eth_balance':
      return getEthBalance(args.address);

    case 'get_token_balance':
      return getTokenBalance(args.wallet_address, args.token_address);

    case 'get_wallet_holdings':
      return getWalletTokenHoldings(args.address);

    case 'get_multichain_balance':
      return getMultiChainBalance(args.address);

    case 'get_eth_gas':
      return getEthGasPrices();

    case 'get_multichain_gas':
      return getMultiChainGasPrices();

    case 'get_dex_quote_eth':
      return get1inchQuote(args.chain_id, args.from_token, args.to_token, args.amount);

    case 'get_dex_quote_sol':
      return getJupiterQuote(args.input_mint, args.output_mint, args.amount, args.slippage_bps ?? 50);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP Server setup ─────────────────────────────────────────────────────────

const server = new Server(
  { name: 'defi-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await callTool(name, args || {});
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: error.message, tool: name }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('DeFi MCP Server running on stdio\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
