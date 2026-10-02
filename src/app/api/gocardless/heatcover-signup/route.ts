import { NextResponse } from "next/server";

function getFirstCollectionDate(paymentDay: number) {
  const now = new Date();

  // Work in UTC so Vercel/server timezone cannot shift the date.
  const today = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    )
  );

  const minimumDate = new Date(today);
  minimumDate.setUTCDate(minimumDate.getUTCDate() + 7);

  let candidate = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      paymentDay
    )
  );

  // If this month's requested payment day is too soon,
  // use the same payment day next month.
  if (candidate < minimumDate) {
    candidate = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth() + 1,
        paymentDay
      )
    );
  }

  return candidate.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      signupId,
      firstName,
      lastName,
      email,
      phone,
      address,
      city,
      postcode,

      plan,
      excessFree,

      accountHolderName,
      sortCode,
      accountNumber,
      paymentDay,
    } = body;

// -----------------------------
// SIGNUP VALIDATION
// -----------------------------

if (
  typeof signupId !== "string" ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    signupId
  )
) {
  return NextResponse.json(
    {
      success: false,
      error: "Invalid HeatCover+ signup ID",
    },
    { status: 400 }
  );
}
    // -----------------------------
    // CUSTOMER VALIDATION
    // -----------------------------

    if (
      !firstName?.trim() ||
      !lastName?.trim() ||
      !email?.trim() ||
      !phone?.trim() ||
      !address?.trim() ||
      !city?.trim() ||
      !postcode?.trim()
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing customer details",
        },
        { status: 400 }
      );
    }

    // -----------------------------
    // PLAN VALIDATION
    // -----------------------------

    if (!["v1", "v2", "v3", "v4"].includes(plan)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid HeatCover+ plan",
        },
        { status: 400 }
      );
    }

    // -----------------------------
// AUTHORITATIVE PLAN PRICING
// -----------------------------

const basePrices: Record<string, number> = {
  v1: 2700,
  v2: 1800,
  v3: 1200,
  v4: 3800,
};

if (plan === "v3" && excessFree === true) {
  return NextResponse.json(
    {
      success: false,
      error: "V3 does not support Excess Free",
    },
    { status: 400 }
  );
}

if (
  plan !== "v3" &&
  typeof excessFree !== "boolean"
) {
  return NextResponse.json(
    {
      success: false,
      error: "Invalid excess option",
    },
    { status: 400 }
  );
}

const monthlyAmountPence =
  basePrices[plan] +
  (plan !== "v3" && excessFree === true ? 1100 : 0);

    // -----------------------------
    // BANK VALIDATION
    // -----------------------------

    const cleanSortCode = String(sortCode || "").replace(/\D/g, "");
    const cleanAccountNumber = String(accountNumber || "").replace(/\D/g, "");

    if (!accountHolderName?.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing account holder name",
        },
        { status: 400 }
      );
    }

    if (cleanSortCode.length !== 6) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid sort code",
        },
        { status: 400 }
      );
    }

    if (cleanAccountNumber.length !== 8) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid account number",
        },
        { status: 400 }
      );
    }

    if (
      !Number.isInteger(paymentDay) ||
      paymentDay < 1 ||
      paymentDay > 28
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid payment day",
        },
        { status: 400 }
      );
    }

const firstCollectionDate =
  getFirstCollectionDate(paymentDay);

// -----------------------------
// GOCARDLESS
// CREATE CUSTOMER ONLY
// -----------------------------

const accessToken = process.env.GOCARDLESS_ACCESS_TOKEN;

if (!accessToken) {
  return NextResponse.json(
    {
      success: false,
      error: "Missing GoCardless token",
    },
    { status: 500 }
  );
}

const customerPayload = {
  customers: {
    given_name: firstName.trim(),
    family_name: lastName.trim(),
    email: email.trim(),
    phone_number: phone.trim(),
    address_line1: address.trim(),
    city: city.trim(),
    postal_code: postcode.trim().toUpperCase(),
    country_code: "GB",
  },
};

const customerRes = await fetch(
  "https://api.gocardless.com/customers",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "GoCardless-Version": "2015-07-06",
      "Content-Type": "application/json",
      "Idempotency-Key": `hc-${signupId}-customer`,
    },
    body: JSON.stringify(customerPayload),
  }
);

const customerText = await customerRes.text();

let customerData: any = {};

try {
  customerData = JSON.parse(customerText);
} catch {
  customerData = {
    raw: customerText,
  };
}

if (!customerRes.ok) {
  console.error("GoCardless customer creation failed:", {
    status: customerRes.status,
    statusText: customerRes.statusText,
    response: customerData,
    raw: customerText,
  });

  return NextResponse.json(
    {
      success: false,
      error:
        customerData.error?.message ||
        "Failed to create GoCardless customer",
      details:
        customerData.error?.errors ||
        customerData,
    },
    { status: customerRes.status }
  );
}

const customerId = customerData.customers?.id;

if (!customerId) {
  return NextResponse.json(
    {
      success: false,
      error: "GoCardless customer created but no customer ID returned",
    },
    { status: 500 }
  );
}

// -----------------------------
// GOCARDLESS
// CREATE CUSTOMER BANK ACCOUNT
// -----------------------------

const bankAccountPayload = {
  customer_bank_accounts: {
    account_holder_name: accountHolderName.trim(),
    account_number: cleanAccountNumber,
    branch_code: cleanSortCode,
    country_code: "GB",
    currency: "GBP",
    links: {
      customer: customerId,
    },
  },
};

const bankAccountRes = await fetch(
  "https://api.gocardless.com/customer_bank_accounts",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "GoCardless-Version": "2015-07-06",
      "Content-Type": "application/json",
      "Idempotency-Key": `hc-${signupId}-bank`,
    },
    body: JSON.stringify(bankAccountPayload),
  }
);

const bankAccountText = await bankAccountRes.text();

let bankAccountData: any = {};

try {
  bankAccountData = JSON.parse(bankAccountText);
} catch {
  bankAccountData = {
    raw: bankAccountText,
  };
}

if (!bankAccountRes.ok) {
  console.error("GoCardless bank account creation failed:", {
    status: bankAccountRes.status,
  });

  return NextResponse.json(
    {
      success: false,
      error:
        bankAccountData.error?.message ||
        "Failed to create GoCardless bank account",
      details:
        bankAccountData.error?.errors ||
        "GoCardless rejected the bank account details",
    },
    { status: bankAccountRes.status }
  );
}

const bankAccountId =
  bankAccountData.customer_bank_accounts?.id;

if (!bankAccountId) {
  return NextResponse.json(
    {
      success: false,
      error:
        "GoCardless bank account created but no bank account ID returned",
    },
    { status: 500 }
  );
}

// -----------------------------
// GOCARDLESS
// CREATE BACS MANDATE
// -----------------------------

const mandatePayload = {
  mandates: {
    scheme: "bacs",
    links: {
      customer_bank_account: bankAccountId,
    },
    metadata: {
  heatcover_signup_id: signupId,
  heatcover_plan: String(plan),
  excess_free:
    plan === "v3"
      ? "not_applicable"
      : excessFree === true
      ? "yes"
      : "no",
  monthly_amount_pence: String(monthlyAmountPence),
  payment_day: String(paymentDay),
  first_collection_date: firstCollectionDate,
},
  },
};

const mandateRes = await fetch(
  "https://api.gocardless.com/mandates",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "GoCardless-Version": "2015-07-06",
      "Content-Type": "application/json",
      "Idempotency-Key": `hc-${signupId}-mandate`,
    },
    body: JSON.stringify(mandatePayload),
  }
);

const mandateText = await mandateRes.text();

let mandateData: any = {};

try {
  mandateData = JSON.parse(mandateText);
} catch {
  mandateData = {
    raw: mandateText,
  };
}

if (!mandateRes.ok) {
  console.error("GoCardless mandate creation failed:", {
    status: mandateRes.status,
  });

  return NextResponse.json(
    {
      success: false,
      error:
        mandateData.error?.message ||
        "Failed to create GoCardless mandate",
      details:
        mandateData.error?.errors ||
        "GoCardless rejected the mandate request",
    },
    { status: mandateRes.status }
  );
}

const mandateId = mandateData.mandates?.id;
const mandateStatus = mandateData.mandates?.status;

if (!mandateId) {
  return NextResponse.json(
    {
      success: false,
      error:
        "GoCardless mandate created but no mandate ID returned",
    },
    { status: 500 }
  );
}

// -----------------------------
// MANDATE CREATED
// SUBSCRIPTION IS CREATED SEPARATELY
// -----------------------------

return NextResponse.json({
  success: true,
  stage: "mandate_created",
  customerId,
  mandateId,
  mandateStatus,
  plan,
  monthlyAmountPence,
  paymentDay,
  firstCollectionDate,
});

  } catch (err: any) {
    console.error("HeatCover signup route error:", err);

    return NextResponse.json(
      {
        success: false,
        error: err?.message || "HeatCover+ signup failed",
      },
      { status: 500 }
    );
  }
}