import { NextResponse } from 'next/server'
import { buildClobHeaders, resolveCredentials } from '@/lib/clob-auth'
import type { ClobCreds } from '@/lib/clob-auth'

const CLOB_HOST = 'https://clob.polymarket.com'

/**
 * GET /api/portfolio
 * Accepts optional header X-Clob-Creds (JSON) from the client
 * when server env vars are not configured.
 *
 * Returns: { balance, positions, configured, error? }
 */
export async function GET(request: Request) {
  // Try to get credentials passed from client Settings
  let clientCreds: Partial<ClobCreds> | undefined
  try {
    const raw = request.headers.get('X-Clob-Creds')
    if (raw) clientCreds = JSON.parse(raw)
  } catch {
    // ignore parse errors
  }

  const creds = resolveCredentials(clientCreds)

  if (!creds) {
    return NextResponse.json({
      balance: 0,
      positions: [],
      configured: false,
      message: 'Credentials not configured. Please enter your API credentials in Settings.',
    })
  }

  try {
    // ── Balance ───────────────────────────────────────────────────────────────
    const balancePath = '/balance-allowance?asset_type=USDC'
    const balHeaders = await buildClobHeaders(creds, 'GET', balancePath)

    const balanceRes = await fetch(`${CLOB_HOST}${balancePath}`, {
      headers: balHeaders,
      cache: 'no-store',
    })

    // ── Open Positions ────────────────────────────────────────────────────────
    const posPath = '/positions'
    const posHeaders = await buildClobHeaders(creds, 'GET', posPath)

    const posRes = await fetch(`${CLOB_HOST}${posPath}`, {
      headers: posHeaders,
      cache: 'no-store',
    })

    // ── Open Orders ───────────────────────────────────────────────────────────
    const ordersPath = '/orders'
    const ordersHeaders = await buildClobHeaders(creds, 'GET', ordersPath)

    const ordersRes = await fetch(`${CLOB_HOST}${ordersPath}`, {
      headers: ordersHeaders,
      cache: 'no-store',
    })

    let balance = 0
    let positions: unknown[] = []
    let orders: unknown[] = []

    if (balanceRes.ok) {
      const balData = await balanceRes.json()
      // Balance is returned in USDC, divide by 1e6 (USDC has 6 decimals)
      balance = parseFloat(balData?.balance ?? '0') / 1_000_000
      if (isNaN(balance)) balance = parseFloat(balData?.balance ?? '0')
    } else {
      const errText = await balanceRes.text()
      console.error('[api/portfolio] balance error:', balanceRes.status, errText)
    }

    if (posRes.ok) {
      const posData = await posRes.json()
      positions = Array.isArray(posData) ? posData : posData?.results ?? []
    }

    if (ordersRes.ok) {
      const ordData = await ordersRes.json()
      orders = Array.isArray(ordData) ? ordData : ordData?.data ?? []
    }

    return NextResponse.json({
      balance,
      positions,
      orders,
      configured: true,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error('[api/portfolio] error:', msg)
    return NextResponse.json({
      balance: 0,
      positions: [],
      orders: [],
      configured: true,
      error: `Failed to fetch portfolio: ${msg}`,
    }, { status: 500 })
  }
}
