import Stripe from "stripe";
import { NextResponse } from "next/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  const { amount, jobNumber } = await req.json();

  if (!amount || !jobNumber) {
    return NextResponse.json(
      { error: "Missing amount or job number" },
      { status: 400 }
    );
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "gbp",
          product_data: {
            name: `ServiceM8 Job #${jobNumber}`,
          },
          unit_amount: Math.round(Number(amount) * 100),
        },
        quantity: 1,
      },
    ],
    success_url: `${req.headers.get("origin")}/?success=true`,
    cancel_url: `${req.headers.get("origin")}/?cancelled=true`,
    metadata: {
      jobNumber,
    },
  });

  return NextResponse.json({ url: session.url });
}