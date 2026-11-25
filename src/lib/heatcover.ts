// Shared HeatCover+ helpers used by the sign-up link, status and webhook routes.

// Set HEATCOVER_GOCARDLESS_ENV=sandbox (in .env.local or Vercel) to test
// against the GoCardless sandbox. Anything else uses the live API.
export const GC_BASE =
  process.env.HEATCOVER_GOCARDLESS_ENV === "sandbox"
    ? "https://api-sandbox.gocardless.com"
    : "https://api.gocardless.com";

export type HeatCoverPlan = "v1" | "v2" | "v3" | "v4";

// Monthly price in pence. The ONLY place prices live for sign-up + webhook.
// Neo U tank monitor add-on: only on V4, +£6 a month.
export const NEO_U_MONTHLY_PENCE = 600;

export function heatCoverMonthlyPence(
  plan: HeatCoverPlan,
  excessFree: boolean,
  neoU = false
): number {
  const base: Record<HeatCoverPlan, number> = {
    v1: 2700,
    v2: 1800,
    v3: 1200,
    v4: 3800,
  };
  return (
    base[plan] +
    (plan !== "v3" && excessFree ? 1100 : 0) +
    (plan === "v4" && neoU ? NEO_U_MONTHLY_PENCE : 0)
  );
}

// GoCardless only allows 3 metadata keys, so the plan terms are packed
// into one string: "ef=yes;amt=3800;day=15;first=2026-12-15"
export function packTerms(t: {
  excessFree: boolean;
  amountPence: number;
  paymentDay: number;
  firstCollectionDate: string;
  neoU?: boolean;
  neoUInstallPence?: number;
}) {
  return `ef=${t.excessFree ? "yes" : "no"};nu=${t.neoU ? "yes" : "no"};inst=${t.neoU ? t.neoUInstallPence || 0 : 0};amt=${t.amountPence};day=${t.paymentDay};first=${t.firstCollectionDate}`;
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
    neoU: out.nu === "yes",
    neoUInstallPence: Number(out.inst || 0),
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

// Any common way of typing a UK mobile -> TextMagic format (447xxxxxxxxx).
// Handles: 07700 900000, +44 7700 900000, +44 (0)7700 900000,
// 0044 7700..., 44 07700..., 7700900000, dots/dashes/brackets.
export function cleanPhone(phone: string) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("440")) d = "44" + d.slice(3);
  if (d.startsWith("0")) d = "44" + d.slice(1);
  if (d.length === 10 && d.startsWith("7")) d = "44" + d;
  return d;
}

export function isUkMobile(cleaned: string) {
  return /^447\d{9}$/.test(cleaned);
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
    const fields = data?.errors?.fields
      ? Object.keys(data.errors.fields).join(", ")
      : "";
    throw new Error(
      `${data.message || "Could not send SMS"}${fields ? ` (${fields})` : ""}`
    );
  }

  return data;
}

// Live Neo U installation price from the website shop (WooCommerce
// Store API, public). Product 6909 = "GammaTherm Neo U".
export const NEO_U_PRODUCT_ID = 6909;

export async function getNeoUInstallPrice() {
  const res = await fetch(
    `https://gammaheating.co.uk/wp-json/wc/store/v1/products/${NEO_U_PRODUCT_ID}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Shop price lookup failed (${res.status})`);
  const p = await res.json();
  const minor = Number(p?.prices?.currency_minor_unit ?? 2);
  const toPence = (v: unknown) =>
    Math.round(Number(v) * Math.pow(10, 2 - minor));
  const pricePence = toPence(p?.prices?.price);
  const regularPence = toPence(p?.prices?.regular_price);
  if (!Number.isFinite(pricePence) || pricePence <= 0) {
    throw new Error("Shop returned no Neo U price");
  }
  return {
    pricePence,
    regularPence: Number.isFinite(regularPence) ? regularPence : pricePence,
    onSale: Boolean(p?.on_sale) && regularPence > pricePence,
  };
}

// Tell the HeatCover portal (WordPress plugin on gammaheating.co.uk) about a
// new Neo U sign-up so it appears in HeatCover -> Neo U as "Awaiting install".
// Needs HEATCOVER_PORTAL_URL + HEATCOVER_PORTAL_KEY (copy both from
// HeatCover -> Settings & test on the website). NEVER throws: a failure here
// must not break a sign-up. The plugin's daily GoCardless check is the backup.
export async function notifyPortalNeoU(d: {
  ref: string;
  source: "signup" | "addon";
  gcCustomerId?: string;
  firstName?: string;
  lastName: string;
  postcode: string;
  address?: string;
  installPence?: number;
  installDate?: string;
}) {
  const url = process.env.HEATCOVER_PORTAL_URL;
  const key = process.env.HEATCOVER_PORTAL_KEY;
  if (!url || !key) {
    console.warn("Neo U not sent to HeatCover portal: HEATCOVER_PORTAL_URL / KEY not set", { ref: d.ref });
    return false;
  }
  try {
    const res = await fetch(url.replace(/\/?$/, "/") + "neo-u/new", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-HCP-Key": key },
      body: JSON.stringify({
        ref: d.ref,
        source: d.source,
        gc_customer_id: d.gcCustomerId || "",
        first_name: d.firstName || "",
        last_name: d.lastName,
        postcode: d.postcode,
        address: d.address || "",
        install_pence: d.installPence || 0,
        install_date: d.installDate || "",
      }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("HeatCover portal rejected Neo U sign-up:", { ref: d.ref, status: res.status, data });
      return false;
    }
    console.log("Neo U sent to HeatCover portal:", { ref: d.ref, linked: data?.linked });
    return true;
  } catch (e: any) {
    console.error("Neo U could not reach HeatCover portal:", { ref: d.ref, error: e?.message || e });
    return false;
  }
}
