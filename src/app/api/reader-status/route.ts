import Stripe from "stripe";
import { NextResponse } from "next/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function GET() {
  try {
    const readers = await stripe.terminal.readers.list({
      limit: 10,
    });

    const reader = readers.data.find((r) =>
      ["stripe_s700", "stripe_s710", "simulated_s700", "simulated_s710"].includes(
        r.device_type
      )
    );

    if (!reader) {
      return NextResponse.json({
        status: "not_connected",
        label: "S710 not found",
      });
    }

    return NextResponse.json({
      status: reader.status === "online" ? "connected" : "not_connected",
      label: reader.status === "online" ? "S710 connected" : "S710 not connected",
      readerId: reader.id,
      readerLabel: reader.label,
    });
  } catch {
    return NextResponse.json({
      status: "not_connected",
      label: "S710 status unavailable",
    });
  }
}