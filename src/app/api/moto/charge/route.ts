import Stripe from "stripe";
import { NextResponse } from "next/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  try {
    const {
      amount,
      jobNumber,
      jobUuid,
      markComplete,
      customerName,
      address,
      paymentMethodId,
    } = await req.json();

    if (!amount || !jobNumber || !paymentMethodId) {
      return NextResponse.json(
        { error: "Missing amount, job number, or payment method" },
        { status: 400 }
      );
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(Number(amount)),
      currency: "gbp",
      payment_method: String(paymentMethodId),
      payment_method_types: ["card"],
      confirm: true,
      error_on_requires_action: true,
      payment_method_options: {
        card: {
          moto: true,
        },
      },
      metadata: {
        jobNumber: String(jobNumber),
        jobUuid: String(jobUuid || ""),
        markComplete: markComplete ? "yes" : "no",
        paymentRoute: "office_moto",
        customerName: String(customerName || ""),
        address: String(address || ""),
      },
    });

    return NextResponse.json({
      success: true,
      paymentIntentId: paymentIntent.id,
      status: paymentIntent.status,
    });
  } catch (err: any) {
    console.error("MOTO charge error:", err);

    return NextResponse.json(
      { error: err.message || "Could not process MOTO payment" },
      { status: 500 }
    );
  }
}