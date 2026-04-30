import { NextResponse } from "next/server";

async function addServiceM8Note({
  jobUuid,
  jobNumber,
  customerName,
  paymentId,
  status,
}: {
  jobUuid: string;
  jobNumber: string;
  customerName: string;
  paymentId: string;
  status: string;
}) {
  if (!jobUuid) return;

  const noteBody = {
    related_object_uuid: jobUuid,
    related_object: "job",
    note: `HeatCover+ excess charge requested via GoCardless.

Amount: £55.00
Customer: ${customerName || "Unknown"}
GoCardless payment ID: ${paymentId}
Status: ${status || "unknown"}
Requested by: Gamma Pay

No ServiceM8 invoice/payment entry created.`,
  };

  const noteRes = await fetch("https://api.servicem8.com/api_1.0/note.json", {
    method: "POST",
    headers: {
      "X-API-Key": process.env.SERVICEM8_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(noteBody),
  });

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

const paymentId = data.payments?.id || "";
const status = data.payments?.status || "";

await addServiceM8Note({
  jobUuid: String(jobUuid),
  jobNumber: String(jobNumber),
  customerName: customerName || "",
  paymentId,
  status,
});

return NextResponse.json({
  success: true,
  paymentId,
  status,
});

  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Charge failed" },
      { status: 500 }
    );
  }
}