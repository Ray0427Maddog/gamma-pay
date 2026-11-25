import { NextResponse } from "next/server";
import {
  GC_BASE,
  HeatCoverPlan,
  heatCoverMonthlyPence,
  packTerms,
  gcHeaders,
  cleanPhone,
  sendTextMagicSms,
  getNeoUInstallPrice,
} from "@/lib/heatcover";

// HeatCover+ sign-up via GoCardless HOSTED page (no £150 add-on needed).
// Gamma Pay never sees bank details: GoCardless collects them.
//
// 1. Create a Billing Request (Bacs mandate) carrying the plan in metadata
// 2. Create a Billing Request Flow -> GoCardless gives a secure link
// 3. Text the link to the customer with TextMagic
// The webhook creates the monthly subscription once the customer completes it.

function getFirstCollectionDate(paymentDay: number) {
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const minimumDate = new Date(today);
  minimumDate.setUTCDate(minimumDate.getUTCDate() + 7);

  let candidate = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), paymentDay)
  );
  if (candidate < minimumDate) {
    candidate = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, paymentDay)
    );
  }
  return candidate.toISOString().slice(0, 10);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      paymentDay,
      sendSms,
      neoU,
    } = body;

    // ---------- VALIDATION ----------
    if (typeof signupId !== "string" || !UUID_RE.test(signupId)) {
      return NextResponse.json(
        { success: false, error: "Invalid HeatCover+ signup ID" },
        { status: 400 }
      );
    }

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
        { success: false, error: "Missing customer details" },
        { status: 400 }
      );
    }

    if (!["v1", "v2", "v3", "v4"].includes(plan)) {
      return NextResponse.json(
        { success: false, error: "Invalid HeatCover+ plan" },
        { status: 400 }
      );
    }

    if (plan === "v3" && excessFree === true) {
      return NextResponse.json(
        { success: false, error: "V3 does not support Excess Free" },
        { status: 400 }
      );
    }

    if (plan !== "v3" && typeof excessFree !== "boolean") {
      return NextResponse.json(
        { success: false, error: "Invalid excess option" },
        { status: 400 }
      );
    }

    if (!Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 28) {
      return NextResponse.json(
        { success: false, error: "Invalid payment day" },
        { status: 400 }
      );
    }

    if (neoU === true && plan !== "v4") {
      return NextResponse.json(
        { success: false, error: "Neo U is only available on V4" },
        { status: 400 }
      );
    }
    const withNeoU = plan === "v4" && neoU === true;

    // Neo U installation fee: read live from the website shop and
    // collected by Direct Debit with the first monthly payment.
    let neoUInstallPence = 0;
    if (withNeoU) {
      try {
        neoUInstallPence = (await getNeoUInstallPrice()).pricePence;
      } catch {
        return NextResponse.json(
          {
            success: false,
            error:
              "Couldn't read the Neo U installation price from the website. Try again in a minute.",
          },
          { status: 502 }
        );
      }
    }

    const accessToken = process.env.HEATCOVER_GOCARDLESS_ACCESS_TOKEN;
    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: "Missing GoCardless token" },
        { status: 500 }
      );
    }

    const isExcessFree = plan !== "v3" && excessFree === true;
    const monthlyAmountPence = heatCoverMonthlyPence(
      plan as HeatCoverPlan,
      isExcessFree,
      withNeoU
    );
    const firstCollectionDate = getFirstCollectionDate(paymentDay);

    // Max 3 metadata keys allowed by GoCardless.
    const metadata = {
      heatcover_signup_id: signupId,
      heatcover_plan: String(plan),
      heatcover_terms: packTerms({
        excessFree: isExcessFree,
        amountPence: monthlyAmountPence,
        paymentDay,
        firstCollectionDate,
        neoU: withNeoU,
        neoUInstallPence,
      }),
    };

    // ---------- 1. BILLING REQUEST ----------
    const brRes = await fetch(`${GC_BASE}/billing_requests`, {
      method: "POST",
      headers: gcHeaders(accessToken, `hc-${signupId}-br`),
      body: JSON.stringify({
        billing_requests: {
          mandate_request: {
            scheme: "bacs",
            currency: "GBP",
            // Shown to the customer on the GoCardless page
            description: `HeatCover+ ${String(plan).toUpperCase()}${
              isExcessFree ? " Excess Free" : ""
            }${withNeoU ? " + Neo U" : ""} - £${(monthlyAmountPence / 100).toFixed(2)} per month, taken on the ${paymentDay}${
              [1, 21].includes(paymentDay)
                ? "st"
                : [2, 22].includes(paymentDay)
                ? "nd"
                : [3, 23].includes(paymentDay)
                ? "rd"
                : "th"
            }${
              withNeoU
                ? `, plus £${(neoUInstallPence / 100).toFixed(2)} Neo U installation taken with the first payment`
                : ""
            }`,
            metadata,
          },
          metadata,
        },
      }),
    });

    const brData = await brRes.json().catch(() => ({}));

    if (!brRes.ok) {
      console.error("GoCardless billing request failed:", {
        status: brRes.status,
        error: brData?.error,
      });
      return NextResponse.json(
        {
          success: false,
          error:
            brData?.error?.message || "Could not create GoCardless request",
          details: brData?.error?.errors,
        },
        { status: brRes.status }
      );
    }

    const billingRequestId = brData.billing_requests?.id;
    if (!billingRequestId) {
      return NextResponse.json(
        { success: false, error: "GoCardless returned no request ID" },
        { status: 500 }
      );
    }

    // ---------- 2. HOSTED LINK ----------
    const flowRes = await fetch(`${GC_BASE}/billing_request_flows`, {
      method: "POST",
      headers: gcHeaders(accessToken),
      body: JSON.stringify({
        billing_request_flows: {
          prefilled_customer: {
            given_name: firstName.trim(),
            family_name: lastName.trim(),
            email: email.trim(),
            phone_number: phone.trim(),
            address_line1: address.trim(),
            city: city.trim(),
            postal_code: postcode.trim().toUpperCase(),
            country_code: "GB",
          },
          lock_customer_details: false,
          lock_bank_account: false,
          links: { billing_request: billingRequestId },
        },
      }),
    });

    const flowData = await flowRes.json().catch(() => ({}));

    if (!flowRes.ok) {
      console.error("GoCardless flow failed:", {
        status: flowRes.status,
        error: flowData?.error,
      });
      return NextResponse.json(
        {
          success: false,
          error:
            flowData?.error?.message || "Could not create GoCardless link",
        },
        { status: flowRes.status }
      );
    }

    const authorisationUrl = flowData.billing_request_flows?.authorisation_url;
    if (!authorisationUrl) {
      return NextResponse.json(
        { success: false, error: "GoCardless returned no link" },
        { status: 500 }
      );
    }

    // ---------- 3. TEXT THE LINK ----------
    let smsSentTo: string | null = null;
    let smsError: string | null = null;

    if (sendSms !== false) {
      const pounds = (monthlyAmountPence / 100).toFixed(2);
      const smsText =
        `Gamma Heating: Hi ${firstName.trim()}, please set up your ` +
        `HeatCover+ ${String(plan).toUpperCase()}${withNeoU ? " + Neo U" : ""} Direct Debit ` +
        `(£${pounds}/month${
          withNeoU
            ? ` + £${(neoUInstallPence / 100).toFixed(2)} installation with the first payment`
            : ""
        }) securely with GoCardless here: ${authorisationUrl}`;

      try {
        smsSentTo = cleanPhone(phone);
        await sendTextMagicSms(smsSentTo, smsText);
      } catch (err: any) {
        // The link still works; staff can read it out / copy it.
        smsError = err?.message || "SMS failed";
        smsSentTo = null;
        console.error("HeatCover link SMS failed:", smsError);
      }
    }

    return NextResponse.json({
      success: true,
      billingRequestId,
      authorisationUrl,
      smsSentTo,
      smsError,
      plan,
      monthlyAmountPence,
      neoUInstallPence,
      paymentDay,
      firstCollectionDate,
    });
  } catch (err: any) {
    console.error("HeatCover link route error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "HeatCover+ link failed" },
      { status: 500 }
    );
  }
}
