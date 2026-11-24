// Shared HeatCover+ helpers used by the sign-up link, status and webhook routes.

// Set HEATCOVER_GOCARDLESS_ENV=sandbox (in .env.local or Vercel) to test
// against the GoCardless sandbox. Anything else uses the live API.
export const GC_BASE =
  process.env.HEATCOVER_GOCARDLESS_ENV === "sandbox"
    ? "https://api-sandbox.gocardless.com"
    : "https://api.gocardless.com";

export type HeatCoverPlan = "v1" | "v2" | "v3" | "v4";

// Monthly price in pence. The ONLY place prices live for sign-up + webhook.
export function heatCoverMonthlyPence(
  plan: HeatCoverPlan,
  excessFree: boolean
): number {
  const base: Record<HeatCoverPlan, number> = {
    v1: 2700,
    v2: 1800,
    v3: 1200,
    v4: 3800,
  };
  return base[plan] + (plan !== "v3" && excessFree ? 1100 : 0);
}

// GoCardless only allows 3 metadata keys, so the plan terms are packed
// into one string: "ef=yes;amt=3800;day=15;first=2026-12-15"
export function packTerms(t: {
  excessFree: boolean;
  amountPence: number;
  paymentDay: number;
  firstCollectionDate: string;
}) {
  return `ef=${t.excessFree ? "yes" : "no"};amt=${t.amountPence};day=${t.paymentDay};first=${t.firstCollectionDate}`;
}

export function unpackTerms(s: string | undefined) {
  const out: Record<string, string> = {};
  String(s || "")
    .split(";")
    .forEach((pair) => {
      const [k, v] = pair.split("=");
      if (k && v !== undefined) out[k.trim()] = v.trim();
    });
  return {
    excessFree: out.ef === "yes",
    amountPence: Number(out.amt),
    paymentDay: Number(out.day),
    firstCollectionDate: out.first || "",
  };
}

export function gcHeaders(accessToken: string, idempotencyKey?: string) {
  const h: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "GoCardless-Version": "2015-07-06",
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (idempotencyKey) h["Idempotency-Key"] = idempotencyKey;
  return h;
}

// UK mobile -> TextMagic format (447...)
export function cleanPhone(phone: string) {
  let cleaned = String(phone || "").replace(/[\s\-()]/g, "");
  if (cleaned.startsWith("+")) cleaned = cleaned.slice(1);
  if (cleaned.startsWith("0")) cleaned = `44${cleaned.slice(1)}`;
  return cleaned;
}

export async function sendTextMagicSms(phone: string, message: string) {
  const username = process.env.TEXTMAGIC_USERNAME;
  const apiKey = process.env.TEXTMAGIC_API_KEY;

  if (!username || !apiKey) {
    throw new Error("Missing TextMagic credentials");
  }

  const res = await fetch("https://rest.textmagic.com/api/v2/messages", {
    method: "POST",
    headers: {
      "X-TM-Username": username,
      "X-TM-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: message, phones: phone }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error("TextMagic error:", data);
    throw new Error(data.message || "Could not send SMS");
  }

  return data;
}
