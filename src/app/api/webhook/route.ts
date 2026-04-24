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

    const jobNumber = session.metadata?.jobNumber;
    const amountPaid = session.amount_total;
    const paymentStatus = session.payment_status;
    const stripeSessionId = session.id;

    console.log("✅ PAYMENT COMPLETE", {
      jobNumber,
      amountPaid,
      paymentStatus,
      stripeSessionId,
    });

    // NEXT STEP:
    // This is where we will create a ServiceM8 Job Payment.
  }

  return NextResponse.json({ received: true });
}