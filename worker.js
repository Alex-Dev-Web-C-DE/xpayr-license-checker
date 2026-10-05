// ==== КОНФІГУРАЦІЯ ====
const SUBI_WEBHOOK_SECRET = "whsec_22e83c7766850254eeb1e6b352a7f6918bef32821d461c38";
const SUBI_API_KEY = "sk_live_2c6a33a4c7f87c97f9d6c5dab0c4f91515287886580fde15";
const SUBI_PRODUCT_ID = "pro_avt1lvjpeh7w3d2lm2ej885e";

module.exports = {
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
        if (
          event.type === "payment.completed" ||
          event.type === "payment.succeeded" ||
          event.type === "order.completed"
        ) {
          const data = event.data || event;

          // Витягуємо email покупця
          const buyerEmail =
            (data.customer && data.customer.email) ||
            data.customer_email ||
            data.email ||
            (data.buyer && data.buyer.email);

          if (buyerEmail) {
            await env.LICENSE_KV.put(`license_${buyerEmail.toLowerCase()}`, "active", {
              expirationTtl: 60 * 60 * 24 * 365,
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

    // ==== ПЕРЕВІРКА ЛІЦЕНЗІЇ ЗА EMAIL ====
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

    // ==== ПЕРЕВІРКА ЛІЦЕНЗІЇ ЗА ГАМАНЦЕМ (Trust Wallet) ====
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

    const cleanSignature = signature.replace("sha256=", "");
    return cleanSignature === expectedSig;
  } catch (e) {
    console.error("Signature verification error:", e);
    return false;
  }
}
