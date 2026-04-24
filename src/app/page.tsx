'use client'

import { useEffect, useState } from "react";

type JobResult = {
  uuid: string;
  jobNumber: string;
  customer: string;
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
  const [success, setSuccess] = useState(false);
  const [markComplete, setMarkComplete] = useState(false);

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

  async function findJob() {
    if (!jobNumber.trim()) {
      alert("Enter a ServiceM8 job number");
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
        alert(data.error || "Job not found");
        return;
      }

      setJob(data);
    } catch (err) {
      console.error(err);
      alert("Could not look up ServiceM8 job");
    } finally {
      setLoading(false);
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
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jobNumber,
          jobUuid: job?.uuid || "",
          amount: amountToCharge,
          markComplete,
        }),
      });

      const data = await res.json();

      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || "Could not start payment");
      }
    } catch (err) {
      console.error(err);
      alert("Could not start payment");
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
            onClick={findJob}
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

        {!totalAmount && (
          <input
            type="number"
            placeholder="Manual Amount (£)"
            value={manualAmount}
            onChange={(e) => setManualAmount(e.target.value)}
            className="w-full p-4 rounded-xl bg-zinc-900 border border-zinc-700"
          />
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
          disabled={isPaid}
          className={`w-full p-4 rounded-xl font-bold ${
            isPaid
              ? "bg-gray-600 cursor-not-allowed"
              : "bg-gradient-to-r from-purple-600 to-pink-500"
          }`}
        >
          {isPaid ? "Already Paid" : `Charge £${amountToCharge.toFixed(2)}`}
        </button>
      </div>
    </div>
  );
}