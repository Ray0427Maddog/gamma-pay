import Stripe from "stripe";
import { NextResponse } from "next/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST() {
  try {
    const reader = await stripe.terminal.readers.cancelAction(
      process.env.STRIPE_READER_ID!
    );

    return NextResponse.json({
      success: true,
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