/**
 * NWC Bridge - Unit Tests
 * Uses Node.js built-in test runner (node --test)
 * Mocks NWCClient to avoid real wallet connections
 */

import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ---- Minimal mock for NWCClient ----
const mockBalance = { balance: 100000 }; // 100 sats in msats
const mockPayInvoiceResult = { preimage: "deadbeef01020304" };
const mockMakeInvoiceResult = { invoice: "lnbc1000n1test..." };

let nwcCallLog = [];

class MockNWCClient {
  constructor({ nostrWalletConnectUrl }) {
    this.url = nostrWalletConnectUrl;
  }
  async getBalance() {
    nwcCallLog.push({ method: "getBalance", url: this.url });
    return mockBalance;
  }
  async payInvoice({ invoice }) {
    nwcCallLog.push({ method: "payInvoice", url: this.url, invoice });
    return mockPayInvoiceResult;
  }
  async makeInvoice({ amount, description }) {
    nwcCallLog.push({ method: "makeInvoice", url: this.url, amount, description });
    return mockMakeInvoiceResult;
  }
  close() {
    nwcCallLog.push({ method: "close", url: this.url });
  }
}

// ---- Inline the core logic (same as api/index.js but dependency-injectable) ----
function createHandler(NWCClientImpl) {
  function parseNWC(raw) {
    if (!raw) throw new Error("Missing nwc parameter");
    const decoded = decodeURIComponent(raw);
    if (!decoded.startsWith("nostr+walletconnect://")) {
      throw new Error("Invalid NWC connection string (must start with nostr+walletconnect://)");
    }
    return decoded;
  }

  async function withNWC(nwcUrl, fn) {
    const client = new NWCClientImpl({ nostrWalletConnectUrl: nwcUrl });
    try {
      return await fn(client);
    } finally {
      client.close();
    }
  }

  const routes = {
    "/balance": async (query) => {
      const nwcUrl = parseNWC(query.nwc);
      const result = await withNWC(nwcUrl, (c) => c.getBalance());
      return { balance_msats: result.balance, balance_sats: Math.floor(result.balance / 1000) };
    },
    "/pay": async (query) => {
      const fromUrl = parseNWC(query.from_nwc);
      const { invoice } = query;
      if (!invoice) throw new Error("Missing invoice parameter");
      if (!invoice.toLowerCase().startsWith("ln")) throw new Error("Invalid invoice (must start with ln...)");
      const result = await withNWC(fromUrl, (c) => c.payInvoice({ invoice }));
      return { preimage: result.preimage, success: true };
    },
    "/send": async (query) => {
      const fromUrl = parseNWC(query.from_nwc);
      const toUrl = parseNWC(query.to_nwc);
      const amountSats = parseInt(query.amount_sats, 10);
      if (!Number.isInteger(amountSats) || amountSats <= 0) {
        throw new Error("Invalid amount_sats (must be a positive integer)");
      }
      const memo = query.memo ? decodeURIComponent(query.memo) : "NWC Bridge transfer";
      const { invoice } = await withNWC(toUrl, (c) =>
        c.makeInvoice({ amount: amountSats * 1000, description: memo })
      );
      const payResult = await withNWC(fromUrl, (c) => c.payInvoice({ invoice }));
      return { success: true, amount_sats: amountSats, memo, preimage: payResult.preimage, invoice };
    },
    "/": async () => ({ name: "NWC Bridge" }),
  };

  return async function handle(method, path, query) {
    if (method !== "GET") return { status: 405, body: { error: "Method not allowed" } };
    const routeHandler = routes[path];
    if (!routeHandler) return { status: 404, body: { error: "Not found" } };
    try {
      const result = await routeHandler(query);
      return { status: 200, body: result };
    } catch (err) {
      const message = err?.message || "Unknown error";
      const isClientError = ["Missing", "Invalid", "must be", "must start with"].some((s) => message.includes(s));
      return { status: isClientError ? 400 : 500, body: { error: message, success: false } };
    }
  };
}

const NWC_URL = "nostr+walletconnect://relay.example.com?pubkey=abc&secret=def";
const NWC_ENCODED = encodeURIComponent(NWC_URL);

// ---- Tests ----

describe("NWC Bridge", () => {
  let handle;

  beforeEach(() => {
    nwcCallLog = [];
    handle = createHandler(MockNWCClient);
  });

  // --- Method validation ---
  test("POST returns 405", async () => {
    const r = await handle("POST", "/balance", {});
    assert.equal(r.status, 405);
    assert.match(r.body.error, /Method not allowed/);
  });

  // --- Routing ---
  test("unknown path returns 404", async () => {
    const r = await handle("GET", "/unknown", {});
    assert.equal(r.status, 404);
  });

  test("GET / returns docs", async () => {
    const r = await handle("GET", "/", {});
    assert.equal(r.status, 200);
    assert.equal(r.body.name, "NWC Bridge");
  });

  // --- /balance ---
  describe("/balance", () => {
    test("returns balance in sats and msats", async () => {
      const r = await handle("GET", "/balance", { nwc: NWC_ENCODED });
      assert.equal(r.status, 200);
      assert.equal(r.body.balance_msats, 100000);
      assert.equal(r.body.balance_sats, 100);
    });

    test("missing nwc param → 400", async () => {
      const r = await handle("GET", "/balance", {});
      assert.equal(r.status, 400);
      assert.match(r.body.error, /Missing nwc/);
    });

    test("invalid nwc string → 400", async () => {
      const r = await handle("GET", "/balance", { nwc: encodeURIComponent("invalid://bad") });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /Invalid NWC/);
    });

    test("calls NWCClient.getBalance and closes connection", async () => {
      await handle("GET", "/balance", { nwc: NWC_ENCODED });
      assert.ok(nwcCallLog.some((c) => c.method === "getBalance"));
      assert.ok(nwcCallLog.some((c) => c.method === "close"));
    });
  });

  // --- /pay ---
  describe("/pay", () => {
    test("pays invoice and returns preimage", async () => {
      const r = await handle("GET", "/pay", {
        from_nwc: NWC_ENCODED,
        invoice: "lnbc1000n1testinvoice",
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.success, true);
      assert.equal(r.body.preimage, "deadbeef01020304");
    });

    test("missing from_nwc → 400", async () => {
      const r = await handle("GET", "/pay", { invoice: "lnbc..." });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /Missing nwc/);
    });

    test("missing invoice → 400", async () => {
      const r = await handle("GET", "/pay", { from_nwc: NWC_ENCODED });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /Missing invoice/);
    });

    test("invalid invoice format → 400", async () => {
      const r = await handle("GET", "/pay", {
        from_nwc: NWC_ENCODED,
        invoice: "notaninvoice",
      });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /Invalid invoice/);
    });
  });

  // --- /send ---
  describe("/send", () => {
    const from = encodeURIComponent("nostr+walletconnect://from.example.com?pubkey=aaa&secret=bbb");
    const to = encodeURIComponent("nostr+walletconnect://to.example.com?pubkey=ccc&secret=ddd");

    test("creates invoice on to-wallet and pays from from-wallet", async () => {
      const r = await handle("GET", "/send", {
        from_nwc: from,
        to_nwc: to,
        amount_sats: "100",
        memo: "test+payment",
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.success, true);
      assert.equal(r.body.amount_sats, 100);
      assert.equal(r.body.preimage, "deadbeef01020304");
      assert.ok(r.body.invoice.startsWith("ln"));
    });

    test("default memo is set when not provided", async () => {
      const r = await handle("GET", "/send", {
        from_nwc: from,
        to_nwc: to,
        amount_sats: "50",
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.memo, "NWC Bridge transfer");
    });

    test("makeInvoice called on to-wallet with correct msats", async () => {
      await handle("GET", "/send", { from_nwc: from, to_nwc: to, amount_sats: "100" });
      const makeCall = nwcCallLog.find((c) => c.method === "makeInvoice");
      assert.ok(makeCall, "makeInvoice should be called");
      assert.equal(makeCall.amount, 100000); // 100 sats = 100000 msats
    });

    test("missing from_nwc → 400", async () => {
      const r = await handle("GET", "/send", { to_nwc: to, amount_sats: "100" });
      assert.equal(r.status, 400);
    });

    test("missing to_nwc → 400", async () => {
      const r = await handle("GET", "/send", { from_nwc: from, amount_sats: "100" });
      assert.equal(r.status, 400);
    });

    test("missing amount_sats → 400", async () => {
      const r = await handle("GET", "/send", { from_nwc: from, to_nwc: to });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /Invalid amount_sats/);
    });

    test("non-integer amount_sats → 400", async () => {
      const r = await handle("GET", "/send", { from_nwc: from, to_nwc: to, amount_sats: "abc" });
      assert.equal(r.status, 400);
    });

    test("zero amount_sats → 400", async () => {
      const r = await handle("GET", "/send", { from_nwc: from, to_nwc: to, amount_sats: "0" });
      assert.equal(r.status, 400);
    });

    test("negative amount_sats → 400", async () => {
      const r = await handle("GET", "/send", { from_nwc: from, to_nwc: to, amount_sats: "-5" });
      assert.equal(r.status, 400);
    });

    test("NWCClient is closed after use (no leaks)", async () => {
      nwcCallLog = [];
      await handle("GET", "/send", { from_nwc: from, to_nwc: to, amount_sats: "10" });
      const closeCalls = nwcCallLog.filter((c) => c.method === "close");
      // 2 clients opened (to + from), both should be closed
      assert.equal(closeCalls.length, 2);
    });
  });
});
