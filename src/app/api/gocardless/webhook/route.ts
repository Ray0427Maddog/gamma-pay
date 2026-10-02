import { NextResponse } from "next/server";
import crypto from "crypto";

export async function POST(req: Request) {
  try {
    const webhookSecret =
      process.env.GOCARDLESS_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error(
        "GoCardless webhook: missing GOCARDLESS_WEBHOOK_SECRET"
      );

      return NextResponse.json(
        { error: "Webhook not configured" },
        { status: 500 }
      );
    }

    // IMPORTANT:
    // Signature verification must use the raw request body.
    // Do not call req.json() before this.
    const rawBody = await req.text();

    const receivedSignature =
      req.headers.get("Webhook-Signature");

    if (!receivedSignature) {
      console.error(
        "GoCardless webhook: missing Webhook-Signature"
      );

      return NextResponse.json(
        { error: "Missing webhook signature" },
        { status: 401 }
      );
    }

    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    const receivedBuffer = Buffer.from(
      receivedSignature,
      "utf8"
    );

    const expectedBuffer = Buffer.from(
      expectedSignature,
      "utf8"
    );

    const signatureValid =
      receivedBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(
        receivedBuffer,
        expectedBuffer
      );

    if (!signatureValid) {
      console.error(
        "GoCardless webhook: invalid signature"
      );

      return NextResponse.json(
        { error: "Invalid webhook signature" },
        { status: 401 }
      );
    }

    // Signature is valid. Only now may we parse the JSON.
    let body: any;

    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Invalid webhook JSON" },
        { status: 400 }
      );
    }

    const events = Array.isArray(body.events)
      ? body.events
      : [];

    console.log(
      `GoCardless webhook authenticated: ${events.length} event(s)`
    );

    // Event processing comes next.
    // For now we deliberately do nothing with them.

    return new NextResponse(null, {
      status: 204,
    });
  } catch (err: any) {
    console.error(
      "GoCardless webhook error:",
      err?.message || err
    );

    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}