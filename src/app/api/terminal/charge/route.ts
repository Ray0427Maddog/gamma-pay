import Stripe from "stripe";
import { NextResponse } from "next/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      amount,
      jobNumber,
      jobUuid,
      customerName,
      address,
      customerEmail,
    } = body;

    if (!amount || !jobNumber || !jobUuid) {
      return NextResponse.json(
        { success: false, error: "Missing amount, jobNumber or jobUuid" },
        { status: 400 }
      );
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Number(amount),
      currency: "gbp",
      payment_method_types: ["card_present"],
      metadata: {
        jobNumber: String(jobNumber),
        jobUuid: String(jobUuid),
        paymentRoute: "machine_01",
        customerName: customerName ? String(customerName) : "",
        address: address ? String(address) : "",
        customerEmail: customerEmail ? String(customerEmail) : "",
      },
    });

    const reader = await stripe.terminal.readers.processPaymentIntent(
      process.env.STRIPE_READER_ID!,
      {
        payment_intent: paymentIntent.id,
      }
    );

    return NextResponse.json({
      success: true,
      paymentIntentId: paymentIntent.id,
      readerStatus: reader.status,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}