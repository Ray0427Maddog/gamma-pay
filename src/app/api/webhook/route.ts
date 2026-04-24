import Stripe from "stripe";
import { NextResponse } from "next/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

function serviceM8Timestamp() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

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
    const markComplete = session.metadata?.markComplete === "yes";

    const amountPaid = (session.amount_total || 0) / 100;
    const paymentStatus = session.payment_status;
    const stripeSessionId = session.id;

    console.log("✅ PAYMENT COMPLETE", {
      jobNumber,
      jobUuid,
      markComplete,
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
      const paymentRes = await fetch(
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
            timestamp: serviceM8Timestamp(),
            amount: String(amountPaid),
            method: "Stripe",
            note: `Stripe Checkout payment | Job ${jobNumber} | Session ${stripeSessionId}`,
          }),
        }
      );

      const paymentText = await paymentRes.text();

      if (!paymentRes.ok) {
        console.error("❌ ServiceM8 payment creation failed:", {
          status: paymentRes.status,
          response: paymentText,
        });

        return NextResponse.json({ received: true });
      }

      console.log("💰 ServiceM8 payment created:", paymentText);

      const noteRes = await fetch(
        "https://api.servicem8.com/api_1.0/note.json",
        {
          method: "POST",
          headers: {
            "X-API-Key": process.env.SERVICEM8_API_KEY!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            related_object_uuid: jobUuid,
            related_object: "job",
            note: `💳 Payment received via Stripe (£${amountPaid.toFixed(
              2
            )}) | Session ${stripeSessionId}`,
          }),
        }
      );

      const noteText = await noteRes.text();

      if (!noteRes.ok) {
        console.error("❌ Failed to create ServiceM8 note:", {
          status: noteRes.status,
          response: noteText,
        });
      } else {
        console.log("📝 ServiceM8 note created:", noteText);
      }

if (markComplete) {
  const completeRes = await fetch(
    `https://api.servicem8.com/api_1.0/job/${jobUuid}.json`,
    {
      method: "PUT", // ✅ THIS IS THE FIX
      headers: {
        "X-API-Key": process.env.SERVICEM8_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: "Completed",
        completion_date: new Date()
          .toISOString()
          .slice(0, 19)
          .replace("T", " "),
      }),
    }
  );

  const completeText = await completeRes.text();

  if (!completeRes.ok) {
    console.error("❌ Failed to mark ServiceM8 job complete:", {
      status: completeRes.status,
      response: completeText,
    });
  } else {
    console.log("✅ ServiceM8 job marked complete:", completeText);
  }
}
    } catch (err) {
      console.error("❌ ServiceM8 webhook handling error:", err);
    }
  }

  return NextResponse.json({ received: true });
}