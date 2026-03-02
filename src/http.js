/**
 * DeFi MCP — HTTP API Server
 *
 * Wraps all 12 MCP tools as REST endpoints + serves MCP over SSE.
 * This is the production entry point for VPS deployment.
 */
import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';
import crypto from 'crypto';

import { getTokenPrices, searchTokens, getTokenInfo, getTopTokens } from './tools/prices.js';
import { getEthGasPrices, getMultiChainGasPrices } from './tools/gas.js';
import { getEthBalance, getTokenBalance, getWalletTokenHoldings, getMultiChainBalance } from './tools/wallets.js';
import { get1inchQuote, getJupiterQuote, COMMON_TOKENS } from './tools/dex.js';
import requestLogger from '/root/clawdia-workspace/shared/request-logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = 3006;

// ─── Database ──────────────────────────────────────────────────────────────────
const db = new Database(join(__dirname, '..', 'data', 'mcp.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    key TEXT PRIMARY KEY,
    credits INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    last_used TEXT
  );
  CREATE TABLE IF NOT EXISTS topups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key TEXT,
    tx_hash TEXT UNIQUE,
    amount_usdc REAL,
    credits_added INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

function createApiKey() {
  const key = 'mcp_' + crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO api_keys (key, credits) VALUES (?, 0)').run(key);
  return key;
}

function getKeyInfo(key) {
  return db.prepare('SELECT * FROM api_keys WHERE key = ?').get(key);
}

function deductCredit(key) {
  const info = db.prepare('SELECT credits FROM api_keys WHERE key = ?').get(key);
  if (!info || info.credits <= 0) return false;
  db.prepare("UPDATE api_keys SET credits = credits - 1, last_used = datetime('now') WHERE key = ?").run(key);
  return true;
}

function addCredits(key, credits, txHash, amountUsdc) {
  db.prepare('INSERT INTO topups (api_key, tx_hash, amount_usdc, credits_added) VALUES (?, ?, ?, ?)').run(key, txHash, amountUsdc, credits);
  db.prepare('UPDATE api_keys SET credits = credits + ? WHERE key = ?').run(credits, key);
  return db.prepare('SELECT credits FROM api_keys WHERE key = ?').get(key);
}

function txHashExists(txHash) {
  return !!db.prepare('SELECT 1 FROM topups WHERE tx_hash = ?').get(txHash);
}

// ─── Tool dispatcher ─────────────────────────────────────────────────────────
const TOOL_MAP = {
  get_token_price: (args) => getTokenPrices(args.ids, args.vs_currency),
  search_tokens: (args) => searchTokens(args.query),
  get_token_info: (args) => getTokenInfo(args.id),
  get_top_tokens: (args) => getTopTokens(args.limit, args.vs_currency),
  get_eth_balance: (args) => getEthBalance(args.address),
  get_token_balance: (args) => getTokenBalance(args.wallet_address, args.token_address),
  get_wallet_holdings: (args) => getWalletTokenHoldings(args.address),
  get_multichain_balance: (args) => getMultiChainBalance(args.address),
  get_eth_gas: () => getEthGasPrices(),
  get_multichain_gas: () => getMultiChainGasPrices(),
  get_dex_quote_eth: (args) => get1inchQuote(args.chain_id, args.from_token, args.to_token, args.amount),
  get_dex_quote_sol: (args) => getJupiterQuote(args.input_mint, args.output_mint, args.amount, args.slippage_bps ?? 50),
};

// ─── Auth middleware ──────────────────────────────────────────────────────────
const ipRequestCounts = new Map();
const FREE_DAILY_LIMIT = 100;
setInterval(() => ipRequestCounts.clear(), 24 * 60 * 60 * 1000);

const openRoutes = ['/health', '/.well-known/agent.json', '/llms.txt', '/api/payments/info', '/api/keys/create', '/api/keys/balance', '/api/credits/topup', '/api/tools'];

async function authMiddleware(request, reply) {
  const path = request.url.split('?')[0];
  if (path === '/' || path === '/index.html' || path.startsWith('/favicon') || openRoutes.includes(path)) return;
  if (!path.startsWith('/api/')) return;

  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const key = authHeader.slice(7);
    const info = getKeyInfo(key);
    if (!info) return reply.code(401).send({ error: 'Invalid API key' });
    if (info.credits <= 0) return reply.code(402).send({ error: 'No credits remaining', topup: '/api/credits/topup' });
    deductCredit(key);
    request.apiKey = key;
    return;
  }

  const ip = request.headers['x-real-ip'] || request.ip;
  const count = ipRequestCounts.get(ip) || 0;
  if (count >= FREE_DAILY_LIMIT) {
    return reply.code(429).send({ error: 'Free tier daily limit reached', limit: FREE_DAILY_LIMIT, upgrade: 'POST /api/keys/create' });
  }
  ipRequestCounts.set(ip, count + 1);
}

// ─── Fastify server ───────────────────────────────────────────────────────────
const app = Fastify({ logger: true });
await app.register(cors, { origin: '*' });
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
await app.register(requestLogger, { serviceName: 'defi-mcp' });
await app.register(fastifyStatic, { root: join(__dirname, '..', 'public'), prefix: '/' });
app.addHook('onRequest', authMiddleware);

// ─── Core routes ──────────────────────────────────────────────────────────────

app.get('/health', async () => ({ status: 'ok', service: 'defi-mcp', version: '0.1.0', tools: Object.keys(TOOL_MAP).length }));

// List all available tools (mirrors MCP ListTools)
app.get('/api/tools', async () => {
  // Import tool definitions from the MCP index
  return { tools: Object.keys(TOOL_MAP), total: Object.keys(TOOL_MAP).length };
});

// Generic tool invocation endpoint (matches MCP CallTool pattern)
app.post('/api/call', async (request, reply) => {
  const { tool, args } = request.body || {};
  if (!tool || !TOOL_MAP[tool]) {
    return reply.code(400).send({ error: 'Invalid tool', available: Object.keys(TOOL_MAP) });
  }
  try {
    const result = await TOOL_MAP[tool](args || {});
    return { tool, result };
  } catch (err) {
    return reply.code(502).send({ error: err.message, tool });
  }
});

// ─── REST endpoint aliases (friendly URLs) ────────────────────────────────────

// Prices
app.get('/api/prices', async (request) => {
  const ids = (request.query.ids || 'bitcoin,ethereum').split(',');
  const vs = request.query.vs || 'usd';
  return getTokenPrices(ids, vs);
});

app.get('/api/search/:query', async (request) => searchTokens(request.params.query));

app.get('/api/token/:id', async (request) => getTokenInfo(request.params.id));

app.get('/api/top', async (request) => {
  const limit = parseInt(request.query.limit) || 20;
  return getTopTokens(limit, request.query.vs || 'usd');
});

// Gas
app.get('/api/gas', async () => getEthGasPrices());
app.get('/api/gas/all', async () => getMultiChainGasPrices());

// Wallets
app.get('/api/balance/:address', async (request) => getEthBalance(request.params.address));
app.get('/api/balance/:address/multi', async (request) => getMultiChainBalance(request.params.address));
app.get('/api/balance/:address/token/:token', async (request) => getTokenBalance(request.params.address, request.params.token));
app.get('/api/holdings/:address', async (request) => getWalletTokenHoldings(request.params.address));

// DEX quotes
app.get('/api/quote/evm', async (request, reply) => {
  const { chain_id, from, to, amount } = request.query;
  if (!chain_id || !from || !to || !amount) {
    return reply.code(400).send({ error: 'Required: chain_id, from, to, amount' });
  }
  return get1inchQuote(parseInt(chain_id), from, to, amount);
});

app.get('/api/quote/solana', async (request, reply) => {
  const { input_mint, output_mint, amount, slippage_bps } = request.query;
  if (!input_mint || !output_mint || !amount) {
    return reply.code(400).send({ error: 'Required: input_mint, output_mint, amount' });
  }
  return getJupiterQuote(input_mint, output_mint, parseInt(amount), parseInt(slippage_bps) || 50);
});

// Common token addresses reference
app.get('/api/tokens/common', async () => COMMON_TOKENS);

// ─── Payment routes ────────────────────────────────────────────────────────────

const CREDITS_PER_USDC = 500;

app.post('/api/keys/create', async () => {
  const key = createApiKey();
  return { api_key: key, credits: 0, message: 'Top up credits by sending USDC on Base. See /api/payments/info' };
});

app.post('/api/keys/balance', async (request, reply) => {
  const { api_key } = request.body || {};
  if (!api_key) return reply.code(400).send({ error: 'api_key required' });
  const info = getKeyInfo(api_key);
  if (!info) return reply.code(404).send({ error: 'API key not found' });
  return { api_key: info.key, credits: info.credits, created_at: info.created_at, last_used: info.last_used };
});

app.post('/api/credits/topup', async (request, reply) => {
  const { api_key, tx_hash } = request.body || {};
  if (!api_key || !tx_hash) return reply.code(400).send({ error: 'api_key and tx_hash required' });

  const info = getKeyInfo(api_key);
  if (!info) return reply.code(404).send({ error: 'API key not found' });
  if (txHashExists(tx_hash)) return reply.code(409).send({ error: 'Transaction already claimed' });

  try {
    const { ethers } = await import('ethers');
    const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC);
    const receipt = await provider.getTransactionReceipt(tx_hash);
    if (!receipt || receipt.status !== 1) return reply.code(400).send({ error: 'Transaction not found or failed' });

    const usdcAddress = (process.env.USDC_BASE || '').toLowerCase();
    const walletAddress = (process.env.BALL_WALLET_ADDRESS || '').toLowerCase();
    const transferTopic = ethers.id('Transfer(address,address,uint256)');
    let usdcAmount = 0n;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === usdcAddress && log.topics[0] === transferTopic && log.topics.length >= 3) {
        const to = '0x' + log.topics[2].slice(26).toLowerCase();
        if (to === walletAddress) usdcAmount += BigInt(log.data);
      }
    }

    if (usdcAmount === 0n) return reply.code(400).send({ error: 'No USDC transfer to our wallet found' });

    const amountUsdc = Number(usdcAmount) / 1e6;
    const credits = Math.floor(amountUsdc * CREDITS_PER_USDC);
    const result = addCredits(api_key, credits, tx_hash, amountUsdc);
    return { success: true, usdc_received: amountUsdc, credits_added: credits, total_credits: result.credits };
  } catch (err) {
    return reply.code(502).send({ error: 'Failed to verify transaction', detail: err.message });
  }
});

app.get('/api/payments/info', async () => ({
  wallet: process.env.BALL_WALLET_ADDRESS,
  chain: 'Base',
  token: 'USDC',
  token_address: process.env.USDC_BASE,
  rate: `${CREDITS_PER_USDC} credits per USDC`,
  cost_per_request: '1 credit',
  steps: [
    '1. POST /api/keys/create → get your api_key',
    '2. Send USDC on Base to the wallet above',
    '3. POST /api/credits/topup { "api_key": "...", "tx_hash": "0x..." }',
    '4. Use API with Authorization: Bearer <api_key>',
  ],
}));

// ─── Discovery files ──────────────────────────────────────────────────────────

app.get('/.well-known/agent.json', async (req, reply) => {
  reply.type('application/json');
  return {
    name: 'DeFi MCP Server',
    description: '12 crypto/DeFi tools for AI agents — prices, wallets, gas, DEX quotes. REST + MCP protocol.',
    url: 'http://defi-mcp.127.0.0.1.nip.io',
    version: '0.1.0',
    authentication: { type: 'bearer', description: 'Optional — free tier: 100 req/day' },
    payment: { method: 'USDC', chain: 'base', address: process.env.BALL_WALLET_ADDRESS || '' },
    endpoints: [
      { path: '/api/call', method: 'POST', description: 'Invoke any MCP tool: { "tool": "...", "args": {...} }' },
      { path: '/api/tools', method: 'GET', description: 'List all available tools' },
      { path: '/api/prices', method: 'GET', description: 'Token prices (CoinGecko)' },
      { path: '/api/search/:query', method: 'GET', description: 'Search tokens' },
      { path: '/api/token/:id', method: 'GET', description: 'Full token info' },
      { path: '/api/top', method: 'GET', description: 'Top tokens by market cap' },
      { path: '/api/gas', method: 'GET', description: 'Ethereum gas prices' },
      { path: '/api/gas/all', method: 'GET', description: 'Multi-chain gas prices' },
      { path: '/api/balance/:address', method: 'GET', description: 'ETH balance' },
      { path: '/api/balance/:address/multi', method: 'GET', description: 'Multi-chain balance' },
      { path: '/api/holdings/:address', method: 'GET', description: 'Wallet token holdings' },
      { path: '/api/quote/evm', method: 'GET', description: '1inch DEX quote' },
      { path: '/api/quote/solana', method: 'GET', description: 'Jupiter DEX quote' },
    ],
  };
});

app.get('/llms.txt', async (req, reply) => {
  reply.type('text/plain');
  return `# DeFi MCP Server
> 12 crypto/DeFi tools for AI agents — prices, wallets, gas, DEX quotes via REST + MCP.

## Base URL
http://defi-mcp.127.0.0.1.nip.io

## Authentication
Bearer token in Authorization header. Optional — free tier: 100 req/day by IP.

## Universal Tool Call
POST /api/call — invoke any tool by name
Body: { "tool": "get_token_price", "args": { "ids": ["bitcoin"] } }

## REST Endpoints

### Prices (CoinGecko)
- GET /api/prices?ids=bitcoin,ethereum&vs=usd — token prices
- GET /api/search/:query — search tokens by name/symbol
- GET /api/token/:id — full token info (id = coingecko id like "bitcoin")
- GET /api/top?limit=20 — top tokens by market cap

### Gas
- GET /api/gas — Ethereum gas prices (EIP-1559)
- GET /api/gas/all — gas prices across 6 EVM chains

### Wallets
- GET /api/balance/:address — ETH balance
- GET /api/balance/:address/multi — balance across 6 chains
- GET /api/balance/:address/token/:tokenAddress — ERC-20 balance
- GET /api/holdings/:address — all token holdings

### DEX Quotes
- GET /api/quote/evm?chain_id=1&from=0x...&to=0x...&amount=1000000000000000000
- GET /api/quote/solana?input_mint=So11...&output_mint=EPjF...&amount=1000000000

### Reference
- GET /api/tokens/common — common token addresses by chain
- GET /api/tools — list all available MCP tools

## MCP Protocol
This server also supports the Model Context Protocol (MCP) via stdio transport.
Install: npm i -g defi-mcp && defi-mcp (for Claude Desktop integration)

## Payment
Send USDC on Base to the wallet address from /api/payments/info.
1 USDC = 500 credits. Each API call costs 1 credit.
`;
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen({ port: PORT, host: '127.0.0.1' }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
  app.log.info(`DeFi MCP HTTP Server running on port ${PORT}`);
});
