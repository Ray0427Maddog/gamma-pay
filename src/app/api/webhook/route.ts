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
    const paymentRoute = session.metadata?.paymentRoute || "office";
    const customerName = session.metadata?.customerName || "";
    const address = session.metadata?.address || "";
    let customerEmail = "";

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

// Fetch job details from ServiceM8 to get customer email
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

console.log("📦 FULL JOB DATA:", JSON.stringify(jobData, null, 2));

const companyUuid = jobData?.company_uuid || "";

if (companyUuid) {
  const companyRes = await fetch(
    `https://api.servicem8.com/api_1.0/company/${companyUuid}.json`,
    {
      headers: {
        "X-API-Key": process.env.SERVICEM8_API_KEY!,
      },
    }
  );

  const companyData = await companyRes.json();

  console.log("🏢 FULL COMPANY DATA:", JSON.stringify(companyData, null, 2));

  customerEmail =
    companyData?.email ||
    companyData?.billing_email ||
    companyData?.contact_email ||
    "";
}

console.log("📧 Customer email fetched:", customerEmail);
} catch (err) {
  console.error("❌ Failed to fetch customer email:", err);
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
            note: `💳 Payment received via Gamma Pay (£${amountPaid.toFixed(
              2
            )}) | Route: ${paymentRoute} | Session ${stripeSessionId}`,
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

const zapierUrl = process.env.ZAPIER_PAYMENT_WEBHOOK_URL;

console.log("Zapier URL configured:", Boolean(zapierUrl));

if (zapierUrl) {
  try {
    const zapierRes = await fetch(zapierUrl, {
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
  stripeSessionId,
}),
    });

    console.log("📩 Zapier response:", zapierRes.status, await zapierRes.text());
    console.log("📩 Zapier webhook sent");
  } catch (err) {
    console.error("❌ Failed to send Zapier webhook:", err);
  }
}

if (markComplete) {
  const completeRes = await fetch(
    `https://api.servicem8.com/api_1.0/job/${jobUuid}.json`,
    {
      method: "POST",
      headers: {
        "X-API-Key": process.env.SERVICEM8_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: "Completed",
        completion_date: serviceM8Timestamp(),
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
    console.log("✅ ServiceM8 job completion request sent:", completeText);
  }
}
    } catch (err) {
      console.error("❌ ServiceM8 webhook handling error:", err);
    }
  }

  return NextResponse.json({ received: true });
}