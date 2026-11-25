import { NextRequest, NextResponse } from "next/server";
import {
  GC_BASE,
  gcHeaders,
  getNeoUInstallPrice,
  NEO_U_MONTHLY_PENCE,
  notifyPortalNeoU,
} from "@/lib/heatcover";
import { POST as generateContract } from "../../../gocardless/heatcover-signup/contract/route";

// Add Neo U to an EXISTING HeatCover+ V4 customer, on the Direct Debit
// they already have (no new bank details):
//   1. one-off installation fee (live website price), earliest date possible
//   2. separate £6/month "Neo U tank monitor" subscription, same day as V4
//   3. Neo U Equipment Agreement emailed via Zapier

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USABLE_MANDATE = ["pending_submission", "submitted", "active"];

async function gc(
  method: "GET" | "POST",
  path: string,
  token: string,
  body?: unknown,
  idempotencyKey?: string
) {
  const res = await fetch(`${GC_BASE}${path}`, {
    method,
    headers: gcHeaders(token, idempotencyKey),
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  // Same request sent twice (double click / retry): treat as done.
  const conflictId =
    res.status === 409 &&
    data?.error?.errors?.[0]?.links?.conflicting_resource_id;
  if (!res.ok && !conflictId) {
    throw new Error(data?.error?.message || `GoCardless error ${res.status}`);
  }
  return { data, conflictId: conflictId || null };
}

function firstDateOnOrAfter(earliest: string, day: number) {
  const e = new Date(`${earliest}T00:00:00Z`);
  let d = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), day));
  if (d < e) d = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, day));
  return d.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const {
      addId,
      customerId,
      mandateId,
      v4SubscriptionId,
      // Fallback for customers whose V4 isn't a GoCardless subscription:
      manualDay,
      manualExcessFree,
    } = await req.json();
    const manual = !v4SubscriptionId;

    if (typeof addId !== "string" || !UUID_RE.test(addId)) {
      return NextResponse.json({ success: false, error: "Invalid request ID" }, { status: 400 });
    }
    if (
      !/^CU/.test(customerId || "") ||
      !/^MD/.test(mandateId || "") ||
      (!manual && !/^SB/.test(v4SubscriptionId || "")) ||
      (manual &&
        (!Number.isInteger(manualDay) || manualDay < 1 || manualDay > 28 ||
          typeof manualExcessFree !== "boolean"))
    ) {
      return NextResponse.json({ success: false, error: "Missing customer, Direct Debit or plan" }, { status: 400 });
    }

    const token = process.env.HEATCOVER_GOCARDLESS_ACCESS_TOKEN;
    if (!token) {
      return NextResponse.json({ success: false, error: "Missing GoCardless token" }, { status: 500 });
    }

    // ---- re-check everything on the server ----
    const [{ data: cData }, { data: mData }, { data: allSubs }] =
      await Promise.all([
        gc("GET", `/customers/${customerId}`, token),
        gc("GET", `/mandates/${mandateId}`, token),
        gc("GET", `/subscriptions?customer=${customerId}&limit=50`, token),
      ]);

    const customer = cData.customers;
    const mandate = mData.mandates;
    const v4Sub = manual
      ? null
      : (await gc("GET", `/subscriptions/${v4SubscriptionId}`, token)).data
          .subscriptions;

    if (!customer || !mandate || (!manual && !v4Sub)) {
      throw new Error("Could not load the customer from GoCardless");
    }
    if (mandate.links?.customer !== customerId || !USABLE_MANDATE.includes(mandate.status)) {
      return NextResponse.json({ success: false, error: "That Direct Debit isn't active for this customer" }, { status: 400 });
    }
    if (v4Sub && (v4Sub.status !== "active" || v4Sub.links?.mandate !== mandateId)) {
      return NextResponse.json({ success: false, error: "That plan isn't active on this Direct Debit" }, { status: 400 });
    }
    const alreadyNeoU = (allSubs.subscriptions || []).some(
      (x: any) =>
        x.status === "active" &&
        (x.metadata?.heatcover_item === "neo_u_monthly" || /neo u/i.test(x.name || ""))
    );
    if (alreadyNeoU) {
      return NextResponse.json({ success: false, error: "This customer already has a Neo U subscription" }, { status: 400 });
    }

    // ---- live installation price ----
    let installPence = 0;
    try {
      installPence = (await getNeoUInstallPrice()).pricePence;
    } catch {
      return NextResponse.json(
        { success: false, error: "Couldn't read the Neo U installation price from the website. Try again in a minute." },
        { status: 502 }
      );
    }

    const earliest: string =
      mandate.next_possible_charge_date || new Date().toISOString().slice(0, 10);

    // ---- 1. installation fee, as soon as possible ----
    const install = await gc(
      "POST",
      "/payments",
      token,
      {
        payments: {
          amount: installPence,
          currency: "GBP",
          charge_date: earliest,
          description: "Neo U tank monitor installation",
          links: { mandate: mandateId },
          metadata: { heatcover_signup_id: addId, heatcover_item: "neo_u_install" },
        },
      },
      `neou-${addId}-install`
    );
    const installChargeDate: string =
      install.data?.payments?.charge_date || earliest;

    // ---- 2. £6/month, same day of month as their V4 plan ----
    const v4Day = manual ? Number(manualDay) : Number(v4Sub.day_of_month);
    const day =
      Number.isInteger(v4Day) && v4Day >= 1 && v4Day <= 28
        ? v4Day
        : Math.min(Number(earliest.slice(8, 10)), 28);
    const monthlyStart = firstDateOnOrAfter(earliest, day);

    await gc(
      "POST",
      "/subscriptions",
      token,
      {
        subscriptions: {
          amount: NEO_U_MONTHLY_PENCE,
          currency: "GBP",
          name: "Neo U tank monitor",
          interval_unit: "monthly",
          interval: 1,
          day_of_month: day,
          start_date: monthlyStart,
          links: { mandate: mandateId },
          metadata: { heatcover_signup_id: addId, heatcover_item: "neo_u_monthly" },
        },
      },
      `neou-${addId}-monthly`
    );

    // ---- put it on the HeatCover portal's Neo U list (never fatal) ----
    await notifyPortalNeoU({
      ref: addId,
      source: "addon",
      gcCustomerId: customerId,
      firstName: customer.given_name || "",
      lastName: customer.family_name || "",
      postcode: customer.postal_code || "",
      address: customer.address_line1 || "",
      installPence,
      installDate: installChargeDate,
    });

    // ---- 3. email the Neo U Equipment Agreement (never fatal) ----
    let agreementSent = false;
    try {
      const res = await generateContract(
        new NextRequest("https://internal/neo-u-agreement", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signupId: addId,
            firstName: customer.given_name || "",
            lastName: customer.family_name || "",
            email: customer.email || "",
            phone: customer.phone_number || "",
            address: customer.address_line1 || "",
            city: customer.city || "",
            postcode: customer.postal_code || "",
            paymentDay: day,
            plan: "v4",
            excessFree: manual
              ? manualExcessFree === true
              : Number(v4Sub.amount) === 4900,
            neoU: true,
            neoUOnly: true,
            neoUInstallPence: installPence,
            neoUInstallDate: installChargeDate,
            neoUMonthlyDay: day,
          }),
        })
      );
      agreementSent = res.ok;
      if (!res.ok) console.error("Neo U agreement generation failed:", res.status);
    } catch (e: any) {
      console.error("Neo U agreement email FAILED - send it manually:", { addId, error: e?.message });
    }

    return NextResponse.json({
      success: true,
      installPence,
      installChargeDate,
      monthlyPence: NEO_U_MONTHLY_PENCE,
      monthlyDay: day,
      monthlyStart,
      agreementSent,
      email: customer.email || "",
    });
  } catch (err: any) {
    console.error("Neo U add-on error:", err?.message || err);
    return NextResponse.json(
      { success: false, error: err?.message || "Could not add Neo U" },
      { status: 500 }
    );
  }
}
