import { NextResponse } from 'next/server'
import { buildClobHeaders, resolveCredentials } from '@/lib/clob-auth'
import type { ClobCreds } from '@/lib/clob-auth'

/**
 * POST /api/trade/execute
 *
 * Executes a real limit/GTC order on Polymarket CLOB.
 * Reference: https://docs.polymarket.com/developers/CLOB/trading/creating-orders
 *
 * Body: {
 *   market_id, question, side ('YES'|'NO'), size, price,
 *   signal_confidence, ai_rationale, stop_loss_pct, take_profit_pct,
 *   credentials?: { apiKey, apiSecret, apiPassphrase, funderAddress }  <- from Settings UI
 * }
 */

const CLOB_HOST = 'https://clob.polymarket.com'
const GAMMA_HOST = 'https://gamma-api.polymarket.com'

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const {
      market_id,
      question,
      side,
      size,
      price,
      signal_confidence,
      ai_rationale,
      stop_loss_pct,
      take_profit_pct,
      credentials: clientCreds,  // passed from browser when env vars not set
    } = body

    // ── Resolve credentials ────────────────────────────────────────────────────
    const creds: ClobCreds | null = resolveCredentials(clientCreds)

    if (!creds) {
      return NextResponse.json(
        {
          error: 'Credentials not configured. Please enter your Polymarket API credentials in Settings and save them.',
          code: 'NO_CREDENTIALS',
        },
        { status: 401 }
      )
    }

    // ── 1. Fetch market details ────────────────────────────────────────────────
    const marketRes = await fetch(`${GAMMA_HOST}/markets/${market_id}`, { cache: 'no-store' })
    if (!marketRes.ok) {
      return NextResponse.json({ error: `Market ${market_id} not found` }, { status: 404 })
    }
    const market = await marketRes.json()

    const clobTokenIds: string[] = market.clobTokenIds ?? []
    if (clobTokenIds.length < 2) {
      return NextResponse.json(
        { error: 'Market does not have CLOB token IDs — not tradeable yet' },
        { status: 400 }
      )
    }

    // YES = index 0, NO = index 1
    const tokenId = side === 'YES' ? clobTokenIds[0] : clobTokenIds[1]
    const minTickSize: number = market.minimum_tick_size ?? 0.01
    const negRisk: boolean = market.neg_risk ?? false

    // ── 2. Round price to tick size ────────────────────────────────────────────
    const decimals = Math.max(0, -Math.floor(Math.log10(minTickSize)))
    const roundedPrice = parseFloat(price.toFixed(decimals))
    const clampedPrice = Math.max(minTickSize, Math.min(roundedPrice, 1 - minTickSize))

    // ── 3. Build order payload ─────────────────────────────────────────────────
    // signatureType: 0 = EOA (MetaMask), 1 = POLY_PROXY (Email/Magic login)
    // Resolved from credentials saved in Settings or env vars
    const signatureType = creds.signatureType ?? 1

    const orderBody = JSON.stringify({
      orderType: 'GTC',               // Good-til-cancelled limit order
      tokenID: tokenId,
      price: clampedPrice,
      size: Number(size),
      side: 'BUY',                    // Always BUY the outcome token (YES or NO share)
      funderAddress: creds.funderAddress,
      signatureType,
      expiration: '0',
    })

    // ── 4. Sign and post order to CLOB ─────────────────────────────────────────
    const orderPath = '/order'
    const headers = await buildClobHeaders(creds, 'POST', orderPath, orderBody)

    const orderRes = await fetch(`${CLOB_HOST}${orderPath}`, {
      method: 'POST',
      headers,
      body: orderBody,
    })

    const orderData = await orderRes.json()

    if (!orderRes.ok) {
      console.error('[trade/execute] CLOB order error:', orderRes.status, orderData)
      return NextResponse.json(
        { error: orderData?.error ?? orderData?.message ?? `CLOB error ${orderRes.status}` },
        { status: orderRes.status }
      )
    }

    // ── 5. Extract result ──────────────────────────────────────────────────────
    const orderId: string = orderData?.orderID ?? orderData?.order_id ?? orderData?.id ?? crypto.randomUUID()
    const status: string = orderData?.status ?? 'LIVE'
    const conditionId: string = market.condition_id ?? market_id

    const entryPrice: number = clampedPrice
    const stopLoss: number = parseFloat((entryPrice * (1 - (stop_loss_pct ?? 30) / 100)).toFixed(4))
    const takeProfit: number = Math.min(
      parseFloat((entryPrice * (1 + (take_profit_pct ?? 80) / 100)).toFixed(4)),
      0.99
    )

    console.log('[trade/execute] Order placed:', {
      market: question,
      side,
      tokenId,
      price: clampedPrice,
      size,
      orderId,
      status,
      confidence: signal_confidence,
    })

    return NextResponse.json({
      success: true,
      trade_id: crypto.randomUUID(),
      order_id: orderId,
      condition_id: conditionId,
      token_id: tokenId,
      status,
      price: clampedPrice,
      size,
      side,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      neg_risk: negRisk,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[api/trade/execute] error:', msg)
    return NextResponse.json(
      { error: `Trade execution failed: ${msg}` },
      { status: 500 }
    )
  }
}
