/**
 * Gas price tools — Ethereum and L2 networks.
 * Uses public RPC + Etherscan API.
 */
import { fetchJSON } from '../utils/http.js';

const ETH_RPC = process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com';

/**
 * Call an EVM JSON-RPC method.
 */
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

function hexToGwei(hex) {
  return Math.round(parseInt(hex, 16) / 1e9 * 100) / 100;
}

function hexToEth(hex) {
  return parseInt(hex, 16) / 1e18;
}

/**
 * Get current Ethereum gas prices (base fee, priority fee suggestions).
 */
export async function getEthGasPrices() {
  const [gasPriceHex, feeHistoryRaw] = await Promise.all([
    rpcCall(ETH_RPC, 'eth_gasPrice'),
    rpcCall(ETH_RPC, 'eth_feeHistory', ['0x5', 'latest', [10, 50, 90]]).catch(() => null),
  ]);

  const gasPriceGwei = hexToGwei(gasPriceHex);

  let baseFeeGwei = null;
  let slowPriorityGwei = null;
  let normalPriorityGwei = null;
  let fastPriorityGwei = null;

  if (feeHistoryRaw?.baseFeePerGas?.length) {
    const baseHex = feeHistoryRaw.baseFeePerGas[feeHistoryRaw.baseFeePerGas.length - 1];
    baseFeeGwei = hexToGwei(baseHex);

    if (feeHistoryRaw.reward?.length) {
      const rewards = feeHistoryRaw.reward;
      const avg = (idx) => {
        const vals = rewards.map(r => parseInt(r[idx], 16) / 1e9);
        return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100;
      };
      slowPriorityGwei = avg(0);
      normalPriorityGwei = avg(1);
      fastPriorityGwei = avg(2);
    }
  }

  return {
    network: 'ethereum',
    unit: 'gwei',
    gas_price: gasPriceGwei,
    base_fee: baseFeeGwei,
    priority_fee: {
      slow: slowPriorityGwei ?? Math.round(gasPriceGwei * 0.8 * 100) / 100,
      normal: normalPriorityGwei ?? gasPriceGwei,
      fast: fastPriorityGwei ?? Math.round(gasPriceGwei * 1.2 * 100) / 100,
    },
    estimated_cost_usd: null, // caller can multiply by ETH price
    note: 'EIP-1559: total fee = base_fee + priority_fee. Multiply gwei * 21000 for simple transfer.',
  };
}

/**
 * Get gas prices for multiple EVM networks via public RPCs.
 */
export async function getMultiChainGasPrices() {
  const networks = {
    ethereum: process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com',
    bsc: process.env.BSC_RPC_URL || 'https://bsc.publicnode.com',
    polygon: 'https://polygon.publicnode.com',
    arbitrum: 'https://arbitrum-one.publicnode.com',
    optimism: 'https://optimism.publicnode.com',
    base: 'https://base.publicnode.com',
  };

  const results = {};
  await Promise.allSettled(
    Object.entries(networks).map(async ([name, rpc]) => {
      try {
        const hex = await rpcCall(rpc, 'eth_gasPrice');
        results[name] = { gwei: hexToGwei(hex), status: 'ok' };
      } catch (e) {
        results[name] = { error: e.message, status: 'error' };
      }
    })
  );

  return results;
}
