# NWC Bridge

HTTP GET endpoints for Lightning payments via [Nostr Wallet Connect](https://nwc.dev). Designed for AI agents and HTTP-GET-only clients.

## Endpoints

### `GET /`
API documentation.

---

### `GET /balance?nwc=<url>`
Get wallet balance.

**Params:**
- `nwc` — NWC connection string (URL-encoded)

**Response:**
```json
{ "balance_msats": 100000, "balance_sats": 100 }
```

---

### `GET /pay?from_nwc=<url>&invoice=<bolt11>`
Pay a BOLT11 invoice.

**Params:**
- `from_nwc` — Source wallet NWC connection string (URL-encoded)
- `invoice` — BOLT11 invoice to pay

**Response:**
```json
{ "success": true, "preimage": "..." }
```

---

### `GET /send?from_nwc=<url>&to_nwc=<url>&amount_sats=<n>&memo=<optional>`
Send sats from one NWC wallet to another (auto-creates invoice on destination).

**Params:**
- `from_nwc` — Source wallet NWC connection string (URL-encoded)
- `to_nwc` — Destination wallet NWC connection string (URL-encoded)
- `amount_sats` — Amount in satoshis (positive integer)
- `memo` — (optional) Payment description (URL-encoded)

**Response:**
```json
{
  "success": true,
  "amount_sats": 100,
  "memo": "payment note",
  "preimage": "...",
  "invoice": "lnbc..."
}
```

---

## Notes
- All NWC connection strings must be URL-encoded (`encodeURIComponent()`)
- Credentials are not stored; they are used per-request only
- All endpoints are unauthenticated and public — only share your NWC URLs with trusted callers

## Deploy

```bash
npm install
npx vercel --prod
```

## Test

```bash
npm test
```
