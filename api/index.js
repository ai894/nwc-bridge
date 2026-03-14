// NWC Bridge - HTTP GET endpoint for Lightning payments via Nostr Wallet Connect
// All credentials are passed as URL parameters (designed for AI agent use)

import "websocket-polyfill";
import { NWCClient } from "@getalby/sdk/nwc";

/**
 * Parse NWC connection string from URL param.
 * Accepts URL-encoded nostr+walletconnect:// strings.
 */
function parseNWC(raw) {
  if (!raw) throw new Error("Missing nwc parameter");
  const decoded = decodeURIComponent(raw);
  if (!decoded.startsWith("nostr+walletconnect://")) {
    throw new Error("Invalid NWC connection string (must start with nostr+walletconnect://)");
  }
  return decoded;
}

/**
 * Create a NWCClient and ensure it disconnects after use.
 */
async function withNWC(nwcUrl, fn) {
  const client = new NWCClient({ nostrWalletConnectUrl: nwcUrl });
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

/**
 * Send JSON response
 */
function json(res, statusCode, data) {
  res.status(statusCode).json(data);
}

/**
 * Route handlers
 */
const routes = {
  // GET /balance?nwc=<url>
  // Returns balance of the wallet in sats
  "/balance": async (query, res) => {
    const nwcUrl = parseNWC(query.nwc);
    const result = await withNWC(nwcUrl, (client) => client.getBalance());
    return { balance_msats: result.balance, balance_sats: Math.floor(result.balance / 1000) };
  },

  // GET /pay?from_nwc=<url>&invoice=<bolt11>
  // Pay a BOLT11 invoice from the "from" wallet
  "/pay": async (query, res) => {
    const fromUrl = parseNWC(query.from_nwc);
    const { invoice } = query;
    if (!invoice) throw new Error("Missing invoice parameter");
    if (!invoice.toLowerCase().startsWith("ln")) throw new Error("Invalid invoice (must start with ln...)");

    const result = await withNWC(fromUrl, (client) =>
      client.payInvoice({ invoice })
    );
    return { preimage: result.preimage, success: true };
  },

  // GET /send?from_nwc=<url>&to_nwc=<url>&amount_sats=<n>&memo=<optional>
  // Create invoice on "to" wallet, then pay it from "from" wallet
  "/send": async (query) => {
    const fromUrl = parseNWC(query.from_nwc);
    const toUrl = parseNWC(query.to_nwc);
    const amountSats = parseInt(query.amount_sats, 10);

    if (!Number.isInteger(amountSats) || amountSats <= 0) {
      throw new Error("Invalid amount_sats (must be a positive integer)");
    }

    const memo = query.memo ? decodeURIComponent(query.memo) : "NWC Bridge transfer";

    // Step 1: Create invoice on "to" wallet
    const { invoice } = await withNWC(toUrl, (client) =>
      client.makeInvoice({ amount: amountSats * 1000, description: memo })
    );

    // Step 2: Pay invoice from "from" wallet
    const payResult = await withNWC(fromUrl, (client) =>
      client.payInvoice({ invoice })
    );

    return {
      success: true,
      amount_sats: amountSats,
      memo,
      preimage: payResult.preimage,
      invoice,
    };
  },

  // GET / - API documentation
  "/": async () => {
    return {
      name: "NWC Bridge",
      description: "HTTP GET endpoints for Lightning payments via Nostr Wallet Connect. Designed for AI agent use.",
      version: "1.0.0",
      endpoints: {
        "GET /balance": {
          description: "Get wallet balance in sats",
          params: {
            nwc: "nostr+walletconnect:// connection string (URL-encoded)",
          },
          example: "/balance?nwc=nostr%2Bwalletconnect%3A%2F%2F...",
          response: { balance_msats: "number", balance_sats: "number" },
        },
        "GET /pay": {
          description: "Pay a BOLT11 invoice from a wallet",
          params: {
            from_nwc: "Source wallet NWC connection string (URL-encoded)",
            invoice: "BOLT11 invoice to pay",
          },
          example: "/pay?from_nwc=nostr%2Bwalletconnect%3A%2F%2F...&invoice=lnbc...",
          response: { success: true, preimage: "string" },
        },
        "GET /send": {
          description: "Send sats from one NWC wallet to another (auto-creates invoice)",
          params: {
            from_nwc: "Source wallet NWC connection string (URL-encoded)",
            to_nwc: "Destination wallet NWC connection string (URL-encoded)",
            amount_sats: "Amount in satoshis (positive integer)",
            memo: "(optional) Payment memo/description (URL-encoded)",
          },
          example: "/send?from_nwc=nostr%2Bwalletconnect%3A%2F%2F...&to_nwc=nostr%2Bwalletconnect%3A%2F%2F...&amount_sats=100",
          response: {
            success: true,
            amount_sats: "number",
            memo: "string",
            preimage: "string",
            invoice: "string",
          },
        },
      },
      note: "All NWC connection strings must be URL-encoded. Credentials are not stored.",
    };
  },
};

/**
 * Main Vercel handler
 */
export default async function handler(req, res) {
  // Only allow GET
  if (req.method !== "GET") {
    return json(res, 405, { error: "Method not allowed. Only GET is supported." });
  }

  // Parse path (strip query string if present)
  const path = (req.url || "/").split("?")[0];
  const routeHandler = routes[path];

  if (!routeHandler) {
    return json(res, 404, {
      error: "Not found",
      available_endpoints: Object.keys(routes).filter((r) => r !== "/"),
      docs: "/",
    });
  }

  try {
    const result = await routeHandler(req.query || {});
    return json(res, 200, result);
  } catch (err) {
    const message = err?.message || "Unknown error";
    const isClientError = [
      "Missing",
      "Invalid",
      "must be",
      "must start with",
    ].some((s) => message.includes(s));

    return json(res, isClientError ? 400 : 500, {
      error: message,
      success: false,
    });
  }
}
