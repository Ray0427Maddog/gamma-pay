import { NextResponse } from "next/server";

async function addServiceM8Note({
  jobUuid,
  jobNumber,
  customerName,
  paymentId,
  status,
  chargeDate,
}: {
  jobUuid: string;
  jobNumber: string;
  customerName: string;
  paymentId: string;
  status: string;
  chargeDate: string;
}) {
  if (!jobUuid) return;

  const noteBody = {
    related_object_uuid: jobUuid,
    related_object: "job",
    note: `HeatCover+ excess charge requested via GoCardless.

Amount: £55.00
Customer: ${customerName || "Unknown"}
Job Number: ${jobNumber || "Unknown"}
GoCardless payment ID: ${paymentId}
Status: ${status || "unknown"}
Expected collection: ${chargeDate || "unknown"}
Requested by: Gamma Pay

No ServiceM8 invoice/payment entry created.`,
  };

  const noteRes = await fetch(
    "https://api.servicem8.com/api_1.0/note.json",
    {
      method: "POST",
      headers: {
        "X-API-Key": process.env.SERVICEM8_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(noteBody),
    }
  );

  const noteText = await noteRes.text();

  if (!noteRes.ok) {
    console.error("Failed to create ServiceM8 GoCardless note:", {
      status: noteRes.status,
      response: noteText,
    });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      mandateId,
      jobNumber,
      jobUuid,
      customerName,
    } = body;

    console.log(
      "GC frontend body:",
      JSON.stringify(body, null, 2)
    );

    if (!mandateId) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing mandateId",
        },
        { status: 400 }
      );
    }

    if (typeof mandateId !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: "mandateId is not a string",
          received: mandateId,
        },
        { status: 400 }
      );
    }

    if (!mandateId.startsWith("MD")) {
      return NextResponse.json(
        {
          success: false,
          error: "mandateId does not look valid",
          received: mandateId,
        },
        { status: 400 }
      );
    }

    const accessToken =
      process.env.GOCARDLESS_ACCESS_TOKEN;

    if (!accessToken) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing GoCardless token",
        },
        { status: 500 }
      );
    }

    const payload = {
      payments: {
        amount: 5500,
        currency: "GBP",
        links: {
          mandate: mandateId,
        },
        description: "HeatCover+ Excess",
        metadata: {
          jobNumber: String(jobNumber || ""),
          jobUuid: String(jobUuid || ""),
          customerName: String(customerName || ""),
        },
      },
    };

    console.log(
      "GC payload:",
      JSON.stringify(payload, null, 2)
    );

    const res = await fetch(
      "https://api.gocardless.com/payments",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "GoCardless-Version": "2015-07-06",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const responseText = await res.text();

    console.log("GC status:", res.status);
    console.log("GC response:", responseText);

    let data: any = {};

    try {
      data = JSON.parse(responseText);
    } catch {
      data = {
        raw: responseText,
      };
    }

    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error:
            data.error?.message || "Charge failed",
          details:
            data.error?.errors || data,
        },
        { status: res.status }
      );
    }

    const paymentId =
      data.payments?.id || "";

    const status =
      data.payments?.status || "";
    const chargeDate =
      data.payments?.charge_date || "";

await addServiceM8Note({
  jobUuid: String(jobUuid || ""),
  jobNumber: String(jobNumber || ""),
  customerName: String(customerName || ""),
  paymentId,
  status,
  chargeDate,
});

    return NextResponse.json({
      success: true,
      paymentId,
      status,
    });
  } catch (err: any) {
    console.error("GC route error:", err);

    return NextResponse.json(
      {
        success: false,
        error:
          err.message || "Charge failed",
      },
      { status: 500 }
    );
  }
}