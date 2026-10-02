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

for (const event of events) {
  const resourceType = event.resource_type;
  const action = event.action;

  // HeatCover+ subscriptions are only created when
  // a GoCardless mandate becomes active.
  if (
    resourceType !== "mandates" ||
    action !== "active"
  ) {
    continue;
  }

  const mandateId = event.links?.mandate;

  if (!mandateId) {
    console.error(
      "GoCardless mandate active event missing mandate ID"
    );
    continue;
  }

  console.log(
    `GoCardless active mandate received: ${mandateId}`
  );
  const accessToken =
  process.env.GOCARDLESS_ACCESS_TOKEN;

if (!accessToken) {
  throw new Error(
    "Missing GOCARDLESS_ACCESS_TOKEN"
  );
}

const mandateRes = await fetch(
  `https://api.gocardless.com/mandates/${encodeURIComponent(
    mandateId
  )}`,
  {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "GoCardless-Version": "2015-07-06",
      Accept: "application/json",
    },
  }
);

if (!mandateRes.ok) {
  console.error(
    "GoCardless webhook: failed to retrieve mandate",
    {
      mandateId,
      status: mandateRes.status,
    }
  );

  throw new Error(
    `Failed to retrieve GoCardless mandate ${mandateId}`
  );
}

const mandateData = await mandateRes.json();
const mandate = mandateData.mandates;

if (!mandate) {
  throw new Error(
    `GoCardless mandate ${mandateId} missing from response`
  );
}

const metadata = mandate.metadata || {};

// Ignore mandates that were not created by our
// HeatCover+ signup flow.
if (!metadata.heatcover_signup_id) {
  console.log(
    `GoCardless mandate ${mandateId} is not a HeatCover+ signup mandate - ignored`
  );
  continue;
}

console.log(
  "HeatCover+ active mandate verified:",
  {
    mandateId,
    signupId: metadata.heatcover_signup_id,
    plan: metadata.heatcover_plan,
  }
);

const signupId = metadata.heatcover_signup_id;
const plan = metadata.heatcover_plan;
const excessFree = metadata.excess_free;

const storedMonthlyAmountPence = Number(
  metadata.monthly_amount_pence
);

const paymentDay = Number(
  metadata.payment_day
);

const firstCollectionDate =
  metadata.first_collection_date;

const validPlans = ["v1", "v2", "v3", "v4"];

if (
  typeof signupId !== "string" ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    signupId
  )
) {
  throw new Error(
    `HeatCover+ mandate ${mandateId} has invalid signup ID`
  );
}

if (!validPlans.includes(plan)) {
  throw new Error(
    `HeatCover+ mandate ${mandateId} has invalid plan`
  );
}

let monthlyAmountPence: number;

if (plan === "v1") {
  monthlyAmountPence =
    excessFree === "yes" ? 3800 : 2700;
} else if (plan === "v2") {
  monthlyAmountPence =
    excessFree === "yes" ? 2900 : 1800;
} else if (plan === "v3") {
  monthlyAmountPence = 1200;
} else if (plan === "v4") {
  monthlyAmountPence =
    excessFree === "yes" ? 4900 : 3800;
} else {
  throw new Error(
    `HeatCover+ mandate ${mandateId} has invalid plan`
  );
}

if (
  !Number.isInteger(storedMonthlyAmountPence) ||
  storedMonthlyAmountPence !== monthlyAmountPence
) {
  throw new Error(
    `HeatCover+ mandate ${mandateId} has inconsistent pricing metadata`
  );
}

if (
  !Number.isInteger(paymentDay) ||
  paymentDay < 1 ||
  paymentDay > 28
) {
  throw new Error(
    `HeatCover+ mandate ${mandateId} has invalid payment day`
  );
}

if (
  typeof firstCollectionDate !== "string" ||
  !/^\d{4}-\d{2}-\d{2}$/.test(firstCollectionDate)
) {
  throw new Error(
    `HeatCover+ mandate ${mandateId} has invalid first collection date`
  );
}

console.log(
  "HeatCover+ subscription data validated:",
  {
    mandateId,
    signupId,
    plan,
    monthlyAmountPence,
    paymentDay,
    firstCollectionDate,
  }
);

const today = new Date();

const yyyy = today.getUTCFullYear();
const mm = today.getUTCMonth();

let nextCollectionDate = new Date(
  Date.UTC(yyyy, mm, paymentDay)
);

// If this month's requested day has already passed,
// move the first collection to next month.
if (nextCollectionDate <= today) {
  nextCollectionDate = new Date(
    Date.UTC(yyyy, mm + 1, paymentDay)
  );
}

const effectiveFirstCollectionDate =
  nextCollectionDate.toISOString().slice(0, 10);

console.log(
  "HeatCover+ effective first collection date:",
  {
    mandateId,
    requestedFirstCollectionDate:
      firstCollectionDate,
    effectiveFirstCollectionDate,
  }
);

// -----------------------------
// CREATE HEATCOVER+ SUBSCRIPTION
// -----------------------------

const subscriptionPayload = {
  subscriptions: {
    amount: monthlyAmountPence,
    currency: "GBP",
    name: `HeatCover+ ${plan.toUpperCase()}`,
    interval_unit: "monthly",
    interval: 1,
    day_of_month: paymentDay,
    start_date: effectiveFirstCollectionDate,
    links: {
      mandate: mandateId,
    },
    metadata: {
      heatcover_signup_id: signupId,
      heatcover_plan: plan,
    },
  },
};

const subscriptionRes = await fetch(
  "https://api.gocardless.com/subscriptions",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "GoCardless-Version": "2015-07-06",
      "Content-Type": "application/json",
      "Idempotency-Key": `hc-${signupId}-subscription`,
    },
    body: JSON.stringify(subscriptionPayload),
  }
);

const subscriptionText =
  await subscriptionRes.text();

let subscriptionData: any = {};

try {
  subscriptionData = JSON.parse(subscriptionText);
} catch {
  subscriptionData = {};
}

if (!subscriptionRes.ok) {
  console.error(
    "HeatCover+ subscription creation failed:",
    {
      mandateId,
      signupId,
      status: subscriptionRes.status,
    }
  );

  throw new Error(
    `Failed to create HeatCover+ subscription for mandate ${mandateId}`
  );
}

const subscriptionId =
  subscriptionData.subscriptions?.id;

if (!subscriptionId) {
  throw new Error(
    `GoCardless subscription created but no subscription ID returned for mandate ${mandateId}`
  );
}

console.log(
  "HeatCover+ subscription created:",
  {
    mandateId,
    signupId,
    subscriptionId,
    plan,
  }
);

}

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