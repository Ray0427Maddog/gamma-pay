import { NextRequest, NextResponse } from "next/server";
import { POST as generateContract } from "../heatcover-signup/contract/route";
import crypto from "crypto";
import {
  GC_BASE,
  gcHeaders,
  heatCoverMonthlyPence,
  unpackTerms,
} from "@/lib/heatcover";

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

  // HeatCover+ subscriptions are created when the customer
  // finishes the GoCardless hosted sign-up page
  // (billing request "fulfilled"). The plan details travel
  // in the billing request's metadata.
  if (
    resourceType !== "billing_requests" ||
    action !== "fulfilled"
  ) {
    continue;
  }

  const billingRequestId = event.links?.billing_request;

  if (!billingRequestId) {
    console.error(
      "GoCardless fulfilled event missing billing request ID"
    );
    continue;
  }

  console.log(
    `GoCardless billing request fulfilled: ${billingRequestId}`
  );

  const accessToken =
    process.env.HEATCOVER_GOCARDLESS_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error(
      "Missing HEATCOVER_GOCARDLESS_ACCESS_TOKEN"
    );
  }

  const brRes = await fetch(
    `${GC_BASE}/billing_requests/${encodeURIComponent(
      billingRequestId
    )}`,
    { method: "GET", headers: gcHeaders(accessToken) }
  );

  if (!brRes.ok) {
    throw new Error(
      `Failed to retrieve GoCardless billing request ${billingRequestId}`
    );
  }

  const brData = await brRes.json();
  const billingRequest = brData.billing_requests;
  const metadata = billingRequest?.metadata || {};

  // Ignore billing requests not created by HeatCover+ sign-up.
  if (!metadata.heatcover_signup_id) {
    console.log(
      `Billing request ${billingRequestId} is not a HeatCover+ signup - ignored`
    );
    continue;
  }

  const mandateId =
    billingRequest?.links?.mandate_request_mandate;

  if (!mandateId) {
    throw new Error(
      `HeatCover+ billing request ${billingRequestId} has no mandate`
    );
  }

  const mandateRes = await fetch(
    `${GC_BASE}/mandates/${encodeURIComponent(mandateId)}`,
    { method: "GET", headers: gcHeaders(accessToken) }
  );

  if (!mandateRes.ok) {
    throw new Error(
      `Failed to retrieve GoCardless mandate ${mandateId}`
    );
  }

  const mandate = (await mandateRes.json()).mandates;

  if (!mandate) {
    throw new Error(
      `GoCardless mandate ${mandateId} missing from response`
    );
  }

  const signupId = metadata.heatcover_signup_id;
  const plan = metadata.heatcover_plan;
  const terms = unpackTerms(metadata.heatcover_terms);
  const paymentDay = terms.paymentDay;
  const firstCollectionDate = terms.firstCollectionDate;

  if (
    typeof signupId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      signupId
    )
  ) {
    throw new Error(
      `HeatCover+ request ${billingRequestId} has invalid signup ID`
    );
  }

  if (!["v1", "v2", "v3", "v4"].includes(plan)) {
    throw new Error(
      `HeatCover+ request ${billingRequestId} has invalid plan`
    );
  }

  // Price is recalculated here, never trusted from metadata alone.
  const monthlyAmountPence = heatCoverMonthlyPence(
    plan,
    terms.excessFree,
    terms.neoU
  );

  if (terms.amountPence !== monthlyAmountPence) {
    throw new Error(
      `HeatCover+ request ${billingRequestId} has inconsistent pricing metadata`
    );
  }

  if (
    !Number.isInteger(paymentDay) ||
    paymentDay < 1 ||
    paymentDay > 28
  ) {
    throw new Error(
      `HeatCover+ request ${billingRequestId} has invalid payment day`
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstCollectionDate)) {
    throw new Error(
      `HeatCover+ request ${billingRequestId} has invalid first collection date`
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

// First collection = the customer's payment day, on or after
// the earliest date GoCardless can charge this new mandate.
const todayStr = new Date().toISOString().slice(0, 10);
const earliest = [
  todayStr,
  mandate.next_possible_charge_date || todayStr,
].sort()[1];

const earliestDate = new Date(`${earliest}T00:00:00Z`);

let nextCollectionDate = new Date(
  Date.UTC(
    earliestDate.getUTCFullYear(),
    earliestDate.getUTCMonth(),
    paymentDay
  )
);

if (nextCollectionDate < earliestDate) {
  nextCollectionDate = new Date(
    Date.UTC(
      earliestDate.getUTCFullYear(),
      earliestDate.getUTCMonth() + 1,
      paymentDay
    )
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
    name: `HeatCover+ ${plan.toUpperCase()}${terms.neoU ? " + Neo U" : ""}`,
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
  `${GC_BASE}/subscriptions`,
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

const conflictingSubscriptionId =
  subscriptionRes.status === 409
    ? subscriptionData?.error?.errors?.[0]?.links?.conflicting_resource_id
    : null;

if (conflictingSubscriptionId) {
  console.log(
    "HeatCover+ subscription already exists (webhook retry):",
    { signupId, subscriptionId: conflictingSubscriptionId }
  );
  continue;
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

// -----------------------------
// NEO U INSTALLATION FEE (one-off Direct Debit,
// collected on the same day as the first monthly payment)
// -----------------------------
if (plan === "v4" && terms.neoU && terms.neoUInstallPence > 0) {
  try {
    const installRes = await fetch(`${GC_BASE}/payments`, {
      method: "POST",
      headers: gcHeaders(
        accessToken,
        `hc-${signupId}-neou-install`
      ),
      body: JSON.stringify({
        payments: {
          amount: terms.neoUInstallPence,
          currency: "GBP",
          charge_date: effectiveFirstCollectionDate,
          description: "Neo U tank monitor installation",
          links: { mandate: mandateId },
          metadata: {
            heatcover_signup_id: signupId,
            heatcover_item: "neo_u_install",
          },
        },
      }),
    });

    const installData = await installRes.json().catch(() => ({}));
    const alreadyCreated =
      installRes.status === 409 &&
      installData?.error?.errors?.[0]?.links?.conflicting_resource_id;

    if (!installRes.ok && !alreadyCreated) {
      throw new Error(
        installData?.error?.message || `status ${installRes.status}`
      );
    }

    console.log("Neo U installation payment created:", {
      signupId,
      paymentId:
        installData?.payments?.id ||
        installData?.error?.errors?.[0]?.links?.conflicting_resource_id,
      amountPence: terms.neoUInstallPence,
      chargeDate: effectiveFirstCollectionDate,
    });
  } catch (installErr: any) {
    console.error(
      "Neo U installation payment FAILED - create it manually in GoCardless:",
      {
        signupId,
        mandateId,
        amountPence: terms.neoUInstallPence,
        error: installErr?.message || installErr,
      }
    );
  }
}

// The Direct Debit + subscription are already done at this point.
// Anything below (customer lookup, agreement email) must never make
// GoCardless retry the webhook, so failures are logged, not thrown.
try {
const customerId = mandate.links?.customer;

if (!customerId) {
  throw new Error(
    `HeatCover+ mandate ${mandateId} has no linked customer`
  );
}

console.log("HeatCover+ linked customer found:", {
  signupId,
});

const customerRes = await fetch(
  `${GC_BASE}/customers/${encodeURIComponent(customerId)}`,
  {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "GoCardless-Version": "2015-07-06",
      Accept: "application/json",
    },
  }
);

if (!customerRes.ok) {
  throw new Error(
    `Failed to retrieve HeatCover+ customer for signup ${signupId}`
  );
}

const customerData = await customerRes.json();
const customer = customerData.customers;

if (!customer) {
  throw new Error(
    `HeatCover+ customer missing from response for signup ${signupId}`
  );
}

const firstName = customer.given_name;
const lastName = customer.family_name;
const email = customer.email;
const phone = customer.phone_number || "";
const address = customer.address_line1;
const city = customer.city;
const postcode = customer.postal_code;

if (
  !firstName ||
  !lastName ||
  !email ||
  !address ||
  !city ||
  !postcode
) {
  throw new Error(
    `HeatCover+ customer details incomplete for signup ${signupId}`
  );
}

// -----------------------------
// EMAIL THE HEATCOVER+ AGREEMENT
// (contract PDF -> Zapier -> customer email)
// -----------------------------
const contractRes = await generateContract(
  new NextRequest("https://internal/heatcover-contract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      signupId,
      firstName,
      lastName,
      email,
      phone,
      address,
      city,
      postcode,
      paymentDay,
      plan,
      excessFree: plan !== "v3" && terms.excessFree,
      neoU: plan === "v4" && terms.neoU,
      neoUInstallPence: terms.neoUInstallPence,
    }),
  })
);

if (!contractRes.ok) {
  throw new Error(
    `HeatCover+ agreement could not be generated (status ${contractRes.status})`
  );
}

console.log("HeatCover+ agreement generated and handed to Zapier:", {
  signupId,
});

} catch (agreementErr: any) {
  console.error(
    "HeatCover+ agreement email FAILED - send it manually:",
    { signupId, error: agreementErr?.message || agreementErr }
  );
}
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