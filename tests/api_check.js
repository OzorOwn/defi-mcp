/**
 * Live API integration tests — validates all data sources respond correctly.
 * Run: node tests/api_check.js
 */
import 'dotenv/config';
import { getTokenPrices, searchTokens, getTokenInfo, getTopTokens } from '../src/tools/prices.js';
import { getEthGasPrices, getMultiChainGasPrices } from '../src/tools/gas.js';
import { getEthBalance, getMultiChainBalance } from '../src/tools/wallets.js';
import { getJupiterQuote } from '../src/tools/dex.js';

const GREEN = '\x1b[32m✓\x1b[0m';
const RED = '\x1b[31m✗\x1b[0m';
const YELLOW = '\x1b[33m~\x1b[0m';

let passed = 0, failed = 0, skipped = 0;

async function test(label, fn, { skip = false } = {}) {
  if (skip) {
    console.log(`${YELLOW} SKIP  ${label}`);
    skipped++;
    return;
  }
  try {
    const result = await fn();
    console.log(`${GREEN} PASS  ${label}`);
    if (process.env.VERBOSE) console.log('      ', JSON.stringify(result).slice(0, 200));
    passed++;
    return result;
  } catch (err) {
    console.log(`${RED} FAIL  ${label}: ${err.message}`);
    failed++;
  }
}

console.log('\n=== DeFi MCP — Live API Check ===\n');

// Prices
await test('get_token_price [bitcoin, ethereum]', async () => {
  const r = await getTokenPrices(['bitcoin', 'ethereum']);
  if (!r.bitcoin?.usd) throw new Error('Missing bitcoin.usd');
  if (!r.ethereum?.usd) throw new Error('Missing ethereum.usd');
  console.log(`      BTC: $${r.bitcoin.usd.toLocaleString()}  ETH: $${r.ethereum.usd.toLocaleString()}`);
  return r;
});

await test('search_tokens [sol]', async () => {
  const r = await searchTokens('sol');
  if (!r.results?.length) throw new Error('No results');
  console.log(`      Top match: ${r.results[0].name} (${r.results[0].symbol})`);
  return r;
});

await test('get_token_info [uniswap]', async () => {
  const r = await getTokenInfo('uniswap');
  if (!r.market_data?.price_usd) throw new Error('Missing price');
  console.log(`      UNI price: $${r.market_data.price_usd}`);
  return r;
});

await test('get_top_tokens [top 5]', async () => {
  const r = await getTopTokens(5);
  if (r.length !== 5) throw new Error('Expected 5 tokens');
  console.log(`      #1: ${r[0].name} $${r[0].price_usd?.toLocaleString()}`);
  return r;
});

// Gas
await test('get_eth_gas', async () => {
  const r = await getEthGasPrices();
  if (!r.gas_price && r.gas_price !== 0) throw new Error('Missing gas_price');
  console.log(`      Gas: ${r.gas_price} gwei (base: ${r.base_fee} gwei)`);
  return r;
});

await test('get_multichain_gas', async () => {
  const r = await getMultiChainGasPrices();
  const ok = Object.entries(r).filter(([, v]) => v.status === 'ok');
  console.log(`      ${ok.length}/6 chains OK: ${ok.map(([k]) => k).join(', ')}`);
  if (ok.length === 0) throw new Error('No chains responded');
  return r;
});

// Wallets — using Vitalik's public address
const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
await test(`get_eth_balance [${VITALIK.slice(0,10)}...]`, async () => {
  const r = await getEthBalance(VITALIK);
  if (typeof r.balance_eth !== 'number') throw new Error('Missing balance_eth');
  console.log(`      Balance: ${r.balance_eth} ETH`);
  return r;
});

await test(`get_multichain_balance [${VITALIK.slice(0,10)}...]`, async () => {
  const r = await getMultiChainBalance(VITALIK);
  const ok = Object.entries(r.balances).filter(([, v]) => v.status === 'ok');
  console.log(`      ${ok.length}/6 chains OK`);
  return r;
});

// Jupiter (Solana) — SOL -> USDC (requires outbound access to jup.ag)
const jupiterReachable = await fetch('https://quote-api.jup.ag', { signal: AbortSignal.timeout(3000) })
  .then(() => true).catch(() => false);
await test('get_dex_quote_sol [SOL->USDC 1 SOL]', async () => {
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const r = await getJupiterQuote(SOL_MINT, USDC_MINT, 1_000_000_000); // 1 SOL
  if (!r.out_amount) throw new Error('Missing out_amount');
  const usdc = parseInt(r.out_amount) / 1e6;
  console.log(`      1 SOL -> ${usdc.toFixed(2)} USDC`);
  return r;
}, { skip: !jupiterReachable });

// Summary
console.log(`\n${'─'.repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}  Skipped: ${skipped}`);
if (failed > 0) process.exit(1);
