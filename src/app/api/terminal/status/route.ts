import Stripe from "stripe";
import { NextResponse } from "next/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const paymentIntentId = searchParams.get("paymentIntentId");

    if (!paymentIntentId) {
      return NextResponse.json(
        { success: false, error: "Missing paymentIntentId" },
        { status: 400 }
      );
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    return NextResponse.json({
      success: true,
      id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      amountReceived: paymentIntent.amount_received,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Could not check payment status" },
      { status: 500 }
    );
  }
}