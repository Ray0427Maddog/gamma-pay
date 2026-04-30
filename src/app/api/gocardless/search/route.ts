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
      `https://api.gocardless.com/customers?limit=500`,
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

const activeMatches = matchesWithMandates
  .filter((customer: any) => customer.hasActiveMandate)
  .sort((a: any, b: any) => {
    const aDate = new Date(a.mandates?.find((m: any) => m.id === a.activeMandateId)?.created_at || a.created_at || 0).getTime();
    const bDate = new Date(b.mandates?.find((m: any) => m.id === b.activeMandateId)?.created_at || b.created_at || 0).getTime();

    return bDate - aDate;
  });

return NextResponse.json({
  success: true,
  matches: activeMatches.slice(0, 1),
});
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Search failed" },
      { status: 500 }
    );
  }
}