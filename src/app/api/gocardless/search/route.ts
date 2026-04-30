import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("query");

    if (!query) {
      return NextResponse.json(
        { success: false, error: "Missing search query" },
        { status: 400 }
      );
    }

    const accessToken = process.env.GOCARDLESS_ACCESS_TOKEN;

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: "Missing GoCardless token" },
        { status: 500 }
      );
    }

    // Search customers
    const res = await fetch(
      `https://api.gocardless.com/customers?email=${encodeURIComponent(query)}&limit=10`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "GoCardless-Version": "2015-07-06",
          "Content-Type": "application/json",
        },
      }
    );

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: data.error?.message || "GoCardless error" },
        { status: 500 }
      );
    }

    // Filter locally (GoCardless search is limited)
    const matches = (data.customers || []).filter((c: any) => {
      const name = `${c.given_name || ""} ${c.family_name || ""}`.toLowerCase();
      const email = (c.email || "").toLowerCase();

      return (
        name.includes(query.toLowerCase()) ||
        email.includes(query.toLowerCase())
      );
    });

const matchesWithMandates = await Promise.all(
  matches.slice(0, 5).map(async (customer: any) => {
    const mandateRes = await fetch(
      `https://api.gocardless.com/mandates?customer=${customer.id}&limit=10`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "GoCardless-Version": "2015-07-06",
          "Content-Type": "application/json",
        },
      }
    );

    const mandateData = await mandateRes.json();

    const mandates = mandateData.mandates || [];
    const activeMandate = mandates.find((m: any) => m.status === "active");

    return {
      ...customer,
      mandates,
      activeMandateId: activeMandate?.id || null,
      hasActiveMandate: Boolean(activeMandate),
    };
  })
);

return NextResponse.json({
  success: true,
  matches: matchesWithMandates,
});
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Search failed" },
      { status: 500 }
    );
  }
}