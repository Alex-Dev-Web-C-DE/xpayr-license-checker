const WALLET_ADDRESS = "0x47fde85a66921257edbb8189d839217E2380Bf6e";
const POLYGON_RPC = "https://polygon-rpc.com";
const MIN_AMO// ==== КОНФІГУРАЦІЯ ====
const SUBI_WEBHOOK_SECRET = "whsec_22e83c7766850254eeb1e6b352a7f6918bef32821d461c38";
const SUBI_API_KEY = "sk_live_2c6a33a4c7f87c97f9d6c5dab0c4f91515287886580fde15";
const SUBI_PRODUCT_ID = "pro_avt1lvjpeh7w3d2lm2ej885e";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Suby-Signature",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // ==== ВЕБХУК ВІД SUBI ====
    if (url.pathname === "/subi-webhook" && request.method === "POST") {
      try {
        const rawBody = await request.text();
        const signature = request.headers.get("Suby-Signature") || request.headers.get("suby-signature");

        // Перевірка підпису
        if (signature && !(await verifySignature(rawBody, signature, SUBI_WEBHOOK_SECRET))) {
          console.error("Invalid signature");
          return new Response(JSON.stringify({ error: "Invalid signature" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const event = JSON.parse(rawBody);
        console.log("Subi webhook received:", event.type);

        // Обробляємо тільки успішну оплату
        if (event.type === "payment.completed" || event.type === "payment.succeeded" || event.type === "order.completed") {
          const data = event.data || event;

          // Витягуємо email покупця (Subi передає його в різних форматах)
          const buyerEmail =
            data.customer?.email ||
            data.customer_email ||
            data.email ||
            data.buyer?.email;

          const productId = data.product_id || data.product?.id;

          if (buyerEmail) {
            // Зберігаємо ліцензію в KV
            await env.LICENSE_KV.put(`license_${buyerEmail.toLowerCase()}`, "active", {
              expirationTtl: 60 * 60 * 24 * 365, // 1 рік
            });
            console.log("License activated for:", buyerEmail);
          }
        }

        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        console.error("Webhook error:", e);
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ==== ПЕРЕВІРКА ЛІЦЕНЗІЇ (для розширення) ====
    if (url.pathname === "/" || url.pathname === "/check") {
      const email = url.searchParams.get("email");

      if (!email) {
        return new Response(JSON.stringify({ licensed: false, error: "No email provided" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const cached = await env.LICENSE_KV.get(`license_${email.toLowerCase()}`);
      if (cached === "active") {
        return new Response(JSON.stringify({ licensed: true, source: "kv" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ licensed: false, source: "kv" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==== СТАРА ПЕРЕВІРКА ЧЕРЕЗ TRUST WALLET (для інших розширень) ====
    const buyerWallet = url.searchParams.get("wallet");
    if (buyerWallet) {
      const cached = await env.LICENSE_KV.get(`license_${buyerWallet}`);
      if (cached === "active") {
        return new Response(JSON.stringify({ licensed: true, source: "kv" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ licensed: false, source: "kv" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  },
};

// ==== ПЕРЕВІРКА ПІДПИСУ ====
async function verifySignature(body, signature, secret) {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const expectedSig = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Subi може передавати підпис у форматі "sha256=..." або просто hex
    const cleanSignature = signature.replace("sha256=", "");
    return cleanSignature === expectedSig;
  } catch (e) {
    console.error("Signature verification error:", e);
    return false;
  }
}UNT = 3000000n; // 3 USDT (6 decimals)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const buyerWallet = url.searchParams.get("wallet");

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (!buyerWallet) {
      return new Response(JSON.stringify({ error: "No wallet provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cached = await env.LICENSE_KV.get(buyerWallet);
    if (cached === "active") {
      return new Response(JSON.stringify({ licensed: true, source: "cache" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const licensed = await checkBlockchain(buyerWallet);

    if (licensed) {
      await env.LICENSE_KV.put(buyerWallet, "active", { expirationTtl: 60 * 60 * 24 * 365 });
    }

    return new Response(JSON.stringify({ licensed, source: "blockchain" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  },
};

async function checkBlockchain(buyerWallet) {
  const apiUrl = `https://api.polygonscan.com/api?module=account&action=tokentx&address=${WALLET_ADDRESS}&sort=desc&offset=100`;

  try {
    const response = await fetch(apiUrl);
    const data = await response.json();

    if (data.status !== "1" || !data.result) return false;

    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - 86400;

    for (const tx of data.result) {
      if (
        tx.to.toLowerCase() === WALLET_ADDRESS.toLowerCase() &&
        tx.from.toLowerCase() === buyerWallet.toLowerCase() &&
        BigInt(tx.value) >= MIN_AMOUNT &&
        parseInt(tx.timeStamp) > oneDayAgo
      ) {
        return true;
      }
    }
  } catch (e) {
    console.error("Blockchain check error:", e);
  }

  return false;
}
