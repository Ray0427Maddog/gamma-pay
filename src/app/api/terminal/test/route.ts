import Stripe from "stripe";
import { NextResponse } from "next/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST() {
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 100,
      currency: "gbp",
      payment_method_types: ["card_present"],
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
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}