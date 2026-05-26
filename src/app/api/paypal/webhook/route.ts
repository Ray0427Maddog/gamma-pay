import { NextResponse } from "next/server";

async function serviceM8Post(path: string, apiKey: string, body: any) {
  const res = await fetch(`https://api.servicem8.com/api_1.0/${path}`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`ServiceM8 POST ${path} failed ${res.status}: ${text}`);
  }

  return text;
}

export async function POST(req: Request) {
  try {
    const event = await req.json();

    console.log("PayPal webhook received:", event.event_type);

    if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
      return NextResponse.json({ received: true, ignored: true });
    }

    const apiKey = process.env.SERVICEM8_API_KEY;

    if (!apiKey) {
      throw new Error("Missing SERVICEM8_API_KEY");
    }

    const resource = event.resource || {};
    const purchaseUnit =
      resource.supplementary_data?.related_ids || {};

    const amount = resource.amount?.value || "";
    const currency = resource.amount?.currency_code || "GBP";
    const paypalCaptureId = resource.id || "";
    const paypalOrderId = purchaseUnit.order_id || "";

    let jobNumber = "";
    let jobUuid = "";
    let customerName = "";
    let address = "";

    // PayPal capture webhook does not always include full purchase_units.
    // So first try custom_id if PayPal sends it.
    const customId = resource.custom_id;

    if (customId) {
      try {
        const parsed = JSON.parse(customId);
        jobNumber = parsed.jobNumber || "";
        jobUuid = parsed.jobUuid || "";
        customerName = parsed.customerName || "";
        address = parsed.address || "";
      } catch {
        jobNumber = customId;
      }
    }

    if (!jobUuid) {
      console.error("PayPal webhook missing jobUuid", {
        paypalCaptureId,
        paypalOrderId,
        customId,
        resource,
      });

      return NextResponse.json(
        { error: "Missing job UUID in PayPal webhook" },
        { status: 400 }
      );
    }

    const noteText = [
      `💰 PayPal payment received via Gamma Pay`,
      `Amount: ${currency} ${amount}`,
      jobNumber ? `ServiceM8 Job: #${jobNumber}` : "",
      customerName ? `Customer: ${customerName}` : "",
      address ? `Address: ${address}` : "",
      paypalCaptureId ? `PayPal Capture ID: ${paypalCaptureId}` : "",
      paypalOrderId ? `PayPal Order ID: ${paypalOrderId}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await serviceM8Post("note.json", apiKey, {
      related_object: "job",
      related_object_uuid: jobUuid,
      note: noteText,
    });

    return NextResponse.json({
      success: true,
      message: "ServiceM8 note added for PayPal payment",
      jobUuid,
      paypalCaptureId,
    });
  } catch (err: any) {
    console.error("PayPal webhook error:", err);

    return NextResponse.json(
      { error: err.message || "PayPal webhook failed" },
      { status: 500 }
    );
  }
}