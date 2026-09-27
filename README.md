# Перевірка ліцензії для розширення XPayr

Cloudflare Worker, який перевіряє оплату в блокчейні Polygon і активує Pro-версію розширення.

## Як це працює

1. Користувач платить USDT (Polygon) на адресу Trust Wallet.
2. Worker перевіряє транзакції в блокчейні через PolygonScan API.
3. Якщо оплата знайдена — записує гаманець покупця в KV-сховище.
4. Розширення звертається до Worker: `?wallet=0x...` — і отримує `{ licensed: true }` або `{ licensed: false }`.

## Налаштування

### 1. Адреса отримувача

У файлі `worker.js` вкажи свою адресу Trust Wallet:

```javascript
const WALLET_ADDRESS = "0x47fde85a66921257edbb8189d839217E2380Bf6e";
