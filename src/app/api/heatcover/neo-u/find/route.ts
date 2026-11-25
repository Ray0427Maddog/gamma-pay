import { NextResponse } from "next/server";
import { GC_BASE, gcHeaders } from "@/lib/heatcover";

// Find existing HeatCover+ customers in GoCardless (by name, email or
// postcode) with a usable Direct Debit, and list their subscriptions so
// staff can confirm the V4 plan before adding Neo U.

const USABLE_MANDATE = ["pending_submission", "submitted", "active"];

async function gcGet(path: string, token: string) {
  const res = await fetch(`${GC_BASE}${path}`, {
    headers: gcHeaders(token),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `GoCardless error ${res.status}`);
  }
  return data;
}

export async function GET(req: Request) {
  try {
    const query = (new URL(req.url).searchParams.get("query") || "")
      .trim()
      .toLowerCase();

    if (query.length < 3) {
      return NextResponse.json(
        { success: false, error: "Type at least 3 characters" },
        { status: 400 }
      );
    }

    const token = process.env.HEATCOVER_GOCARDLESS_ACCESS_TOKEN;
    if (!token) {
      return NextResponse.json(
        { success: false, error: "Missing GoCardless token" },
        { status: 500 }
      );
    }

    // Page through all customers (GoCardless has no text search).
    const customers: any[] = [];
    let after = "";
    for (let page = 0; page < 20; page++) {
      const data = await gcGet(
        `/customers?limit=500${after ? `&after=${after}` : ""}`,
        token
      );
      customers.push(...(data.customers || []));
      after = data.meta?.cursors?.after || "";
      if (!after) break;
    }

    const compact = (v: string) => String(v || "").toLowerCase().replace(/\s+/g, "");
    const q = compact(query);

    const matches = customers
      .filter((c) => {
        const name = compact(`${c.given_name || ""}${c.family_name || ""}`);
        return (
          name.includes(q) ||
          compact(c.family_name).includes(q) ||
          compact(c.email).includes(q) ||
          compact(c.postal_code).includes(q) ||
          compact(c.company_name).includes(q)
        );
      })
      .slice(0, 10);

    const results = await Promise.all(
      matches.map(async (c) => {
        const [m, sub, pay] = await Promise.all([
          gcGet(`/mandates?customer=${c.id}&limit=50`, token),
          gcGet(`/subscriptions?customer=${c.id}&limit=50`, token),
          gcGet(
            `/payments?customer=${c.id}&limit=6&sort_field=charge_date&sort_direction=desc`,
            token
          ).catch(() => ({ payments: [] })),
        ]);

        const recentPayments = (pay.payments || []).map((p: any) => ({
          amount: p.amount,
          chargeDate: p.charge_date,
          description: p.description || "",
          status: p.status,
        }));
        const lastDate = recentPayments[0]?.chargeDate || "";
        const suggestedDay = lastDate
          ? Math.min(Number(lastDate.slice(8, 10)), 28)
          : 0;

        const mandates = (m.mandates || []).filter((x: any) =>
          USABLE_MANDATE.includes(x.status)
        );
        const subscriptions = (sub.subscriptions || [])
          .filter((x: any) => x.status === "active")
          .map((x: any) => ({
            id: x.id,
            name: x.name || "",
            amount: x.amount,
            dayOfMonth: x.day_of_month,
            mandateId: x.links?.mandate,
            isNeoU:
              x.metadata?.heatcover_item === "neo_u_monthly" ||
              /neo u/i.test(x.name || ""),
          }));

        return {
          customerId: c.id,
          name: `${c.given_name || ""} ${c.family_name || ""}`.trim(),
          firstName: c.given_name || "",
          lastName: c.family_name || "",
          email: c.email || "",
          phone: c.phone_number || "",
          address: c.address_line1 || "",
          city: c.city || "",
          postcode: c.postal_code || "",
          mandates: mandates.map((x: any) => ({
            id: x.id,
            status: x.status,
            reference: x.reference,
            nextPossibleChargeDate: x.next_possible_charge_date,
          })),
          subscriptions,
          recentPayments,
          suggestedDay,
          hasNeoU: subscriptions.some((s: any) => s.isNeoU),
        };
      })
    );

    return NextResponse.json({
      success: true,
      searched: customers.length,
      results: results.filter((r) => r.mandates.length > 0),
      withoutDirectDebit: results.filter((r) => r.mandates.length === 0).length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "Search failed" },
      { status: 500 }
    );
  }
}
