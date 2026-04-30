import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const { mandateId, jobNumber, jobUuid, customerName } = body;

    if (!mandateId) {
      return NextResponse.json(
        { success: false, error: "Missing mandateId" },
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

    const res = await fetch(
      "https://api.gocardless.com/payments",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "GoCardless-Version": "2015-07-06",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          payments: {
            amount: 5500,
            currency: "GBP",
            links: {
              mandate: mandateId,
            },
            description: "HeatCover+ Excess",
            metadata: {
              jobNumber: String(jobNumber),
              jobUuid: String(jobUuid),
              customerName: customerName || "",
              source: "Gamma Pay",
            },
          },
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: data.error?.message || "Charge failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      paymentId: data.payments?.id,
      status: data.payments?.status,
    });

  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Charge failed" },
      { status: 500 }
    );
  }
}