import Stripe from "stripe";
import { NextResponse } from "next/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

function serviceM8Timestamp() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

async function processGammaPayPayment({
  jobNumber,
  jobUuid,
  markComplete,
  paymentRoute,
  customerName,
  address,
  amountPaid,
  stripeReference,
}: {
  jobNumber: string;
  jobUuid: string;
  markComplete: boolean;
  paymentRoute: string;
  customerName: string;
  address: string;
  amountPaid: number;
  stripeReference: string;
}) {
  let customerEmail = "";

  if (!jobUuid) {
    console.error("❌ Missing ServiceM8 jobUuid in Stripe metadata");
    return;
  }

  try {
    const jobRes = await fetch(
      `https://api.servicem8.com/api_1.0/job/${jobUuid}.json`,
      {
        headers: {
          "X-API-Key": process.env.SERVICEM8_API_KEY!,
        },
      }
    );

    const jobData = await jobRes.json();
    const companyUuid = jobData?.company_uuid || "";

    if (companyUuid) {
      const contactsRes = await fetch(
        `https://api.servicem8.com/api_1.0/companycontact.json?$filter=company_uuid eq ${companyUuid}`,
        {
          headers: {
            "X-API-Key": process.env.SERVICEM8_API_KEY!,
          },
        }
      );

      const contactsData = await contactsRes.json();

      if (Array.isArray(contactsData)) {
        const billingContact =
          contactsData.find(
            (contact) =>
              contact.type === "BILLING" &&
              Number(contact.active) === 1 &&
              contact.email
          ) ||
          contactsData.find(
            (contact) =>
              contact.is_primary_contact === "1" && contact.email
          ) ||
          contactsData.find((contact) => contact.email);

        customerEmail = billingContact?.email || "";
      }
    }

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
          method: paymentRoute === "machine_01" ? "Card Machine" : "Stripe",
          note: `Gamma Pay payment | Job ${jobNumber} | Route ${paymentRoute} | Ref ${stripeReference}`,
        }),
      }
    );

    const paymentText = await paymentRes.text();

    if (!paymentRes.ok) {
      console.error("❌ ServiceM8 payment creation failed:", {
        status: paymentRes.status,
        response: paymentText,
      });
      return;
    }

    const noteRes = await fetch("https://api.servicem8.com/api_1.0/note.json", {
      method: "POST",
      headers: {
        "X-API-Key": process.env.SERVICEM8_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        related_object_uuid: jobUuid,
        related_object: "job",
        note: `💳 Payment received via Gamma Pay (£${amountPaid.toFixed(
          2
        )}) | Route: ${paymentRoute} | Ref ${stripeReference}`,
      }),
    });

    if (!noteRes.ok) {
      console.error("❌ Failed to create ServiceM8 note:", {
        status: noteRes.status,
        response: await noteRes.text(),
      });
    }

    const zapierUrl = process.env.ZAPIER_PAYMENT_WEBHOOK_URL;

    if (zapierUrl) {
      await fetch(zapierUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jobNumber,
          jobUuid,
          customerName,
          address,
          customerEmail,
          amountPaid,
          paymentRoute,
          stripeSessionId: stripeReference,
        }),
      });
    }

    if (markComplete) {
      await fetch(`https://api.servicem8.com/api_1.0/job/${jobUuid}.json`, {
        method: "POST",
        headers: {
          "X-API-Key": process.env.SERVICEM8_API_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: "Completed",
          completion_date: serviceM8Timestamp(),
        }),
      });
    }

    console.log("✅ Gamma Pay payment processed:", {
      jobNumber,
      jobUuid,
      amountPaid,
      paymentRoute,
      stripeReference,
    });
  } catch (err) {
    console.error("❌ Gamma Pay webhook handling error:", err);
  }
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

    if (session.payment_status !== "paid") {
      return NextResponse.json({ received: true });
    }

    await processGammaPayPayment({
      jobNumber: session.metadata?.jobNumber || "",
      jobUuid: session.metadata?.jobUuid || "",
      markComplete: session.metadata?.markComplete === "yes",
      paymentRoute: session.metadata?.paymentRoute || "office",
      customerName: session.metadata?.customerName || "",
      address: session.metadata?.address || "",
      amountPaid: (session.amount_total || 0) / 100,
      stripeReference: session.id,
    });
  }

if (event.type === "payment_intent.succeeded") {
  const paymentIntent = event.data.object as Stripe.PaymentIntent;

  if (paymentIntent.metadata?.paymentRoute !== "machine_01") {
    return NextResponse.json({ received: true });
  }

  // 🔁 Re-fetch to get latest metadata (important for retries)
  const freshPaymentIntent = await stripe.paymentIntents.retrieve(
    paymentIntent.id
  );

  // 🚫 Prevent duplicate processing
  if (freshPaymentIntent.metadata?.gammaPayProcessed === "yes") {
    console.log(
      "⚠️ Gamma Pay already processed this PaymentIntent:",
      paymentIntent.id
    );
    return NextResponse.json({ received: true });
  }

  // ✅ Process payment
  await processGammaPayPayment({
    jobNumber: paymentIntent.metadata?.jobNumber || "",
    jobUuid: paymentIntent.metadata?.jobUuid || "",
    markComplete: paymentIntent.metadata?.markComplete === "yes",
    paymentRoute: paymentIntent.metadata?.paymentRoute || "machine_01",
    customerName: paymentIntent.metadata?.customerName || "",
    address: paymentIntent.metadata?.address || "",
    amountPaid: paymentIntent.amount_received / 100,
    stripeReference: paymentIntent.id,
  });

  // 🏷️ Mark as processed to prevent future duplicates
  await stripe.paymentIntents.update(paymentIntent.id, {
    metadata: {
      ...freshPaymentIntent.metadata,
      gammaPayProcessed: "yes",
    },
  });

  console.log(
    "✅ PaymentIntent marked as Gamma Pay processed:",
    paymentIntent.id
  );
}
  return NextResponse.json({ received: true });
}