import { NextResponse } from "next/server";
import { getNeoUInstallPrice } from "@/lib/heatcover";

// Current Neo U installation price, read live from the website shop.
export async function GET() {
  try {
    const price = await getNeoUInstallPrice();
    return NextResponse.json({ success: true, ...price });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Price lookup failed",
      },
      { status: 502 }
    );
  }
}
