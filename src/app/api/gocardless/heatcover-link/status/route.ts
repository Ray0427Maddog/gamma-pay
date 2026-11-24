import { NextResponse } from "next/server";
import { GC_BASE, gcHeaders } from "@/lib/heatcover";

// Gamma Pay polls this while you're on the phone, so you know the moment
// the customer has finished the GoCardless page and can read the final script.
export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("id") || "";

    if (!/^BRQ[0-9A-Z]+$/i.test(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid request ID" },
        { status: 400 }
      );
    }

    const accessToken = process.env.HEATCOVER_GOCARDLESS_ACCESS_TOKEN;
    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: "Missing GoCardless token" },
        { status: 500 }
      );
    }

    const res = await fetch(
      `${GC_BASE}/billing_requests/${encodeURIComponent(id)}`,
      { headers: gcHeaders(accessToken), cache: "no-store" }
    );
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error: data?.error?.message || "Could not check GoCardless",
        },
        { status: res.status }
      );
    }

    const br = data.billing_requests || {};

    // pending | ready_to_fulfil | fulfilling | fulfilled | cancelled
    return NextResponse.json({
      success: true,
      status: br.status,
      completed: br.status === "fulfilled",
      cancelled: br.status === "cancelled",
      mandateId: br.links?.mandate_request_mandate || null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "Status check failed" },
      { status: 500 }
    );
  }
}
