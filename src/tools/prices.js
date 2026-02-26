/**
 * Token price tools — powered by CoinGecko API (free tier).
 */
import { fetchJSON } from '../utils/http.js';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

function cgHeaders() {
  const key = process.env.COINGECKO_API_KEY;
  return key ? { 'x-cg-pro-api-key': key } : {};
}

/**
 * Get current price(s) for one or more tokens.
 * @param {string[]} ids - CoinGecko token IDs, e.g. ["bitcoin", "ethereum"]
 * @param {string} vsCurrency - Quote currency, default "usd"
 */
export async function getTokenPrices(ids, vsCurrency = 'usd') {
  if (!ids || ids.length === 0) throw new Error('ids array is required');
  const joined = ids.join(',');
  const url = `${COINGECKO_BASE}/simple/price?ids=${encodeURIComponent(joined)}&vs_currencies=${vsCurrency}&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
  const data = await fetchJSON(url, { headers: cgHeaders() });
  return data;
}

/**
 * Search for a token by name or symbol and return top matches.
 */
export async function searchTokens(query) {
  if (!query) throw new Error('query is required');
  const url = `${COINGECKO_BASE}/search?query=${encodeURIComponent(query)}`;
  const data = await fetchJSON(url, { headers: cgHeaders() });
  const coins = (data.coins || []).slice(0, 10).map(c => ({
    id: c.id,
    name: c.name,
    symbol: c.symbol?.toUpperCase(),
    market_cap_rank: c.market_cap_rank,
    thumb: c.thumb,
  }));
  return { query, results: coins };
}

/**
 * Get full token info including market data.
 */
export async function getTokenInfo(id) {
  if (!id) throw new Error('id is required');
  const url = `${COINGECKO_BASE}/coins/${encodeURIComponent(id)}?localization=false&tickers=false&community_data=false&developer_data=false`;
  const data = await fetchJSON(url, { headers: cgHeaders() });
  return {
    id: data.id,
    name: data.name,
    symbol: data.symbol?.toUpperCase(),
    description: data.description?.en?.slice(0, 500) || '',
    homepage: data.links?.homepage?.[0] || '',
    contract_address: data.platforms || {},
    market_data: {
      price_usd: data.market_data?.current_price?.usd,
      market_cap_usd: data.market_data?.market_cap?.usd,
      volume_24h_usd: data.market_data?.total_volume?.usd,
      price_change_24h_pct: data.market_data?.price_change_percentage_24h,
      ath_usd: data.market_data?.ath?.usd,
      atl_usd: data.market_data?.atl?.usd,
      circulating_supply: data.market_data?.circulating_supply,
      total_supply: data.market_data?.total_supply,
    },
    last_updated: data.last_updated,
  };
}

/**
 * Get top N tokens by market cap.
 */
export async function getTopTokens(limit = 20, vsCurrency = 'usd') {
  const perPage = Math.min(limit, 250);
  const url = `${COINGECKO_BASE}/coins/markets?vs_currency=${vsCurrency}&order=market_cap_desc&per_page=${perPage}&page=1&sparkline=false&price_change_percentage=24h`;
  const data = await fetchJSON(url, { headers: cgHeaders() });
  return data.map(c => ({
    rank: c.market_cap_rank,
    id: c.id,
    name: c.name,
    symbol: c.symbol?.toUpperCase(),
    price_usd: c.current_price,
    market_cap_usd: c.market_cap,
    volume_24h_usd: c.total_volume,
    price_change_24h_pct: c.price_change_percentage_24h,
  }));
}
