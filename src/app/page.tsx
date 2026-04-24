'use client'

import { useEffect, useState } from "react";

type JobResult = {
  uuid: string;
  jobNumber: string;
  customer: string;
  address: string;
  status: string;
  paymentReceived: string;
  raw: {
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSuccess(params.get("success") === "true");
  }, []);

  const servicem8Amount = job?.raw?.total_invoice_amount
    ? Number(job.raw.total_invoice_amount)
    : 0;

  const amountToCharge = servicem8Amount || Number(manualAmount);

  async function findJob() {
    setLoading(true);
    setJob(null);

    const res = await fetch(`/api/servicem8/job?jobNumber=${jobNumber}`);
    const data = await res.json();

    setLoading(false);

    if (!res.ok) {
      alert(data.error || "Job not found");
      return;
    }

    setJob(data);
  }

  async function chargeCard() {
    if (!jobNumber || !amountToCharge) {
      alert("Enter job number and amount");
      return;
    }

    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jobNumber,
        jobUuid: job?.uuid || "",
        amount: amountToCharge,
      }),
    });

    const data = await res.json();

    if (data.url) {
      window.location.href = data.url;
    } else {
      alert(data.error || "Could not start payment");
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
            className="px-4 rounded-xl bg-zinc-700 font-bold"
          >
            {loading ? "..." : "Find"}
          </button>
        </div>

        {job && (
          <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-700 space-y-2">
            <p className="text-sm text-zinc-400">Job #{job.jobNumber}</p>
            <p className="font-bold">{job.customer}</p>
            <p className="whitespace-pre-line text-sm">{job.address}</p>
            <p className="text-sm text-zinc-400">{job.status}</p>
            <p className="text-2xl font-bold text-pink-500">
              £{servicem8Amount.toFixed(2)}
            </p>
          </div>
        )}

        {!servicem8Amount && (
          <input
            type="number"
            placeholder="Manual Amount (£)"
            value={manualAmount}
            onChange={(e) => setManualAmount(e.target.value)}
            className="w-full p-4 rounded-xl bg-zinc-900 border border-zinc-700"
          />
        )}

        <button
          onClick={chargeCard}
          className="w-full p-4 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 font-bold"
        >
          Charge £{amountToCharge ? amountToCharge.toFixed(2) : "0.00"}
        </button>
      </div>
    </div>
  );
}