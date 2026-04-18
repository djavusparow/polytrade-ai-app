import type { PolymarketMarket, MarketPrice } from './types'

const GAMMA_API = 'https://gamma-api.polymarket.com'
const CLOB_API = 'https://clob.polymarket.com'

// ─── Public Market Data ───────────────────────────────────────────────────────

export async function fetchActiveMarkets(limit = 50, offset = 0): Promise<PolymarketMarket[]> {
  try {
    const params = new URLSearchParams({
      active: 'true',
      closed: 'false',
      limit: String(limit),
      offset: String(offset),
    })
    const res = await fetch(`${GAMMA_API}/markets?${params}`, {
      next: { revalidate: 30 },
    })
    if (!res.ok) throw new Error(`Gamma API error: ${res.status}`)
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch (e) {
    console.error('[polytrade] fetchActiveMarkets error:', e)
    return []
  }
}

export async function fetchMarketByConditionId(conditionId: string): Promise<PolymarketMarket | null> {
  try {
    const res = await fetch(`${GAMMA_API}/markets/${conditionId}`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function fetchTopVolumeMarkets(limit = 20): Promise<PolymarketMarket[]> {
  try {
    const params = new URLSearchParams({
      active: 'true',
      closed: 'false',
      limit: String(limit),
      order: 'volume24hr',
      ascending: 'false',
    })
    const res = await fetch(`${GAMMA_API}/markets?${params}`)
    if (!res.ok) throw new Error(`API error ${res.status}`)
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch (e) {
    console.error('[polytrade] fetchTopVolumeMarkets error:', e)
    return []
  }
}

// ─── CLOB Price Data ──────────────────────────────────────────────────────────

export async function fetchTokenPrice(tokenId: string): Promise<MarketPrice | null> {
  try {
    const res = await fetch(`${CLOB_API}/price?token_id=${tokenId}&side=BUY`)
    if (!res.ok) return null
    const data = await res.json()
    return {
      token_id: tokenId,
      price: parseFloat(data.price ?? '0'),
      bid: parseFloat(data.bid ?? '0'),
      ask: parseFloat(data.ask ?? '0'),
    }
  } catch {
    return null
  }
}

export async function fetchMarketBookSummary(tokenId: string) {
  try {
    const res = await fetch(`${CLOB_API}/book?token_id=${tokenId}`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// ─── Route Handler Wrappers (for server-side API routes) ─────────────────────

export async function serverFetchMarkets(limit = 50): Promise<PolymarketMarket[]> {
  return fetchActiveMarkets(limit)
}

export async function serverFetchTopMarkets(): Promise<PolymarketMarket[]> {
  return fetchTopVolumeMarkets(20)
}

// ─── Helper Utilities ─────────────────────────────────────────────────────────

export function getYesNoTokenIds(market: PolymarketMarket): { yes: string; no: string } | null {
  const tokens = market.clobTokenIds
  if (!tokens || tokens.length < 2) return null
  return { yes: tokens[0], no: tokens[1] }
}

export function parseOutcomePrice(priceStr: string | undefined): number {
  if (!priceStr) return 0
  try {
    const parsed = JSON.parse(priceStr)
    if (Array.isArray(parsed)) return parseFloat(parsed[0]) || 0
    return parseFloat(priceStr) || 0
  } catch {
    return parseFloat(priceStr) || 0
  }
}

export function formatVolume(vol: number | undefined): string {
  if (!vol) return '$0'
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(1)}K`
  return `$${vol.toFixed(0)}`
}
