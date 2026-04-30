'use client'

import { useEffect, useState } from "react";

type PaymentRoute = "office" | "machine_01";

type JobResult = {
  uuid: string;
  jobNumber: string;
  customer: string;
  customerEmail?: string;
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

export default function Home() {
  const [jobNumber, setJobNumber] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [job, setJob] = useState<JobResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [success, setSuccess] = useState(false);
  const [markComplete, setMarkComplete] = useState(false);

  const [machineStatus, setMachineStatus] = useState<
  "idle" | "waiting" | "success"
>("idle");

const [gcMatches, setGcMatches] = useState<any[]>([]);
const [gcLoading, setGcLoading] = useState(false);
const [gcError, setGcError] = useState("");

  // NEW: where payment should be taken
  const [paymentRoute, setPaymentRoute] = useState<PaymentRoute>("office");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSuccess(params.get("success") === "true");
  }, []);

  const totalAmount = Number(job?.totalAmount || 0);
  const paidAmount = Number(job?.paidAmount || 0);
  const outstandingAmount = Number(job?.outstandingAmount || 0);

  const amountToCharge =
    outstandingAmount > 0 ? outstandingAmount : Number(manualAmount || 0);

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
  if (!job?.customerEmail) {
  setGcError("No customer email found on this job");
  setGcLoading(false);
  return;
}

  setGcLoading(true);
  setGcError("");
  setGcMatches([]);

  try {
    console.log(job);
    const query = job?.customerEmail || "";

    if (!query) {
  setGcError("No customer email found on this job");
  setGcLoading(false);
  return;
}

    const res = await fetch(
      `/api/gocardless/search?query=${encodeURIComponent(query)}`
    );

    const data = await res.json();

    if (!res.ok || data.success === false) {
      setGcError(data.error || "Search failed");
      return;
    }

    setGcMatches(data.matches || []);
  } catch (err) {
    console.error(err);
    setGcError("Could not search GoCardless");
  } finally {
    setGcLoading(false);
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
        : "/api/checkout";

        if (paymentRoute === "machine_01") {
  setMachineStatus("waiting");
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
      }),
    });

    const data = await res.json();
    const paymentIntentId = data.paymentIntentId;

    if (!res.ok || data.success === false) {
      alert(data.error || "Could not start payment");
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

        setTimeout(() => {
          setMachineStatus("idle");
        }, 5000);
      }

      if (status === "canceled") {
        clearInterval(interval);
        setMachineStatus("idle");
        alert("Payment cancelled on terminal");
      }

    } catch (err) {
      console.error("Polling error", err);
    }
  }, 3000);

  return;
}

    if (data.url) {
      window.location.href = data.url;
    } else {
      alert(data.error || "Could not start payment");
    }
  } catch (err) {
    console.error(err);
    alert("Could not start payment");
  } finally {
  setProcessingPayment(false);
 }
}
  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
      <h1 className="text-3xl font-bold mb-6 text-pink-500">
        Gamma Pay
      </h1>

      {success && (
        <div className="mb-6 p-4 bg-green-600 text-white rounded-xl">
          ✅ Payment successful
        </div>
      )}

      <div className="w-full max-w-md space-y-4">
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

{paymentRoute === "machine_01" && (
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

{gcMatches.length > 0 && (
  <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-700 space-y-2">
    <p className="font-bold">GoCardless Match</p>

    {gcMatches.map((c, i) => (
      <div key={i} className="p-3 bg-black rounded-xl">
        <p>{c.given_name} {c.family_name}</p>
        <p className="text-sm text-zinc-400">{c.email}</p>

        {c.hasActiveMandate ? (
          <p className="text-green-400">Mandate active</p>
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
          disabled={isPaid || processingPayment}
          className={`w-full p-4 rounded-xl font-bold ${
            isPaid
              ? "bg-gray-600 cursor-not-allowed"
              : "bg-gradient-to-r from-purple-600 to-pink-500"
          }`}
        >
          {isPaid
  ? "Already Paid"
  : processingPayment
  ? "Processing..."
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