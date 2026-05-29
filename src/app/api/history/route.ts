import Stripe from "stripe";
import { NextResponse } from "next/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

function formatDateFromUnix(unix?: number | null) {
  if (!unix) return "Pending";

  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function pounds(amount: number | null | undefined) {
  return (Number(amount || 0) / 100).toFixed(2);
}

function routeLabel(route?: string) {
  if (route === "machine_01") return "S710";
  if (route === "office_moto") return "MOTO";
  return route || "Unknown";
}

export async function GET() {
  try {
    const now = new Date();

    const startOfMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
      0,
      0,
      0
    );

    const startUnix = Math.floor(startOfMonth.getTime() / 1000);

    const charges = await stripe.charges.list({
      created: {
        gte: startUnix,
      },
      limit: 100,
      expand: ["data.balance_transaction", "data.payment_intent"],
    });

    const rows = charges.data
      .filter((charge) => charge.paid && !charge.refunded)
      .map((charge) => {
        const paymentIntent =
          typeof charge.payment_intent === "string"
            ? null
            : charge.payment_intent;

        const metadata = paymentIntent?.metadata || charge.metadata || {};
        const paymentRoute = metadata.paymentRoute;

        if (paymentRoute !== "machine_01" && paymentRoute !== "office_moto") {
          return null;
        }

        const balanceTransaction =
          typeof charge.balance_transaction === "string"
            ? null
            : charge.balance_transaction;

        const gross = charge.amount;
        const fee = balanceTransaction?.fee || 0;
        const net = balanceTransaction?.net || 0;

        return {
          jobNumber: metadata.jobNumber || "",
          chargeDate: formatDateFromUnix(charge.created),
          route: routeLabel(paymentRoute),
          gross: pounds(gross),
          fee: pounds(fee),
          net: pounds(net),
payoutDate:
  balanceTransaction?.available_on
    ? formatDateFromUnix(balanceTransaction.available_on)
    : "Pending",
          stripeReference: charge.payment_intent
            ? String(
                typeof charge.payment_intent === "string"
                  ? charge.payment_intent
                  : charge.payment_intent.id
              ).slice(-8)
            : charge.id.slice(-8),
        };
      })
      .filter(Boolean);

    const summary = rows.reduce(
      (acc, row: any) => {
        acc.gross += Number(row.gross);
        acc.fees += Number(row.fee);
        acc.net += Number(row.net);
        return acc;
      },
      {
        gross: 0,
        fees: 0,
        net: 0,
      }
    );

    return NextResponse.json({
      success: true,
      month: now.toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric",
      }),
      summary: {
        gross: summary.gross.toFixed(2),
        fees: summary.fees.toFixed(2),
        net: summary.net.toFixed(2),
      },
      rows,
    });
  } catch (error: any) {
    console.error("History API error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Could not load payment history",
      },
      { status: 500 }
    );
  }
}