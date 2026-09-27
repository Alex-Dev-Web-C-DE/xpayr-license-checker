const WALLET_ADDRESS = "0x47fde85a66921257edbb8189d839217E2380Bf6e";
const POLYGON_RPC = "https://polygon-rpc.com";
const MIN_AMOUNT = 3000000n; // 3 USDT (6 decimals)

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
