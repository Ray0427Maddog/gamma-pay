import Stripe from "stripe";
import { NextResponse } from "next/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  try {
    const username = "gamma";
    const password = process.env.APP_PASSWORD;

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: "Authentication not configured" },
        { status: 503 }
      );
    }

    const auth = req.headers.get("authorization") || "";
    const expected =
      "Basic " +
      Buffer.from(`${username}:${password}`).toString("base64");

    if (auth !== expected) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json();

    const {
      amount,
      jobNumber,
      jobUuid,
      customerName,
      address,
      customerEmail,
      paymentRequestId,
    } = body;

    if (
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      typeof jobNumber !== "string" ||
      !/^[0-9]+$/.test(jobNumber) ||
      typeof jobUuid !== "string" ||
      !/^[0-9a-fA-F-]{36}$/.test(jobUuid) ||
      typeof paymentRequestId !== "string" ||
      !/^[a-zA-Z0-9_-]{8,80}$/.test(paymentRequestId)
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid Neo payment request" },
        { status: 400 }
      );
    }

        const readerId = process.env.STRIPE_READER_ID;

    if (!readerId) {
      return NextResponse.json(
        { success: false, error: "Stripe reader not configured" },
        { status: 503 }
      );
    }

    const reader = await stripe.terminal.readers.retrieve(readerId);

if ("deleted" in reader && reader.deleted) {
  return NextResponse.json(
    { success: false, error: "Stripe reader no longer exists" },
    { status: 503 }
  );
}

if (reader.action?.status === "in_progress") {
  return NextResponse.json(
    {
      success: false,
      error: "Card reader is currently busy",
      readerAction: reader.action.type,
    },
    { status: 409 }
  );
}

const paymentIntent = await stripe.paymentIntents.create(
  {
    amount,
    currency: "gbp",
    payment_method_types: ["card_present"],
    description: `Job #${jobNumber} - ${customerName || "Customer"}`,
    metadata: {
      jobNumber,
      jobUuid,
      paymentRoute: "machine_01",
      markComplete: "no",
      customerName: customerName || "",
      address: address || "",
      customerEmail: customerEmail || "",
    },
  },

  
  {
    idempotencyKey: `neo-${paymentRequestId}`,
  }
);

const paymentReader = await stripe.terminal.readers.processPaymentIntent(
  readerId,
  { payment_intent: paymentIntent.id },
  { idempotencyKey: `neo-reader-${paymentRequestId}` }
);

    return NextResponse.json({
  success: true,
  paymentIntentId: paymentIntent.id,
  readerStatus: paymentReader.status,
});

  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Neo payment request failed",
      },
      { status: 500 }
    );
  }
}