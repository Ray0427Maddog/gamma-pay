'use client'

import { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  CardElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);

type PaymentRoute = "office" | "machine_01" | "paypal";

type JobResult = {
  uuid: string;
  jobNumber: string;
  customer: string;
  customerEmail?: string;
  customerPhone?: string;
  address: string;
  status: string;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  isFullyPaid: boolean;
  raw?: {
    total_invoice_amount?: string;
    job_description?: string;
  };
};

function HomeContent() {
  const stripe = useStripe();
  const elements = useElements();
  const [jobNumber, setJobNumber] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [job, setJob] = useState<JobResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [success, setSuccess] = useState(false);
  const [markComplete, setMarkComplete] = useState(false);
  const [showHeatCoverSignup, setShowHeatCoverSignup] = useState(false);
  const [hcStep, setHcStep] = useState<
  "customer" | "plan" | "script" | "terms"
>("customer");

  const [hcPlan, setHcPlan] = useState<
  "v1" | "v2" | "v3" | "v4" | ""
  >("");

  const [hcExcessFree, setHcExcessFree] = useState<boolean | null>(null);
  const [hcFirstName, setHcFirstName] = useState("");
  const [hcLastName, setHcLastName] = useState("");
  const [hcEmail, setHcEmail] = useState("");
  const [hcPhone, setHcPhone] = useState("");
  const [hcAddress, setHcAddress] = useState("");
  const [hcPostcode, setHcPostcode] = useState("");

  const [machineStatus, setMachineStatus] = useState<
  "idle" | "waiting" | "success"
>("idle");

const [readerStatus, setReaderStatus] = useState<
  "checking" | "connected" | "in_progress" | "not_connected"
>("checking");

const [gcMatches, setGcMatches] = useState<any[]>([]);
const [gcLoading, setGcLoading] = useState(false);
const [gcError, setGcError] = useState("");
const [gcCharging, setGcCharging] = useState(false);
const [gcSuccess, setGcSuccess] = useState("");
const [gcSearched, setGcSearched] = useState(false);
const [selectedGcCustomer, setSelectedGcCustomer] = useState<any | null>(null);
const [gcAlreadyCharged, setGcAlreadyCharged] = useState(false);

  // NEW: where payment should be taken
  const [paymentRoute, setPaymentRoute] = useState<PaymentRoute>("office");

  const [showHistory, setShowHistory] = useState(false);
const [historyLoading, setHistoryLoading] = useState(false);
const [historyData, setHistoryData] = useState<any>(null);

const [historyDate, setHistoryDate] = useState(() => {
  const now = new Date();

  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  };
});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSuccess(params.get("success") === "true");
  }, []);

  useEffect(() => {
  async function checkReaderStatus() {
    try {
      const res = await fetch("/api/reader-status");
      const data = await res.json();

      setReaderStatus(
        data.status === "connected" ? "connected" : "not_connected"
      );
    } catch {
      setReaderStatus("not_connected");
    }
  }

  checkReaderStatus();

  const interval = setInterval(checkReaderStatus, 30000);

  return () => clearInterval(interval);
}, []);

  const totalAmount = Number(job?.totalAmount || 0);
  const paidAmount = Number(job?.paidAmount || 0);
  const outstandingAmount = Number(job?.outstandingAmount || 0);

const isGcMode = Boolean(selectedGcCustomer);

const amountToCharge = isGcMode
  ? 55
  : outstandingAmount > 0
  ? outstandingAmount
  : Number(manualAmount || 0);

  const isPaid = Boolean(job?.isFullyPaid);

  async function findJob(showAlerts = true) {
    if (!jobNumber.trim()) {
      if (showAlerts) alert("Enter a ServiceM8 job number");
      return;
    }

    setLoading(true);
    setJob(null);

    try {
      const res = await fetch(
        `/api/servicem8/job?jobNumber=${encodeURIComponent(jobNumber)}`
      );

      const data = await res.json();

      if (!res.ok) {
        if (showAlerts) alert(data.error || "Job not found");
        return;
      }

      setJob(data);
    } catch (err) {
      console.error(err);
      if (showAlerts) alert("Could not look up ServiceM8 job");
    } finally {
      setLoading(false);
    }
  }

async function searchGoCardless() {
  setGcLoading(true);
  setGcError("");
  setGcSuccess("");
  setGcMatches([]);
  setGcSearched(false);
  setSelectedGcCustomer(null);

  if (!job?.customerEmail) {
    setGcError("No customer email found on this job");
    setGcLoading(false);
    return;
  }

  try {
    const res = await fetch(
      `/api/gocardless/search?query=${encodeURIComponent(job.customerEmail)}`
    );

    const data = await res.json();

    if (!res.ok || data.success === false) {
      setGcError(data.error || "Search failed");
      return;
    }

    setGcMatches(data.matches || []);
    setGcSearched(true);
  } catch (err) {
    console.error(err);
    setGcError("Could not search GoCardless");
  } finally {
    setGcLoading(false);
  }
}
async function chargeGoCardlessExcess(customer: any) {
  if (!job) return;

  if (!customer.hasActiveMandate || !customer.activeMandateId) {
    setGcError("This customer does not have an active GoCardless mandate");
    return;
  }

  setGcCharging(true);
  setGcError("");
  setGcSuccess("");

  try {
    const res = await fetch("/api/gocardless/charge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mandateId: customer.activeMandateId,
        jobNumber: job.jobNumber,
        jobUuid: job.uuid,
        customerName: `${customer.given_name || ""} ${customer.family_name || ""}`.trim(),
      }),
    });

    const data = await res.json();

    if (!res.ok || data.success === false) {
      setGcError(data.error || "Could not create GoCardless payment");
      return;
    }

    setGcSuccess(
      `£55 HeatCover+ excess requested. GoCardless payment ${data.paymentId || ""}`
    );
    setGcAlreadyCharged(true);
  } catch (err) {
    console.error(err);
    setGcError("Could not create GoCardless payment");
  } finally {
    setGcCharging(false);
  }
}
  async function ensureJobLoaded(): Promise<JobResult | null> {
  if (job?.uuid) return job;

  try {
    const res = await fetch(
      `/api/servicem8/job?jobNumber=${encodeURIComponent(jobNumber)}`
    );

    const data = await res.json();

    if (!res.ok || !data?.uuid) {
      alert(data?.error || "Job not found");
      return null;
    }

    setJob(data);
    return data;
  } catch (err) {
    console.error(err);
    alert("Could not fetch job");
    return null;
  }
}

async function chargeCard() {
    if (selectedGcCustomer) {
    await chargeGoCardlessExcess(selectedGcCustomer);
    return;
  }
  if (!jobNumber.trim() || !amountToCharge || amountToCharge <= 0) {
    alert("Enter job number and amount");
    return;
  }

  if (isPaid) {
    alert("This job appears to be fully paid already");
    return;
  }

try {
  setProcessingPayment(true);

  const jobForPayment = await ensureJobLoaded();

  if (!jobForPayment?.uuid) {
    return;
  }

  const chargeAmount =
    Number(manualAmount || 0) > 0
      ? Number(manualAmount)
      : Number(jobForPayment.outstandingAmount || 0);

  if (!chargeAmount || chargeAmount <= 0) {
    alert("Enter an amount to charge");
    return;
  }

const endpoint =
  paymentRoute === "machine_01"
    ? "/api/terminal/charge"
    : paymentRoute === "paypal"
    ? "/api/paypal/send-sms"
    : "/api/moto/charge";

        if (paymentRoute === "machine_01") {
  setMachineStatus("waiting");
}
  setReaderStatus("in_progress");

  let paymentMethodId = "";

if (paymentRoute === "office") {
  if (!stripe || !elements) {
    alert("Stripe is still loading. Please try again.");
    return;
  }

  const cardElement = elements.getElement(CardElement);

  if (!cardElement) {
    alert("Card form not ready");
    return;
  }

  const result = await stripe.createPaymentMethod({
    type: "card",
    card: cardElement,
  });

  if (result.error) {
    alert(result.error.message || "Card details could not be processed");
    return;
  }

  paymentMethodId = result.paymentMethod.id;
}

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jobNumber: jobForPayment.jobNumber || jobNumber,
        jobUuid: jobForPayment.uuid,
        amount: Math.round(chargeAmount * 100),
        markComplete,
        paymentRoute,
        customerName: jobForPayment.customer || "",
        address: jobForPayment.address || "",
        customerEmail: "",
        customerPhone: jobForPayment.customerPhone || "",
        paymentMethodId,
      }),
    });

    const data = await res.json();
    const paymentIntentId = data.paymentIntentId;

if (!res.ok || data.success === false) {
  console.error("Payment route error:", data);
  alert(data.error || data.message || "Could not start payment");
  return;
}

if (paymentRoute === "machine_01") {
  if (!paymentIntentId) {
    alert("Missing payment reference from Stripe");
    return;
  }

  setMachineStatus("waiting");

  const interval = setInterval(async () => {
    try {
      const res = await fetch(
        `/api/terminal/status?paymentIntentId=${paymentIntentId}`
      );
      const statusData = await res.json();

      if (!res.ok || statusData.success === false) {
        console.error("Status check failed", statusData);
        return;
      }

      const status = statusData.status;

      if (status === "succeeded") {
        clearInterval(interval);

        await findJob(false);
        setMachineStatus("success");
        setManualAmount("");
        setReaderStatus("connected");

        setTimeout(() => {
          setMachineStatus("idle");
        }, 5000);
      }

      if (status === "canceled") {
        clearInterval(interval);
        setMachineStatus("idle");
        alert("Payment cancelled on terminal");
      }
      setReaderStatus("not_connected");

    } catch (err) {
      console.error("Polling error", err);
    }
  }, 3000);

  return;
}

if (paymentRoute === "paypal" && data.success) {
  alert(data.message || "PayPal payment link sent by SMS");
  return;
}

if (paymentRoute === "office" && data.success) {
  alert("Payment successful — ServiceM8 update will follow shortly");
  await findJob(false);
  setManualAmount("");
  setProcessingPayment(false);
  return;
}

if (data.url) {
  window.location.href = data.url;
} else {
  alert(data.error || data.message || "Could not start payment");
}
} catch (err) {
  console.error(err);
  setReaderStatus("not_connected");
  alert("Could not start payment");
} finally {
  setProcessingPayment(false);
 }
}
async function loadHistory(
  year = historyDate.year,
  month = historyDate.month
) {
  try {
    setHistoryLoading(true);

    const res = await fetch(
      `/api/history?year=${year}&month=${month}`
    );

    const data = await res.json();

    if (!res.ok || data.success === false) {
      alert(data.error || "Could not load history");
      return;
    }

    setHistoryDate({
  year,
  month,
});

setHistoryData(data);
setShowHistory(true);
  } catch (err) {
    console.error(err);
    alert("Could not load history");
  } finally {
    setHistoryLoading(false);
  }
}

function changeHistoryMonth(direction: -1 | 1) {
  const nextDate = new Date(
    historyDate.year,
    historyDate.month - 1 + direction,
    1
  );

  const nextYear = nextDate.getFullYear();
  const nextMonth = nextDate.getMonth() + 1;

  loadHistory(nextYear, nextMonth);
}

function downloadHistoryCsv() {
  if (!historyData || !historyData.rows || historyData.rows.length === 0) {
    return;
  }

  const headers: string[] = [
    "Job Number",
    "Charge Date",
    "Route",
    "Gross",
    "Fee",
    "Net",
    "Payout Date",
    "Stripe Reference",
  ];

  const csvRows: string[][] = historyData.rows.map((row: any) => [
    String(row.jobNumber || ""),
    String(row.chargeDate || ""),
    String(row.route || ""),
    String(row.gross || ""),
    String(row.fee || ""),
    String(row.net || ""),
    String(row.payoutDate || ""),
    String(row.paymentReference || ""),
  ]);

  const csv = [headers, ...csvRows]
    .map((line: string[]) =>
      line.map((cell: string) => `"${cell.replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `gamma-pay-${String(historyData.month || "history").replace(/\s+/g, "-")}.csv`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}
const groupedHistory = historyData?.rows?.reduce(
  (
    providers: Record<
      string,
      {
        providerName: string;
        payouts: Record<string, any[]>;
      }
    >,
    row: any
  ) => {
    const providerKey = row.providerKey || "other";
    const providerName = row.provider || "Other";
    const payoutKey = row.payoutDate || "Pending";

    if (!providers[providerKey]) {
      providers[providerKey] = {
        providerName,
        payouts: {},
      };
    }

    if (!providers[providerKey].payouts[payoutKey]) {
      providers[providerKey].payouts[payoutKey] = [];
    }

    providers[providerKey].payouts[payoutKey].push(row);

    return providers;
  },
  {}
);

const now = new Date();

const isCurrentHistoryMonth =
  historyDate.year === now.getFullYear() &&
  historyDate.month === now.getMonth() + 1;

  if (showHeatCoverSignup) {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center p-6">
      <div className="w-full max-w-md">

        <div className="relative mb-8">
          <button
            type="button"
            onClick={() => setShowHeatCoverSignup(false)}
            className="absolute left-0 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
          >
            ← Back
          </button>

          <h1 className="text-3xl font-bold text-pink-500 text-center">
            HeatCover+
          </h1>
        </div>

        <div className="p-6 rounded-xl bg-zinc-900 border border-zinc-700">
          <h2 className="text-xl font-bold mb-2">
            Add HeatCover+ Customer
          </h2>

          <p className="text-zinc-400">
            New customer signup
          </p>
          {hcStep === "customer" && (
          <div className="mt-6 space-y-4">

  <div className="grid grid-cols-2 gap-3">
    <input
      type="text"
      placeholder="First name"
      value={hcFirstName}
      onChange={(e) => setHcFirstName(e.target.value)}
      className="w-full p-4 rounded-xl bg-black border border-zinc-700"
    />

    <input
      type="text"
      placeholder="Last name"
      value={hcLastName}
      onChange={(e) => setHcLastName(e.target.value)}
      className="w-full p-4 rounded-xl bg-black border border-zinc-700"
    />
  </div>

  <input
    type="email"
    placeholder="Email address"
    value={hcEmail}
    onChange={(e) => setHcEmail(e.target.value)}
    className="w-full p-4 rounded-xl bg-black border border-zinc-700"
  />

  <input
    type="tel"
    placeholder="Phone number"
    value={hcPhone}
    onChange={(e) => setHcPhone(e.target.value)}
    className="w-full p-4 rounded-xl bg-black border border-zinc-700"
  />

  <textarea
    placeholder="Address"
    value={hcAddress}
    onChange={(e) => setHcAddress(e.target.value)}
    rows={3}
    className="w-full p-4 rounded-xl bg-black border border-zinc-700 resize-none"
  />

  <input
    type="text"
    placeholder="Postcode"
    value={hcPostcode}
    onChange={(e) => setHcPostcode(e.target.value)}
    className="w-full p-4 rounded-xl bg-black border border-zinc-700"
  />

  <button
  type="button"
  onClick={() => {
    if (
      !hcFirstName.trim() ||
      !hcLastName.trim() ||
      !hcEmail.trim() ||
      !hcPhone.trim() ||
      !hcAddress.trim() ||
      !hcPostcode.trim()
    ) {
      alert("Please complete all customer details");
      return;
    }

    setHcStep("plan");
  }}
  className="w-full p-4 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 font-bold"
>
  Continue
</button>

</div>
)}

{hcStep === "plan" && (
  <div className="mt-6 space-y-4">

    <div>
      <h3 className="text-lg font-bold">
        Select HeatCover+ Plan
      </h3>
      <p className="text-sm text-zinc-400 mt-1">
        Choose the plan agreed with the customer.
      </p>
    </div>

{[
  {
    id: "v1",
    name: "V1 — Gas",
    description: "Boiler, heating & plumbing",
    priceLabel: "£27/mo",
    disabled: false,
  },
  {
    id: "v1int",
    name: "V1 INT — Instant Cover",
    description: "Existing faults covered — INTERNAL",
    priceLabel: "£149 upfront",
    disabled: true,
  },
  {
    id: "v2",
    name: "V2 — Boiler & Heating",
    description: "Boiler & heating cover — no plumbing",
    priceLabel: "£18/mo",
    disabled: false,
  },
  {
    id: "v3",
    name: "V3 — Service Only",
    description: "Servicing / gas safety only",
    priceLabel: "£12/mo",
    disabled: false,
  },
  {
    id: "v4",
    name: "V4 — Oil",
    description: "Oil boiler, heating & plumbing",
    priceLabel: "£38/mo",
    disabled: false,
  },
  {
    id: "v4int",
    name: "V4 INT — Instant Cover",
    description: "Existing faults covered — INTERNAL",
    priceLabel: "£249 upfront",
    disabled: true,
  },
].map((plan) => (
      <button
        key={plan.id}
        type="button"
        disabled={plan.disabled}
        onClick={() => {
        setHcPlan(plan.id as "v1" | "v2" | "v3" | "v4");
        setHcExcessFree(null);
       }}
        className={`w-full p-4 rounded-xl border text-left ${
  plan.disabled
    ? "bg-zinc-800 border-zinc-700 opacity-50 cursor-not-allowed"
    : hcPlan === plan.id
    ? "bg-purple-600 border-pink-500"
    : "bg-black border-zinc-700"
}`}
      >
        <div className="flex justify-between items-center gap-4">
          <div>
            <p className="font-bold">{plan.name}</p>
            <p className="text-sm text-zinc-400">
              {plan.description}
            </p>
          </div>

          <p className="font-bold whitespace-nowrap">
  {plan.priceLabel}
</p>
        </div>
      </button>
    ))}

{hcPlan && hcPlan !== "v3" && (
  <div className="p-4 rounded-xl bg-black border border-zinc-700 space-y-3">

    {(hcPlan === "v1" || hcPlan === "v2" || hcPlan === "v4") && (
      <div className="p-3 rounded-lg bg-yellow-900/40 border border-yellow-700">
        <p className="text-sm font-bold text-yellow-400">
          ASK CUSTOMER
        </p>
        <p className="text-sm mt-1">
  Would you like to make your plan Excess Free for an additional £11 per month?
  This means you will not have to pay the £55 excess if you make a breakdown claim.
</p>
      </div>
    )}

    <div>
      <p className="font-bold">Excess Option</p>
      <p className="text-sm text-zinc-400">
        Select the customer's chosen excess.
      </p>
    </div>

    <button
  type="button"
  onClick={() => setHcExcessFree(false)}
  className={`w-full p-4 rounded-xl border text-left ${
    hcExcessFree === false
      ? "bg-purple-600 border-pink-500"
      : "bg-zinc-900 border-zinc-700"
  }`}
>
      <div className="flex justify-between">
        <div>
          <p className="font-bold">£55 Excess</p>
          <p className="text-sm text-zinc-400">
            Standard plan
          </p>
        </div>

        <span className="font-bold">Included</span>
      </div>
    </button>

    <button
      type="button"
      onClick={() => setHcExcessFree(true)}
      className={`w-full p-4 rounded-xl border text-left ${
        hcExcessFree === true
          ? "bg-purple-600 border-pink-500"
          : "bg-zinc-900 border-zinc-700"
      }`}
    >
      <div className="flex justify-between">
        <div>
          <p className="font-bold">Excess Free</p>
          <p className="text-sm text-zinc-400">
            No £55 excess
          </p>
        </div>

        <span className="font-bold">+£11/mo</span>
      </div>
    </button>

  </div>
)}
{hcPlan && (
  <div className="p-4 rounded-xl bg-zinc-800 border border-zinc-700">
    <p className="text-sm text-zinc-400">
      Monthly payment
    </p>

    <p className="text-3xl font-bold text-pink-500">
      £
      {(
        (hcPlan === "v1"
          ? 27
          : hcPlan === "v2"
          ? 18
          : hcPlan === "v3"
          ? 12
          : 38) +
        (hcExcessFree === true ? 11 : 0)
      ).toFixed(2)}
    </p>

    {hcExcessFree === true && (
      <p className="text-sm text-zinc-400 mt-1">
        Excess Free included
      </p>
    )}
  </div>
)}

<div className="flex gap-3 pt-2">
  <button
    type="button"
    onClick={() => {
      setHcStep("customer");
      setHcPlan("");
      setHcExcessFree(null);
    }}
    className="w-1/3 p-4 rounded-xl bg-zinc-700 font-bold"
  >
    Back
  </button>

  <button
    type="button"
    onClick={() => setHcStep("script")}
    disabled={
      !hcPlan ||
      (hcPlan !== "v3" && hcExcessFree === null)
    }
    className="w-2/3 p-4 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 font-bold disabled:opacity-40 disabled:cursor-not-allowed"
  >
    Continue
  </button>
</div>
  </div>
)}
{/* SCRIPT SCREEN STARTS HERE */}
{hcStep === "script" && (
  <div className="mt-6 space-y-4">

    <div>
      <h3 className="text-lg font-bold">
        Confirm Plan With Customer
      </h3>

      <p className="text-sm text-zinc-400 mt-1">
        Read the following information to the customer.
      </p>
    </div>

    <div className="p-4 rounded-xl bg-zinc-800 border border-zinc-700">
      <div className="flex justify-between items-center">
        <div>
          <p className="font-bold">
            {hcPlan === "v1"
              ? "V1 — Gas"
              : hcPlan === "v2"
              ? "V2 — Boiler & Heating"
              : hcPlan === "v3"
              ? "V3 — Service Only"
              : "V4 — Oil"}
          </p>

          {hcPlan !== "v3" && (
            <p className="text-sm text-zinc-400 mt-1">
              {hcExcessFree === true
                ? "Excess Free"
                : "£55 excess applies to breakdown claims"}
            </p>
          )}
        </div>

        <p className="font-bold text-pink-500">
          £
          {(
            (hcPlan === "v1"
              ? 27
              : hcPlan === "v2"
              ? 18
              : hcPlan === "v3"
              ? 12
              : 38) +
            (hcExcessFree === true ? 11 : 0)
          ).toFixed(2)}
          /mo
        </p>
      </div>
    </div>

    <div className="p-4 rounded-xl bg-yellow-900/40 border border-yellow-700">
      <p className="text-sm font-bold text-yellow-400 mb-3">
        READ TO CUSTOMER
      </p>

      {hcPlan === "v1" && (
  <p>
    Your HeatCover+ V1 plan covers your gas boiler, central heating
    system, gas pipework, drains and plumbing. It also includes your
    annual boiler service, priority customer support, service reminders
    and access to the customer portal. Your monthly payment will be £
    {(27 + (hcExcessFree === true ? 11 : 0)).toFixed(2)}.
  </p>
)}

      {hcPlan === "v2" && (
  <p>
    Your HeatCover+ V2 plan covers your gas boiler, central heating
    system and gas pipework. It also includes your annual boiler service,
    priority customer support, service reminders and access to the
    customer portal. Please note that drains and plumbing are not covered
    under this plan. Your monthly payment will be £
    {(18 + (hcExcessFree === true ? 11 : 0)).toFixed(2)}.
  </p>
)}

      {hcPlan === "v3" && (
  <p>
    Your HeatCover+ V3 plan includes your annual boiler service,
    priority customer support, service reminders and access to the
    customer portal. A gas safety check is also included for rented
    properties. Please note that this is a service-only plan and does
    not include breakdown cover. Your monthly payment will be £12.00.
  </p>
)}

      {hcPlan === "v4" && (
  <p>
    Your HeatCover+ V4 plan covers your oil boiler, central heating
    system, oil lines, drains and plumbing. It also includes your
    annual boiler service, priority customer support, service reminders
    and access to the customer portal. A CD12 landlord oil installation
    check is also included for rented properties. Your monthly payment
    will be £
    {(38 + (hcExcessFree === true ? 11 : 0)).toFixed(2)}.
  </p>
)}

      {hcPlan !== "v3" && hcExcessFree === false && (
        <p className="mt-3">
          A £55 excess is payable if you make a breakdown claim.
        </p>
      )}

      {hcPlan !== "v3" && hcExcessFree === true && (
        <p className="mt-3">
          You have chosen Excess Free cover, so there is no £55 excess
          to pay when making a breakdown claim.
        </p>
      )}
    </div>

    <div className="flex gap-3 pt-2">
      <button
        type="button"
        onClick={() => setHcStep("plan")}
        className="w-1/3 p-4 rounded-xl bg-zinc-700 font-bold"
      >
        Back
      </button>

      <button
        type="button"
        onClick={() => setHcStep("terms")}
        className="w-2/3 p-4 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 font-bold"
      >
        Customer Agrees — Continue
      </button>
    </div>

  </div>
)}

{/* TERMS SCREEN STARTS HERE */}
{hcStep === "terms" && (
  <div className="mt-6 space-y-4">

    <div>
      <h3 className="text-lg font-bold">
        Important Plan Information
      </h3>

      <p className="text-sm text-zinc-400 mt-1">
        Read the following to the customer before continuing.
      </p>
    </div>

    <div className="p-4 rounded-xl bg-yellow-900/40 border border-yellow-700">
      <p className="text-sm font-bold text-yellow-400 mb-3">
        READ TO CUSTOMER
      </p>

      <div className="space-y-3">
        <p>
          Before we set up your HeatCover+ plan, I just need to make you
          aware of a few important points.
        </p>

        <p>
          There is a 30-day cooling-down period before breakdown cover
          becomes available.
        </p>

        <p>
          Your property and heating system will need to pass our initial
          survey before cover can be confirmed.
        </p>

        <p>
          To qualify for your included annual boiler service, the plan
          must have been active for at least five consecutive months.
        </p>

        <p>
          HeatCover+ is a monthly rolling plan and you can cancel at any
          time.
        </p>

        <p className="font-bold">
          Are you happy to continue on that basis?
        </p>
      </div>
    </div>

    <div className="flex gap-3 pt-2">
      <button
        type="button"
        onClick={() => setHcStep("script")}
        className="w-1/3 p-4 rounded-xl bg-zinc-700 font-bold"
      >
        Back
      </button>

      <button
        type="button"
        className="w-2/3 p-4 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 font-bold"
      >
        Customer Agrees — Continue
      </button>
    </div>

  </div>
)}

        </div>

      </div>
    </div>
  );
}

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
<div className="relative w-full max-w-md mb-2">
  <h1 className="text-3xl font-bold text-pink-500 text-center">
    Gamma Pay
  </h1>

  <button
  onClick={() => loadHistory()}
  disabled={historyLoading}
    className="absolute right-0 top-1/2 -translate-y-1/2 text-xl font-bold text-zinc-400 hover:text-white"
  >
    Ⓗ
  </button>
</div>

{showHistory && historyData && (
  <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-5xl w-full max-h-[90vh] overflow-auto">

      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
  <button
    type="button"
    onClick={() => changeHistoryMonth(-1)}
    disabled={historyLoading}
    className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 font-bold disabled:opacity-50"
  >
    ◀
  </button>

  <h2 className="text-xl font-bold min-w-[230px] text-center">
    Payment History - {historyData.month}
  </h2>

  <button
    type="button"
    onClick={() => changeHistoryMonth(1)}
    disabled={historyLoading || isCurrentHistoryMonth}
    className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 font-bold disabled:opacity-50"
  >
    ▶
  </button>
</div>

        <div className="flex items-center gap-3">
  <button
    onClick={downloadHistoryCsv}
    className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm font-bold"
  >
    Download CSV
  </button>

  <button
    onClick={() => setShowHistory(false)}
    className="text-zinc-400"
  >
    ✕
  </button>
</div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-black p-3 rounded">
          Gross
          <div className="font-bold">
            £{historyData.summary.gross}
          </div>
        </div>

        <div className="bg-black p-3 rounded">
          Fees
          <div className="font-bold">
            £{historyData.summary.fees}
          </div>
        </div>

        <div className="bg-black p-3 rounded">
          Net
          <div className="font-bold text-green-400">
            £{historyData.summary.net}
          </div>
        </div>
      </div>

<div className="space-y-10">
  {Object.entries(groupedHistory || {}).map(
    ([providerKey, providerGroup]: [string, any]) => (
      <div key={providerKey} className="space-y-4">
        <div className="flex items-center justify-between border-b border-zinc-700 pb-2">
          <h3 className="text-xl font-bold text-pink-500">
            {providerGroup.providerName}
          </h3>

          <span className="text-sm text-zinc-400">
            {Object.values(providerGroup.payouts).reduce(
              (count: number, rows: any) => count + rows.length,
              0
            )}{" "}
            payments
          </span>
        </div>

        <div className="space-y-6">
          {Object.entries(providerGroup.payouts).map(
            ([payoutDate, rows]: [string, any]) => {
              const payoutTotal = rows.reduce(
                (sum: number, row: any) => sum + Number(row.net),
                0
              );

              return (
                <div
                  key={`${providerKey}-${payoutDate}`}
                  className="border border-zinc-700 rounded-xl overflow-hidden"
                >
                  <div className="bg-zinc-800 p-3 flex justify-between font-bold">
                    <span>
                      {providerKey === "gamma_pay"
                        ? `Payout ${payoutDate}`
                        : `Payment status: ${payoutDate}`}
                    </span>

                    <span>£{payoutTotal.toFixed(2)}</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-zinc-700">
                          <th className="text-left p-2">Job / Customer</th>
                          <th className="text-left p-2">Date</th>
                          <th className="text-left p-2">Route</th>
                          <th className="text-left p-2">Gross</th>
                          <th className="text-left p-2">Fee</th>
                          <th className="text-left p-2">Net</th>
                        </tr>
                      </thead>

                      <tbody>
                        {rows.map((row: any, i: number) => (
                          <tr
                            key={`${row.paymentReference || i}-${i}`}
                            className="border-b border-zinc-800"
                          >
                            <td className="p-2">{row.jobNumber}</td>
                            <td className="p-2">{row.chargeDate}</td>
                            <td className="p-2">{row.route}</td>
                            <td className="p-2">£{row.gross}</td>
                            <td className="p-2">£{row.fee}</td>
                            <td className="p-2">£{row.net}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            }
          )}
        </div>
      </div>
    )
  )}
</div>

    </div>
  </div>
)}

<div className="mb-6 flex items-center gap-2 text-sm font-medium">
  <span
    className={`h-3 w-3 rounded-full ${
      readerStatus === "connected"
        ? "bg-green-500"
        : readerStatus === "in_progress" || readerStatus === "checking"
        ? "bg-yellow-400 animate-pulse"
        : "bg-red-500"
    }`}
  />

  <span>
    {readerStatus === "connected"
      ? "Reader connected"
      : readerStatus === "in_progress"
      ? "Payment in progress"
      : readerStatus === "checking"
      ? "Checking reader..."
      : "Reader not connected"}
  </span>
</div>

      {success && (
        <div className="mb-6 p-4 bg-green-600 text-white rounded-xl">
          ✅ Payment successful
        </div>
      )}

      <div className="w-full max-w-md space-y-4">

      <button
  type="button"
  onClick={() => setShowHeatCoverSignup(true)}
  className="w-full p-4 rounded-xl bg-blue-600 hover:bg-blue-500 font-bold"
>
  + Add HeatCover+ Customer
</button>

<div className="flex items-center gap-3 py-2">
  <div className="h-px flex-1 bg-zinc-700" />
  <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">
    Payments
  </span>
  <div className="h-px flex-1 bg-zinc-700" />
</div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="ServiceM8 Job Number"
            value={jobNumber}
            onChange={(e) => setJobNumber(e.target.value)}
            className="w-full p-4 rounded-xl bg-zinc-900 border border-zinc-700"
          />

          <button
            onClick={() => findJob()}
            disabled={loading}
            className="px-4 rounded-xl bg-zinc-700 font-bold disabled:opacity-50"
          >
            {loading ? "..." : "Find"}
          </button>
        </div>

        {job && (
          <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-700 space-y-2">
            <p className="text-sm text-zinc-400">Job #{job.jobNumber}</p>
            <p className="font-bold">{job.customer}</p>
            <p className="whitespace-pre-line text-sm">{job.address}</p>
            <p className="text-sm text-zinc-400">Status: {job.status}</p>

            <div className="pt-2 space-y-1">
              <p>Total: £{totalAmount.toFixed(2)}</p>
              <p>Paid: £{paidAmount.toFixed(2)}</p>
              <p className="text-2xl font-bold text-pink-500">
                Outstanding: £{outstandingAmount.toFixed(2)}
              </p>
            </div>

            {isPaid && (
              <div className="p-3 bg-green-700 rounded-xl font-bold">
                ✔ Fully paid
              </div>
            )}
          </div>
        )}

        {!isPaid && (
          <input
            type="number"
            placeholder="Manual Amount (£)"
            value={manualAmount}
            onChange={(e) => setManualAmount(e.target.value)}
            className="w-full p-4 rounded-xl bg-zinc-900 border border-zinc-700"
          />
        )}

        {/* NEW: Payment route selector */}
        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-700 space-y-3">
          <p className="font-bold">Where should this payment be taken?</p>

          <button
            type="button"
            onClick={() => setPaymentRoute("office")}
            className={`w-full p-4 rounded-xl font-bold border ${
              paymentRoute === "office"
                ? "bg-gradient-to-r from-purple-600 to-pink-500 border-pink-500"
                : "bg-black border-zinc-700"
            }`}
          >
            Office — manual card entry
          </button>

          <button
            type="button"
            onClick={() => setPaymentRoute("machine_01")}
            className={`w-full p-4 rounded-xl font-bold border ${
              paymentRoute === "machine_01"
                ? "bg-gradient-to-r from-purple-600 to-pink-500 border-pink-500"
                : "bg-black border-zinc-700"
            }`}
          >
            Ray — card reader
          </button>

<button
  type="button"
  onClick={() => setPaymentRoute("paypal")}
  className={`w-full p-4 rounded-xl font-bold border ${
    paymentRoute === "paypal"
      ? "bg-gradient-to-r from-purple-600 to-pink-500 border-pink-500"
      : "bg-black border-zinc-700"
  }`}
>
  <div className="flex items-center justify-center gap-3">
    <img
      src="https://www.paypalobjects.com/webstatic/icon/pp258.png"
      alt="PayPal"
      className="h-6"
    />
    <span>PayPal / Pay in 3</span>
  </div>
</button>

{paymentRoute === "machine_01" && machineStatus === "waiting" && (
  <div className="space-y-2">
    <p className="text-sm text-yellow-400">
      Payment will be sent to the card reader.
    </p>

    <button
      onClick={async () => {
        try {
          const res = await fetch("/api/terminal/cancel", {
            method: "POST",
          });

          const data = await res.json();

          if (!res.ok || data.success === false) {
            alert(data.error || "Could not cancel payment");
            return;
          }

          setMachineStatus("idle");
          setProcessingPayment(false);
          alert("Card machine payment cancelled");
        } catch (err) {
          console.error(err);
          alert("Error cancelling payment");
        }
      }}
      className="w-full p-3 rounded-xl bg-red-600 font-bold"
    >
      Cancel card machine payment
    </button>
  </div>
)}
        </div>

        {job && (
  <button
    onClick={searchGoCardless}
    className="w-full p-4 rounded-xl bg-blue-600 font-bold"
  >
    Charge £55 HeatCover+ Excess
  </button>
)}

{gcLoading && (
  <div className="p-3 bg-yellow-600 rounded-xl text-black">
    Searching GoCardless...
  </div>
)}

{gcError && (
  <div className="p-3 bg-red-600 rounded-xl">
    {gcError}
  </div>
)}

{gcSuccess && (
  <div className="p-3 bg-green-600 rounded-xl">
    {gcSuccess}
  </div>
)}

{gcSearched && !gcLoading && gcMatches.length === 0 && !gcError && (
  <div className="p-3 bg-zinc-800 border border-zinc-700 rounded-xl">
    No GoCardless customer found for this ServiceM8 billing email.
  </div>
)}

{gcMatches.length > 0 && (
  <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-700 space-y-2">
    <p className="font-bold">GoCardless Match</p>

{gcMatches.map((c, i) => (
  <div key={i} className="p-3 bg-black rounded-xl">
    <p>{c.given_name} {c.family_name}</p>
    <p className="text-sm text-zinc-400">{c.email}</p>

    {c.hasActiveMandate ? (
      <>
        <p className="text-green-400">Mandate active</p>

<button
  onClick={() => setSelectedGcCustomer(c)}
  disabled={gcCharging}
  className="mt-3 w-full p-3 rounded-xl bg-green-600 font-bold disabled:opacity-50"
>
  Select for £55 Excess Charge
</button>

{selectedGcCustomer?.id === c.id && (
  <div className="mt-2 p-2 bg-purple-600 rounded-lg text-sm text-white">
    ✔  Selected, are you sure? Customer will be charged
  </div>
)}
      </>
    ) : (
      
      <p className="text-yellow-400">
        Mandate not active ({c.mandates?.[0]?.status})
      </p>
    )}
  </div>
))}
  </div>
)}

{machineStatus === "waiting" && (
  <div className="p-4 rounded-xl bg-yellow-600 text-black text-center font-bold">
    💳 Waiting for card payment...
  </div>
)}

{machineStatus === "success" && (
  <div className="p-4 rounded-xl bg-green-600 text-white text-center font-bold">
    ✅ Payment successful — ServiceM8 updated
  </div>
)}

{paymentRoute === "office" && !isGcMode && !isPaid && (
  <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-700 space-y-3">
    <p className="font-bold">Office phone payment card details</p>
    <div className="p-4 rounded-xl bg-white text-black">
      <CardElement
        options={{
          hidePostalCode: true,
        }}
      />
    </div>
    <p className="text-xs text-zinc-400">
      Card details are entered into Stripe secure fields. Gamma Pay does not store card numbers.
    </p>
  </div>
)}

        <label className="flex items-center gap-3 p-4 rounded-xl bg-zinc-900 border border-zinc-700">
          <input
            type="checkbox"
            checked={markComplete}
            onChange={(e) => setMarkComplete(e.target.checked)}
            className="w-5 h-5"
          />
          <span>Mark job complete after payment</span>
        </label>

        <button
          onClick={chargeCard}
          disabled={isPaid || processingPayment || gcAlreadyCharged}
          className={`w-full p-4 rounded-xl font-bold ${
  isPaid || gcAlreadyCharged
    ? "bg-gray-600 cursor-not-allowed"
    : "bg-gradient-to-r from-purple-600 to-pink-500"
}`}
        >
{isPaid
  ? "Already Paid"
  : gcAlreadyCharged
  ? "HeatCover+ Excess Requested"
  : gcCharging
  ? "Requesting £55..."
  : processingPayment
  ? "Processing..."
: isGcMode
? "Charge £55.00"
: paymentRoute === "paypal"
? `Text PayPal Link £${(
    Number(manualAmount || 0) > 0
      ? Number(manualAmount)
      : amountToCharge
  ).toFixed(2)}`
: `Charge £${(
    Number(manualAmount || 0) > 0
      ? Number(manualAmount)
      : amountToCharge
  ).toFixed(2)}`
}
        </button>
      </div>
    </div>
  );
}
export default function Home() {
  return (
    <Elements stripe={stripePromise}>
      <HomeContent />
    </Elements>
  );
}