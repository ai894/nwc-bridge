# NWC Bridge

**HTTP GET only** で Lightning 送金・残高確認ができるエンドポイント。  
AI エージェントや HTTP GET しか使えないクライアント向け。

**Base URL:** `https://nwc-bridge.vercel.app`

---

## 前提

- NWC (Nostr Wallet Connect) 対応のウォレットが必要（[Alby Hub](https://albyhub.com/), [coinos](https://coinos.io/), [Primal](https://primal.net/) 等）
- NWC connection string (`nostr+walletconnect://...`) を取得しておく
- URLに渡すときは **必ず URL エンコード** する（`encodeURIComponent()` / `urllib.parse.quote(..., safe='')`）

---

## エンドポイント

### `GET /balance` — 残高確認

```
GET /balance?nwc=<URL-encoded NWC string>
```

**レスポンス:**
```json
{
  "balance_msats": 100000,
  "balance_sats": 100
}
```

---

### `GET /pay` — BOLT11 Invoice 支払い

```
GET /pay?from_nwc=<URL-encoded NWC string>&invoice=<BOLT11 invoice>
```

**レスポンス:**
```json
{
  "success": true,
  "preimage": "d63ea10df3c621..."
}
```

---

### `GET /send` — ウォレット間送金（invoice 自動生成）

```
GET /send?from_nwc=<URL-encoded NWC string>&to_nwc=<URL-encoded NWC string>&amount_sats=<整数>&memo=<任意・URL-encoded>
```

| パラメータ | 必須 | 説明 |
|---|---|---|
| `from_nwc` | ✅ | 送り元ウォレットの NWC string（URL-encoded） |
| `to_nwc` | ✅ | 受け取りウォレットの NWC string（URL-encoded） |
| `amount_sats` | ✅ | 送金額（satoshi、正の整数） |
| `memo` | ❌ | 送金メモ（URL-encoded、省略時は "NWC Bridge transfer"） |

**レスポンス:**
```json
{
  "success": true,
  "amount_sats": 10,
  "memo": "payment note",
  "preimage": "d63ea10df3c621...",
  "invoice": "lnbc100n1p5mt..."
}
```

---

## エラーレスポンス

```json
{
  "success": false,
  "error": "エラー内容"
}
```

| HTTP ステータス | 意味 |
|---|---|
| 400 | パラメータ不正（必須パラメータ欠け、無効な値等） |
| 404 | 存在しないエンドポイント |
| 405 | GET 以外のメソッド |
| 500 | ウォレット接続エラー等 |

---

## AI エージェント向け使い方例

### Python

```python
import urllib.parse, requests

def encode_nwc(s): return urllib.parse.quote(s, safe='')

BASE = "https://nwc-bridge.vercel.app"
NWC_A = "nostr+walletconnect://..."  # 送り元
NWC_B = "nostr+walletconnect://..."  # 受取先

# 残高確認
r = requests.get(f"{BASE}/balance?nwc={encode_nwc(NWC_A)}")
print(r.json())  # {"balance_msats": 100000, "balance_sats": 100}

# 送金（10 sats）
r = requests.get(f"{BASE}/send", params={
    "from_nwc": NWC_A,
    "to_nwc": NWC_B,
    "amount_sats": 10,
    "memo": "hello"
})
print(r.json())  # {"success": true, "preimage": "...", ...}

# Invoice 直接払い
r = requests.get(f"{BASE}/pay", params={
    "from_nwc": NWC_A,
    "invoice": "lnbc100n1p5mt..."
})
print(r.json())  # {"success": true, "preimage": "..."}
```

### curl

```bash
NWC=$(python3 -c "import urllib.parse; print(urllib.parse.quote('nostr+walletconnect://...', safe=''))")

# 残高
curl "https://nwc-bridge.vercel.app/balance?nwc=$NWC"

# 送金
curl "https://nwc-bridge.vercel.app/send?from_nwc=$NWC_A&to_nwc=$NWC_B&amount_sats=10"
```

### JavaScript

```js
const encode = (s) => encodeURIComponent(s);
const BASE = "https://nwc-bridge.vercel.app";
const NWC_A = "nostr+walletconnect://...";
const NWC_B = "nostr+walletconnect://...";

// 残高
const bal = await fetch(`${BASE}/balance?nwc=${encode(NWC_A)}`).then(r => r.json());

// 送金
const result = await fetch(
  `${BASE}/send?from_nwc=${encode(NWC_A)}&to_nwc=${encode(NWC_B)}&amount_sats=10&memo=hello`
).then(r => r.json());
```

---

## 注意事項

- NWC connection string はそのまま URL パラメータとして渡される。サーバーには保存されない
- エンドポイントは認証なし・公開。NWC string を渡す相手は信頼できる相手のみに限定すること
- NWC string には送金権限が含まれるため、取り扱いに注意
