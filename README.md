# defi-mcp

**MCP server for DeFi & crypto — 12 tools for token prices, wallet balances, gas fees, and DEX quotes.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-8A2BE2)](https://modelcontextprotocol.io)

Give any MCP-compatible AI (Claude, Cursor, Windsurf, Claude Code) direct access to live on-chain data. No API key required.

**[Tutorial: How to set up with Claude & Cursor](https://api-catalog-three.vercel.app/blog/defi-mcp-server-claude-cursor)** · **[REST API docs](https://api-catalog-three.vercel.app)**

---

## Try it now (no setup)

The server is also hosted as a free REST API. Try these right now:

```bash
# Bitcoin & Ethereum prices
curl "http://defi-mcp.your-server.example.com/api/prices?ids=bitcoin,ethereum"

# Ethereum gas prices (EIP-1559)
curl "http://defi-mcp.your-server.example.com/api/gas"

# Wallet balance across 6 EVM chains
curl "http://defi-mcp.your-server.example.com/api/balance/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045/multi"

# Top 10 tokens by market cap
curl "http://defi-mcp.your-server.example.com/api/top?limit=10"

# Solana DEX quote: 1 SOL → USDC via Jupiter
curl "http://defi-mcp.your-server.example.com/api/quote/solana?input_mint=So11111111111111111111111111111111111111112&output_mint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000"
```

100 free requests/day, no API key needed.

---

## Tools

| Tool | Description | Data Source |
|------|-------------|-------------|
| `get_token_price` | Price, 24h change %, market cap for 1+ tokens | CoinGecko |
| `search_tokens` | Search by name/symbol → CoinGecko IDs | CoinGecko |
| `get_token_info` | Full metadata: contract addresses, ATH, supply, links | CoinGecko |
| `get_top_tokens` | Top N tokens by market cap | CoinGecko |
| `get_eth_balance` | Native ETH balance for any wallet | Public RPC |
| `get_token_balance` | ERC-20 balance for wallet + contract pair | Etherscan / RPC |
| `get_wallet_holdings` | All tokens a wallet has interacted with | Etherscan |
| `get_multichain_balance` | Native balance across 6 EVM chains at once | Public RPCs |
| `get_eth_gas` | Base fee + EIP-1559 priority fee suggestions | Public RPC |
| `get_multichain_gas` | Gas prices on 6 chains simultaneously | Public RPCs |
| `get_dex_quote_eth` | Best swap quote via 1inch (any EVM chain) | 1inch API |
| `get_dex_quote_sol` | Best swap quote via Jupiter (Solana) | Jupiter API |

**Supported chains**: Ethereum, BSC, Polygon, Arbitrum, Optimism, Base + Solana (DEX)

---

## Setup: Claude Desktop

```bash
git clone https://github.com/OzorOwn/defi-mcp
cd defi-mcp
npm install
```

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "defi-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/defi-mcp/src/index.js"]
    }
  }
}
```

Restart Claude Desktop. You'll see the hammer icon indicating MCP tools are available.

## Setup: Cursor

Add to your project's `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "defi-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/defi-mcp/src/index.js"]
    }
  }
}
```

Or: Cursor Settings → Features → MCP Servers → Add new → stdio → `node /path/to/defi-mcp/src/index.js`

## Setup: Claude Code

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "defi-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/defi-mcp/src/index.js"]
    }
  }
}
```

**Works with any MCP host** — Windsurf, Continue.dev, Cline, or any stdio-based MCP client.

---

## Example Prompts

Once connected, ask your AI naturally:

```
"What's the current price of ETH and BTC?"
→ calls get_token_price(["ethereum", "bitcoin"])

"How much ETH does vitalik.eth hold?"
→ calls get_eth_balance("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")

"Compare gas prices across all supported chains"
→ calls get_multichain_gas()

"How much USDC would I get for 1 SOL on Jupiter?"
→ calls get_dex_quote_sol("So11...", "EPjF...", 1000000000)

"Show me the top 20 tokens by market cap"
→ calls get_top_tokens(20)

"What tokens has this wallet interacted with? 0xABC..."
→ calls get_wallet_holdings("0xABC...")
```

---

## REST API

All 12 tools are also available as a REST API at `http://defi-mcp.your-server.example.com`.

| Endpoint | Tool |
|----------|------|
| `GET /api/prices?ids=bitcoin,ethereum&vs=usd` | `get_token_price` |
| `GET /api/search/:query` | `search_tokens` |
| `GET /api/token/:id` | `get_token_info` |
| `GET /api/top?limit=20` | `get_top_tokens` |
| `GET /api/balance/:address` | `get_eth_balance` |
| `GET /api/balance/:address/token/:token` | `get_token_balance` |
| `GET /api/holdings/:address` | `get_wallet_holdings` |
| `GET /api/balance/:address/multi` | `get_multichain_balance` |
| `GET /api/gas` | `get_eth_gas` |
| `GET /api/gas/all` | `get_multichain_gas` |
| `GET /api/quote/evm?chain_id=1&from=...&to=...&amount=...` | `get_dex_quote_eth` |
| `GET /api/quote/solana?input_mint=...&output_mint=...&amount=...` | `get_dex_quote_sol` |
| `POST /api/call` | Universal tool invocation: `{"tool": "...", "args": {...}}` |

**Free tier**: 100 requests/day per IP, no key required.

**API key** (higher limits): `POST /api/keys/create` → get a key with 200 free credits. See the [Getting Started guide](https://api-catalog-three.vercel.app/guides/getting-started).

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `COINGECKO_API_KEY` | No | Pro key for higher rate limits |
| `ETHERSCAN_API_KEY` | No | Needed for `get_wallet_holdings`; balance falls back to RPC |
| `ONEINCH_API_KEY` | No | Required for `get_dex_quote_eth` (free at [portal.1inch.dev](https://portal.1inch.dev)) |
| `ETH_RPC_URL` | No | Override default public Ethereum RPC |
| `BSC_RPC_URL` | No | Override default public BSC RPC |

All tools work without API keys using public endpoints (rate limits apply).

---

## Architecture

```
src/
├── index.js          — MCP stdio server (12 tools via @modelcontextprotocol/sdk)
├── http.js           — Fastify REST API (same tools, production server)
├── tools/
│   ├── prices.js     — CoinGecko: prices, search, metadata, rankings
│   ├── gas.js        — EVM RPC: gas prices, multi-chain
│   ├── wallets.js    — EVM RPC + Etherscan: balances, holdings
│   └── dex.js        — 1inch (EVM) + Jupiter (Solana): swap quotes
└── utils/
    └── http.js       — fetch wrapper with retry + exponential backoff
```

---

## Part of Agent Gateway

This MCP server is one of **39 services** available through [Agent Gateway](https://api-catalog-three.vercel.app) — a unified API for AI agent infrastructure including wallet management, code execution, memory storage, scheduling, image processing, and more.

- [Full API Catalog](https://api-catalog-three.vercel.app) — Browse all 39 services
- [Getting Started Guide](https://api-catalog-three.vercel.app/guides/getting-started) — Create an API key and start building
- [Tutorial: DeFi MCP Server Setup](https://api-catalog-three.vercel.app/blog/defi-mcp-server-claude-cursor) — Step-by-step guide with examples
- [Tutorial: AI Agent + Crypto Wallet](https://api-catalog-three.vercel.app/blog/ai-agent-crypto-wallet) — Build an autonomous portfolio agent

---

## License

MIT
