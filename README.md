# defi-mcp

**Model Context Protocol server for DeFi/crypto primitives.**

Give any MCP-compatible AI agent (Claude, GPT-4, etc.) direct access to live on-chain data: token prices, wallet balances, gas prices, and DEX swap quotes — with a single MCP config entry.

---

## Tools

| Tool | Description | Data Source |
|------|-------------|-------------|
| `get_token_price` | Price, 24h change %, market cap for 1+ tokens | CoinGecko |
| `search_tokens` | Search by name/symbol → get CoinGecko IDs | CoinGecko |
| `get_token_info` | Full metadata: contract addresses, ATH, supply | CoinGecko |
| `get_top_tokens` | Top N tokens by market cap | CoinGecko |
| `get_eth_balance` | Native ETH balance for any wallet | Public RPC |
| `get_token_balance` | ERC-20 balance for wallet+contract pair | Etherscan / Public RPC |
| `get_wallet_holdings` | Tokens with historical activity for a wallet | Etherscan |
| `get_multichain_balance` | Native balance across 6 EVM chains at once | Public RPCs |
| `get_eth_gas` | Base fee + EIP-1559 priority fee suggestions | Public RPC |
| `get_multichain_gas` | Gas prices on 6 chains simultaneously | Public RPCs |
| `get_dex_quote_eth` | Best swap quote via 1inch (any EVM chain) | 1inch API |
| `get_dex_quote_sol` | Best swap quote via Jupiter (Solana) | Jupiter API |

**Supported chains**: Ethereum, BSC, Polygon, Arbitrum, Optimism, Base (+ Solana for DEX)

---

## Quick Start

```bash
git clone https://github.com/OzorOwn/defi-mcp
cd defi-mcp
npm install
cp .env.example .env
node src/index.js   # runs on stdio
```

### Claude Desktop config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "defi-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/defi-mcp/src/index.js"],
      "env": {
        "COINGECKO_API_KEY": "",
        "ETHERSCAN_API_KEY": ""
      }
    }
  }
}
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `COINGECKO_API_KEY` | No | Pro key for higher rate limits |
| `ETHERSCAN_API_KEY` | No | Needed for `get_wallet_holdings`; token balance falls back to RPC |
| `ONEINCH_API_KEY` | No | Required for `get_dex_quote_eth` (free at portal.1inch.dev) |
| `ETH_RPC_URL` | No | Override default public Ethereum RPC |
| `BSC_RPC_URL` | No | Override default public BSC RPC |

All tools work without API keys using public endpoints (rate limits apply).

---

## Example Agent Queries

```
"What's the current price of ETH and BTC?"
→ calls get_token_price(["ethereum", "bitcoin"])

"How much ETH does vitalik.eth hold?"
→ calls get_eth_balance("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")

"What's the gas price on Arbitrum right now?"
→ calls get_multichain_gas() → returns arbitrum entry

"How much USDC would I get for 1 ETH on Ethereum?"
→ calls get_dex_quote_eth(1, "0xEeee...", "0xA0b8...", "1000000000000000000")
```

---

## Testing

```bash
# Live API integration test (requires internet)
node tests/api_check.js

# With verbose output
VERBOSE=1 node tests/api_check.js
```

---

## Architecture

```
src/
├── index.js          — MCP server, tool registry, request handler
├── tools/
│   ├── prices.js     — CoinGecko: prices, search, metadata
│   ├── gas.js        — EVM RPC: gas prices, multi-chain
│   ├── wallets.js    — EVM RPC + Etherscan: balances, holdings
│   └── dex.js        — 1inch (EVM) + Jupiter (Solana): swap quotes
└── utils/
    └── http.js       — fetch wrapper with retry + timeout
```

**Transport**: stdio (MCP standard). Compatible with Claude Desktop, Continue.dev, and any MCP host.

---

## License

MIT
