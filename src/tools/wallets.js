/**
 * Wallet balance tools — Ethereum and EVM chains.
 */
import { fetchJSON } from '../utils/http.js';

const ETH_RPC = process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com';

async function rpcCall(rpcUrl, method, params = []) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result;
}

function hexToEth(hex) {
  return parseInt(hex, 16) / 1e18;
}

function isValidEvmAddress(addr) {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

/**
 * Get native ETH balance for a wallet address.
 */
export async function getEthBalance(address, rpcUrl = ETH_RPC) {
  if (!isValidEvmAddress(address)) throw new Error(`Invalid EVM address: ${address}`);
  const hex = await rpcCall(rpcUrl, 'eth_getBalance', [address, 'latest']);
  const eth = hexToEth(hex);
  return {
    address,
    network: 'ethereum',
    native_token: 'ETH',
    balance_eth: Math.round(eth * 1e8) / 1e8,
    balance_wei: parseInt(hex, 16).toString(),
  };
}

/**
 * Get ERC-20 token balance for a wallet using Etherscan API.
 */
export async function getTokenBalance(walletAddress, tokenAddress) {
  if (!isValidEvmAddress(walletAddress)) throw new Error(`Invalid wallet address: ${walletAddress}`);
  if (!isValidEvmAddress(tokenAddress)) throw new Error(`Invalid token address: ${tokenAddress}`);

  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    // Fallback: call balanceOf via eth_call
    return await getTokenBalanceViaRpc(walletAddress, tokenAddress);
  }

  const url = `https://api.etherscan.io/api?module=account&action=tokenbalance&contractaddress=${tokenAddress}&address=${walletAddress}&tag=latest&apikey=${apiKey}`;
  const data = await fetchJSON(url);
  if (data.status !== '1') throw new Error(`Etherscan error: ${data.message} — ${data.result}`);

  return {
    wallet: walletAddress,
    token_contract: tokenAddress,
    raw_balance: data.result,
    note: 'Divide by 10^decimals to get human-readable amount. Fetch token decimals via get_token_metadata.',
  };
}

/**
 * Fallback: get ERC-20 balance via raw eth_call (balanceOf).
 */
async function getTokenBalanceViaRpc(walletAddress, tokenAddress) {
  // balanceOf(address) selector: 0x70a08231
  const paddedAddr = walletAddress.slice(2).padStart(64, '0');
  const data = `0x70a08231${paddedAddr}`;
  const hex = await rpcCall(ETH_RPC, 'eth_call', [
    { to: tokenAddress, data },
    'latest'
  ]);
  const raw = BigInt(hex).toString();
  return {
    wallet: walletAddress,
    token_contract: tokenAddress,
    raw_balance: raw,
    note: 'Divide by 10^decimals for human-readable. No API key used (public RPC).',
  };
}

/**
 * Get multiple token balances for a wallet (Etherscan tokentx endpoint, no Pro needed).
 */
export async function getWalletTokenHoldings(address) {
  if (!isValidEvmAddress(address)) throw new Error(`Invalid EVM address: ${address}`);

  const apiKey = process.env.ETHERSCAN_API_KEY || 'YourApiKeyToken';
  const url = `https://api.etherscan.io/api?module=account&action=tokentx&address=${address}&startblock=0&endblock=999999999&sort=asc&apikey=${apiKey}`;

  const data = await fetchJSON(url);
  if (data.status === '0' && data.message === 'No transactions found') {
    return { address, tokens: [], note: 'No token transactions found' };
  }
  if (data.status !== '1') throw new Error(`Etherscan error: ${data.message}`);

  // Deduplicate by token contract
  const seen = new Map();
  for (const tx of data.result) {
    if (!seen.has(tx.contractAddress)) {
      seen.set(tx.contractAddress, {
        contract: tx.contractAddress,
        name: tx.tokenName,
        symbol: tx.tokenSymbol,
        decimals: parseInt(tx.tokenDecimal),
      });
    }
  }

  return {
    address,
    token_contracts: Array.from(seen.values()),
    count: seen.size,
    note: 'These are tokens with historical activity. Use get_token_balance for current balances.',
  };
}

/**
 * Get wallet native balance on multiple EVM chains simultaneously.
 */
export async function getMultiChainBalance(address) {
  if (!isValidEvmAddress(address)) throw new Error(`Invalid EVM address: ${address}`);

  const chains = {
    ethereum: { rpc: process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com', token: 'ETH' },
    bsc: { rpc: process.env.BSC_RPC_URL || 'https://bsc.publicnode.com', token: 'BNB' },
    polygon: { rpc: 'https://polygon.publicnode.com', token: 'MATIC' },
    arbitrum: { rpc: 'https://arbitrum-one.publicnode.com', token: 'ETH' },
    optimism: { rpc: 'https://optimism.publicnode.com', token: 'ETH' },
    base: { rpc: 'https://base.publicnode.com', token: 'ETH' },
  };

  const results = {};
  await Promise.allSettled(
    Object.entries(chains).map(async ([chain, { rpc, token }]) => {
      try {
        const hex = await rpcCall(rpc, 'eth_getBalance', [address, 'latest']);
        results[chain] = {
          native_token: token,
          balance: Math.round(hexToEth(hex) * 1e8) / 1e8,
          status: 'ok',
        };
      } catch (e) {
        results[chain] = { error: e.message, status: 'error' };
      }
    })
  );

  return { address, balances: results };
}
