import { NextResponse } from "next/server";

const PAYPAL_BASE =
  process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing PayPal credentials");
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("PayPal token error:", data);
    throw new Error("Could not get PayPal access token");
  }

  return data.access_token;
}

function cleanPhone(phone: string) {
  let cleaned = String(phone || "").replace(/\s+/g, "");

  if (cleaned.startsWith("0")) {
    cleaned = `44${cleaned.slice(1)}`;
  }

  if (cleaned.startsWith("+")) {
    cleaned = cleaned.slice(1);
  }

  return cleaned;
}

async function sendTextMagicSms({
  phone,
  message,
}: {
  phone: string;
  message: string;
}) {
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
    body: JSON.stringify({
      text: message,
      phones: phone,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("TextMagic error:", data);
    throw new Error(data.message || "Could not send SMS");
  }

  return data;
}

export async function POST(req: Request) {
  try {
    const {
      amount,
      jobNumber,
      jobUuid,
      markComplete,
      customerName,
      address,
      customerPhone,
    } = await req.json();

    if (!amount || !jobNumber) {
      return NextResponse.json(
        { error: "Missing amount or job number" },
        { status: 400 }
      );
    }

    if (!customerPhone) {
      return NextResponse.json(
        { error: "No customer phone number found on this job" },
        { status: 400 }
      );
    }

    const origin =
      req.headers.get("origin") || "https://pay.gammaheating.co.uk";

    const amountInPounds = (Number(amount) / 100).toFixed(2);
    const accessToken = await getPayPalAccessToken();

    const orderRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": `gamma-pay-sms-${jobNumber}-${Date.now()}`,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: String(jobNumber),
            description: `Gamma Heating Job #${jobNumber}`,
            custom_id: JSON.stringify({
              jobNumber: String(jobNumber),
              jobUuid: String(jobUuid || ""),
              markComplete: markComplete ? "yes" : "no",
              paymentRoute: "paypal",
              customerName: String(customerName || ""),
              address: String(address || ""),
            }).slice(0, 127),
            amount: {
              currency_code: "GBP",
              value: amountInPounds,
            },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: "Gamma Heating",
              landing_page: "LOGIN",
              user_action: "PAY_NOW",
              return_url: `${origin}/?paypal_success=true&job=${encodeURIComponent(
                String(jobNumber)
              )}`,
              cancel_url: `${origin}/?paypal_cancelled=true`,
            },
          },
        },
      }),
    });

    const orderData = await orderRes.json();

    if (!orderRes.ok) {
      console.error("PayPal order error:", orderData);
      return NextResponse.json(
        { error: "Could not create PayPal payment link" },
        { status: 500 }
      );
    }

    const approvalUrl = orderData.links?.find(
      (link: any) => link.rel === "payer-action" || link.rel === "approve"
    )?.href;

    if (!approvalUrl) {
      return NextResponse.json(
        { error: "PayPal approval link missing" },
        { status: 500 }
      );
    }

    const cleanedPhone = cleanPhone(customerPhone);

    const smsText = `Gamma Heating payment link for Job #${jobNumber}: ${approvalUrl} Pay by card, PayPal or Pay in 3 if eligible.`;

    await sendTextMagicSms({
      phone: cleanedPhone,
      message: smsText,
    });

    return NextResponse.json({
      success: true,
      message: "PayPal payment link sent by SMS",
      phone: cleanedPhone,
      orderId: orderData.id,
    });
  } catch (err: any) {
    console.error("PayPal SMS error:", err);

    return NextResponse.json(
      { error: err.message || "Could not send PayPal SMS" },
      { status: 500 }
    );
  }
}