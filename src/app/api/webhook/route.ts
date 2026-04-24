import Stripe from "stripe";
import { NextResponse } from "next/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing Stripe signature" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);

    return NextResponse.json(
      { error: "Webhook signature verification failed" },
      { status: 400 }
    );
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    const jobNumber = session.metadata?.jobNumber || "";
    const jobUuid = session.metadata?.jobUuid || "";
    const amountPaid = (session.amount_total || 0) / 100;
    const paymentStatus = session.payment_status;
    const stripeSessionId = session.id;

    console.log("✅ PAYMENT COMPLETE", {
      jobNumber,
      jobUuid,
      amountPaid,
      paymentStatus,
      stripeSessionId,
    });

    if (!jobUuid) {
      console.error("❌ Missing ServiceM8 jobUuid in Stripe metadata");
      return NextResponse.json({ received: true });
    }

    if (paymentStatus !== "paid") {
      console.error("❌ Stripe session not marked as paid", {
        paymentStatus,
        stripeSessionId,
      });
      return NextResponse.json({ received: true });
    }

    try {
      const serviceM8Response = await fetch(
  "https://api.servicem8.com/api_1.0/jobpayment.json",
        {
          method: "POST",
          headers: {
            "X-API-Key": process.env.SERVICEM8_API_KEY!,
            "Content-Type": "application/json",
          },
        body: JSON.stringify({
  job_uuid: jobUuid,
  actioned_by_uuid: "",
  timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
  amount: String(amountPaid),
  method: "Stripe",
  note: `Stripe Checkout payment | Job ${jobNumber} | Session ${stripeSessionId}`,
}),
        }
      );

      const responseText = await serviceM8Response.text();

      if (!serviceM8Response.ok) {
        console.error("❌ ServiceM8 payment creation failed:", {
          status: serviceM8Response.status,
          response: responseText,
        });
      } else {
        console.log("💰 ServiceM8 payment created:", responseText);
      }
    } catch (err) {
      console.error("❌ ServiceM8 payment request error:", err);
    }
  }

  return NextResponse.json({ received: true });
}