import Stripe from "stripe";
import { NextResponse } from "next/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

async function serviceM8Get(path: string, apiKey: string) {
  const res = await fetch(
    `https://api.servicem8.com/api_1.0/${path}`,
    {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ServiceM8 error ${res.status}: ${text}`);
  }

  return res.json();
}

const GOCARDLESS_BASE_URL = "https://api.gocardless.com";
const GOCARDLESS_VERSION = "2015-07-06";

function formatDateFromUnix(unix?: number | null) {
  if (!unix) return "Pending";

  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateFromString(date?: string | null) {
  if (!date) return "Pending";

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return "Pending";
  }

  return parsedDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function pounds(amount: number | string | null | undefined) {
  return (Number(amount || 0) / 100).toFixed(2);
}

function serviceM8Pounds(
  amount: number | string | null | undefined
) {
  return Number(amount || 0).toFixed(2);
} 

function estimateServiceM8Fee(
  amount: number | string | null | undefined
) {
  const amountPounds = Number(amount || 0);

  // Standard UK domestic ServiceM8 Pay card:
  // 1.65% + 20p
  const fee = amountPounds * 0.0165 + 0.2;

  return fee.toFixed(2);
}
function estimateNextBusinessDay(
  date: string | null | undefined
) {
  if (!date) return "Pending";

  const payoutDate = new Date(String(date).replace(" ", "T"));

  if (Number.isNaN(payoutDate.getTime())) {
    return "Pending";
  }

  // Add one day first
  payoutDate.setDate(payoutDate.getDate() + 1);

  // If it lands on Saturday or Sunday, move to Monday
  while (payoutDate.getDay() === 0 || payoutDate.getDay() === 6) {
    payoutDate.setDate(payoutDate.getDate() + 1);
  }

  return payoutDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function estimateServiceM8Net(
  amount: number | string | null | undefined
) {
  const amountPounds = Number(amount || 0);
  const fee = amountPounds * 0.0165 + 0.2;

  return (amountPounds - fee).toFixed(2);
}

function serviceM8DateTime(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day} 00:00:00`;
}

function estimateGoCardlessFee(
  amount: number | string | null | undefined
) {
  const amountPence = Number(amount || 0);

  // UK GoCardless Standard:
  // 1% + 20p, capped at £4 before VAT.
  const feeBeforeVat = Math.min(
    Math.round(amountPence * 0.0125) + 20,
500
  );

  // GoCardless fees are subject to 20% UK VAT.
  const feeIncludingVat = Math.round(feeBeforeVat * 1.2);

  return pounds(feeIncludingVat);
}

function estimateGoCardlessNet(
  amount: number | string | null | undefined
) {
  const amountPence = Number(amount || 0);

  const feeBeforeVat = Math.min(
    Math.round(amountPence * 0.0125) + 20,
500
  );

  const feeIncludingVat = Math.round(feeBeforeVat * 1.2);

  return pounds(amountPence - feeIncludingVat);
}

function routeLabel(route?: string) {
  if (route === "machine_01") return "S710";
  if (route === "office_moto") return "MOTO";
  return route || "Unknown";
}

function goCardlessHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "GoCardless-Version": GOCARDLESS_VERSION,
    "Content-Type": "application/json",
  };
}

async function fetchGoCardless(path: string, accessToken: string) {
  const response = await fetch(`${GOCARDLESS_BASE_URL}${path}`, {
    method: "GET",
    headers: goCardlessHeaders(accessToken),
    cache: "no-store",
  });

  const responseText = await response.text();

  let data: any = {};

  try {
    data = JSON.parse(responseText);
  } catch {
    data = {
      raw: responseText,
    };
  }

  if (!response.ok) {
    throw new Error(
      data.error?.message ||
        `GoCardless request failed with status ${response.status}`
    );
  }

  return data;
}

async function getGoCardlessPayoutDate(
  payment: any,
  accessToken: string,
  payoutCache: Map<string, string>
) {
  const payoutId = payment.links?.payout;

  if (!payoutId) {
    return null;
  }

  const cachedDate = payoutCache.get(payoutId);

  if (cachedDate) {
    return cachedDate;
  }

  const payoutData = await fetchGoCardless(
    `/payouts/${payoutId}`,
    accessToken
  );

  const payout = payoutData.payouts || {};

  const payoutDate =
    payout.arrival_date ||
    payout.created_at ||
    null;

  if (!payoutDate) {
    return null;
  }

  const formattedDate = formatDateFromString(payoutDate);

  payoutCache.set(payoutId, formattedDate);

  return formattedDate;
}

async function getAllGoCardlessPayments(
  accessToken: string,
  startDate: string,
  endDate: string
) {
  const payments: any[] = [];
  let after: string | null = null;

  do {
 const params = new URLSearchParams({
  limit: "500",
  "created_at[gte]": `${startDate}T00:00:00.000Z`,
  "created_at[lt]": `${endDate}T00:00:00.000Z`,
});

    if (after) {
      params.set("after", after);
    }

    const data = await fetchGoCardless(
      `/payments?${params.toString()}`,
      accessToken
    );

    payments.push(...(data.payments || []));

    after = data.meta?.cursors?.after || null;
  } while (after);

  return payments;
}

async function getGoCardlessCustomerName(
  payment: any,
  accessToken: string,
  customerCache: Map<string, string>,
  mandateCustomerCache: Map<string, string>
) {
  const metadataName = String(
    payment.metadata?.customerName || ""
  ).trim();

  if (metadataName) {
    return metadataName;
  }

  const mandateId = payment.links?.mandate;

  if (!mandateId) {
    return "Unknown";
  }

  let customerId = mandateCustomerCache.get(mandateId);

  if (!customerId) {
    const mandateData = await fetchGoCardless(
      `/mandates/${mandateId}`,
      accessToken
    );

    customerId = mandateData.mandates?.links?.customer || "";

    if (customerId) {
      mandateCustomerCache.set(mandateId, customerId);
    }
  }

  if (!customerId) {
    return "Unknown";
  }

  const cachedCustomerName = customerCache.get(customerId);

  if (cachedCustomerName) {
    return cachedCustomerName;
  }

let customerData: any;

try {
  customerData = await fetchGoCardless(
    `/customers/${customerId}`,
    accessToken
  );
} catch (error: any) {
  const message = String(error?.message || "").toLowerCase();

  if (message.includes("customer data has been removed")) {
    return "Customer data removed";
  }

  throw error;
}

  const customer = customerData.customers || {};

  const customerName =
    String(customer.company_name || "").trim() ||
    `${customer.given_name || ""} ${customer.family_name || ""}`.trim() ||
    String(customer.email || "").trim() ||
    "Unknown";

  customerCache.set(customerId, customerName);

  return customerName;
}

export async function GET(request: Request) {
  try {
    const now = new Date();

    const { searchParams } = new URL(request.url);

    const requestedYear = Number(searchParams.get("year"));
    const requestedMonth = Number(searchParams.get("month"));

    const selectedYear =
      Number.isInteger(requestedYear) && requestedYear >= 2020
        ? requestedYear
        : now.getFullYear();

    const selectedMonth =
      Number.isInteger(requestedMonth) &&
      requestedMonth >= 1 &&
      requestedMonth <= 12
        ? requestedMonth
        : now.getMonth() + 1;

    const startOfMonth = new Date(
      selectedYear,
      selectedMonth - 1,
      1,
      0,
      0,
      0
    );

    const startOfNextMonth = new Date(
      selectedYear,
      selectedMonth,
      1,
      0,
      0,
      0
    );

    const startUnix = Math.floor(startOfMonth.getTime() / 1000);
    const endUnix = Math.floor(startOfNextMonth.getTime() / 1000);

    /*
     * GAMMA PAY
     *
     * This is the existing working Stripe history.
     * The payment filters and calculations below remain unchanged.
     */
const charges = await stripe.charges.list({
  created: {
    gte: startUnix,
    lt: endUnix,
  },
  limit: 100,
  expand: ["data.balance_transaction", "data.payment_intent"],
});

    const gammaPayRows = charges.data
      .filter((charge) => charge.paid && !charge.refunded)
      .map((charge) => {
        const paymentIntent =
          typeof charge.payment_intent === "string"
            ? null
            : charge.payment_intent;

        const metadata = paymentIntent?.metadata || charge.metadata || {};
        const paymentRoute = metadata.paymentRoute;

        if (
          paymentRoute !== "machine_01" &&
          paymentRoute !== "office_moto"
        ) {
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
          provider: "Gamma Pay",
          providerKey: "gamma_pay",
          jobNumber: metadata.jobNumber || "",
          chargeDate: formatDateFromUnix(charge.created),
          route: routeLabel(paymentRoute),
          gross: pounds(gross),
          fee: pounds(fee),
          net: pounds(net),
          payoutDate: balanceTransaction?.available_on
            ? formatDateFromUnix(balanceTransaction.available_on)
            : "Pending",
          status: "Paid",
          paymentReference: charge.payment_intent
            ? String(
                typeof charge.payment_intent === "string"
                  ? charge.payment_intent
                  : charge.payment_intent.id
              ).slice(-8)
            : charge.id.slice(-8),
        };
      })
      .filter(Boolean);

      /*
 * SERVICEM8 PAY
 *
 * Read-only history import.
 */
const serviceM8ApiKey = process.env.SERVICEM8_API_KEY;

let serviceM8Rows: any[] = [];

if (serviceM8ApiKey) {
  const startDateTime = serviceM8DateTime(startOfMonth);
  const endDateTime = serviceM8DateTime(startOfNextMonth);

  const paymentFilter = encodeURIComponent(
    [
      "active eq 1",
      "method eq 'ServiceM8 Pay'",
      `timestamp gt '${startDateTime}'`,
      `timestamp lt '${endDateTime}'`,
    ].join(" and ")
  );

  const serviceM8Payments = await serviceM8Get(
    `jobpayment.json?$filter=${paymentFilter}`,
    serviceM8ApiKey
  );

  const matchingPayments = Array.isArray(serviceM8Payments)
    ? serviceM8Payments
    : [];
    const jobNumberCache = new Map<string, string>();

await Promise.all(
  matchingPayments.map(async (payment: any) => {
    const jobUuid = String(payment.job_uuid || "").trim();

    if (!jobUuid || jobNumberCache.has(jobUuid)) {
      return;
    }

    try {
      const job = await serviceM8Get(
        `job/${jobUuid}.json`,
        serviceM8ApiKey
      );

      jobNumberCache.set(
        jobUuid,
        String(job.generated_job_id || "").trim()
      );
    } catch (error) {
      console.error(
        `ServiceM8 job lookup failed for ${jobUuid}:`,
        error
      );

      jobNumberCache.set(jobUuid, "");
    }
  })
);
serviceM8Rows = matchingPayments.map((payment: any) => {
  const jobUuid = String(payment.job_uuid || "").trim();
  const amount = serviceM8Pounds(payment.amount);

  return {
    provider: "ServiceM8 Pay",
    providerKey: "servicem8_pay",
    jobNumber:
      jobNumberCache.get(jobUuid) ||
      jobUuid.slice(-8) ||
      "Unknown",
    chargeDate: formatDateFromString(payment.timestamp),
    route:
      Number(payment.is_deposit) === 1
        ? "Deposit"
        : "Online Payment",
    gross: amount,
    fee: estimateServiceM8Fee(amount),
    net: estimateServiceM8Net(amount),
    payoutDate: estimateNextBusinessDay(payment.timestamp),
    status: "Paid",
    paymentReference: String(payment.uuid || "").slice(-8),
  };
});
}

    const goCardlessAccessToken =
      process.env.GOCARDLESS_ACCESS_TOKEN;

    let goCardlessRows: any[] = [];

    if (goCardlessAccessToken) {
      const startDate = [
        startOfMonth.getFullYear(),
        String(startOfMonth.getMonth() + 1).padStart(2, "0"),
        "01",
      ].join("-");

      const endDate = [
  startOfNextMonth.getFullYear(),
  String(startOfNextMonth.getMonth() + 1).padStart(2, "0"),
  "01",
].join("-");

const goCardlessPayments =
  await getAllGoCardlessPayments(
    goCardlessAccessToken,
    startDate,
    endDate
  );

const customerCache = new Map<string, string>();
const mandateCustomerCache = new Map<string, string>();
const payoutCache = new Map<string, string>();

goCardlessRows = await Promise.all(
  goCardlessPayments.map(async (payment: any) => {
          const jobNumber = String(
            payment.metadata?.jobNumber || ""
          ).trim();

          const customerName =
  await getGoCardlessCustomerName(
    payment,
    goCardlessAccessToken,
    customerCache,
    mandateCustomerCache
  );

const actualPayoutDate =
  await getGoCardlessPayoutDate(
    payment,
    goCardlessAccessToken,
    payoutCache
  );

const reference =
  jobNumber || customerName || "Unknown";

          return {
            provider: "GoCardless",
            providerKey: "gocardless",
            jobNumber: reference,
            chargeDate: formatDateFromString(
              payment.charge_date || payment.created_at
            ),
            route: "Direct Debit",
            gross: pounds(payment.amount),
            fee: estimateGoCardlessFee(payment.amount),
            net: estimateGoCardlessNet(payment.amount),
            payoutDate:
  actualPayoutDate ||
  (payment.status === "confirmed"
    ? "Available"
    : payment.status === "paid_out"
      ? "Paid out"
      : "Pending"),
            status: payment.status || "Unknown",
            paymentReference: String(
              payment.id || ""
            ).slice(-8),
          };
        })
      );
    } else {
      console.warn(
        "GOCARDLESS_ACCESS_TOKEN is missing. GoCardless history was skipped."
      );
    }

    const rows = [
      ...gammaPayRows,
      ...serviceM8Rows,
      ...goCardlessRows,
    ];

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
      month: startOfMonth.toLocaleDateString("en-GB", {
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
        error:
          error.message ||
          "Could not load payment history",
      },
      { status: 500 }
    );
  }
}