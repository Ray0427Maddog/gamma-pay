import Stripe from "stripe";
import { NextResponse } from "next/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  const { amount, jobNumber, jobUuid, markComplete } = await req.json();

  if (!amount || !jobNumber) {
    return NextResponse.json(
      { error: "Missing amount or job number" },
      { status: 400 }
    );
  }

  const origin = req.headers.get("origin") || "https://gamma-pay.vercel.app";

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
    success_url: `${origin}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?cancelled=true`,
    metadata: {
      jobNumber: String(jobNumber),
      jobUuid: String(jobUuid || ""),
      markComplete: markComplete ? "yes" : "no",
    },
  });

  return NextResponse.json({ url: session.url });
}