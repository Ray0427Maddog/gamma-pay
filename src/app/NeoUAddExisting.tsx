'use client'

import { useEffect, useState } from "react";

// Add Neo U to an EXISTING HeatCover+ V4 customer, using their existing
// Direct Debit. Search -> pick plan -> script & consent -> review -> done.

type Sub = {
  id: string;
  name: string;
  amount: number;
  dayOfMonth: number;
  mandateId: string;
  isNeoU: boolean;
};

type Result = {
  customerId: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postcode: string;
  mandates: { id: string; status: string; reference: string }[];
  subscriptions: Sub[];
  recentPayments: { amount: number; chargeDate: string; description: string; status: string }[];
  suggestedDay: number;
  hasNeoU: boolean;
};

const pounds = (p: number) => `£${(p / 100).toFixed(2)}`;
const ordinal = (n: number) =>
  `${n}${
    [1, 21].includes(n) ? "st" : [2, 22].includes(n) ? "nd" : [3, 23].includes(n) ? "rd" : "th"
  }`;
const niceDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const btnMain =
  "p-4 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 font-bold disabled:opacity-40 disabled:cursor-not-allowed";
const btnBack = "p-4 rounded-xl bg-zinc-700 font-bold";

export default function NeoUAddExisting({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<"search" | "script" | "review" | "done">("search");
  const [addId] = useState(() => crypto.randomUUID());

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [searchNote, setSearchNote] = useState("");
  const [error, setError] = useState("");

  const [customer, setCustomer] = useState<Result | null>(null);
  const [plan, setPlan] = useState<Sub | null>(null);
  // Manual V4 confirmation (customer has no V4 subscription in GoCardless)
  const [manualEf, setManualEf] = useState<boolean | null>(null);
  const [manualDay, setManualDay] = useState<number>(0);

  const [price, setPrice] = useState<{ pricePence: number; regularPence: number; onSale: boolean } | null>(null);
  const [priceError, setPriceError] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<any>(null);

  useEffect(() => {
    fetch("/api/heatcover/neo-u-price", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => (d.success ? setPrice(d) : setPriceError(d.error || "price unavailable")))
      .catch(() => setPriceError("price unavailable"));
  }, []);

  const install = price ? pounds(price.pricePence) : "…";

  async function search() {
    setSearching(true);
    setError("");
    setResults(null);
    setCustomer(null);
    setPlan(null);
    try {
      const r = await fetch(`/api/heatcover/neo-u/find?query=${encodeURIComponent(query)}`, { cache: "no-store" });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setResults(d.results);
      setSearchNote(
        d.withoutDirectDebit
          ? `${d.withoutDirectDebit} other match(es) hidden: no active Direct Debit.`
          : ""
      );
    } catch (e: any) {
      setError(e?.message || "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function submit() {
    if (!customer || !plan) return;
    setSubmitting(true);
    setError("");
    try {
      const r = await fetch("/api/heatcover/neo-u/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addId,
          customerId: customer.customerId,
          mandateId: plan.mandateId,
          ...(plan.id
            ? { v4SubscriptionId: plan.id }
            : { manualDay: plan.dayOfMonth, manualExcessFree: plan.amount === 4900 }),
        }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setDone(d);
      setStep("done");
    } catch (e: any) {
      setError(e?.message || "Could not add Neo U");
    } finally {
      setSubmitting(false);
    }
  }

  const looksV4 = (s: Sub) => /v4/i.test(s.name) || s.amount === 3800 || s.amount === 4900;

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center p-6">
      <div className="w-full max-w-md">
        <div className="relative mb-8">
          <button
            type="button"
            onClick={onClose}
            className="absolute left-0 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
          >
            ← Back
          </button>
          <h1 className="text-3xl font-bold text-pink-500 text-center">Neo U</h1>
        </div>

        <div className="p-6 rounded-xl bg-zinc-900 border border-zinc-700">
          <h2 className="text-xl font-bold mb-2">Add Neo U to Existing Customer</h2>
          <p className="text-zinc-400">
            For HeatCover+ V4 customers. Uses their existing Direct Debit.
          </p>

          {error && (
            <div className="mt-4 p-3 rounded-xl bg-red-900/40 border border-red-700">
              <p className="text-sm font-bold text-red-400">Problem</p>
              <p className="text-sm mt-1">{error}</p>
            </div>
          )}

          {/* ---------- SEARCH ---------- */}
          {step === "search" && (
            <div className="mt-6 space-y-4">
              <div className="flex gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && query.trim().length >= 3 && search()}
                  placeholder="Surname, email or postcode"
                  className="flex-1 p-4 rounded-xl bg-black border border-zinc-700"
                />
                <button
                  type="button"
                  onClick={search}
                  disabled={searching || query.trim().length < 3}
                  className="px-4 rounded-xl bg-blue-600 font-bold disabled:opacity-40"
                >
                  {searching ? "…" : "Find"}
                </button>
              </div>

              {results && results.length === 0 && (
                <p className="text-sm text-zinc-400">
                  No customers with an active Direct Debit found. {searchNote}
                </p>
              )}
              {results && results.length > 0 && searchNote && (
                <p className="text-xs text-zinc-500">{searchNote}</p>
              )}

              {results?.map((r) => (
                <div
                  key={r.customerId}
                  className={`p-4 rounded-xl border ${
                    customer?.customerId === r.customerId
                      ? "bg-zinc-800 border-pink-500"
                      : "bg-black border-zinc-700"
                  }`}
                >
                  <p className="font-bold">{r.name}</p>
                  <p className="text-sm text-zinc-400">
                    {[r.address, r.city, r.postcode].filter(Boolean).join(", ")}
                  </p>
                  <p className="text-sm text-zinc-400">{r.email}</p>

                  {r.hasNeoU ? (
                    <p className="text-sm text-yellow-400 mt-2">Already has Neo U.</p>
                  ) : r.subscriptions.filter((x) => !x.isNeoU).length === 0 ? (
                    <div className="mt-3 space-y-3">
                      <p className="text-sm text-yellow-400">
                        Their plan isn&apos;t set up as a GoCardless subscription.
                        Check they&apos;re on V4 before continuing.
                      </p>
                      {r.recentPayments.length > 0 && (
                        <div className="text-xs text-zinc-400 space-y-1">
                          <p className="text-zinc-500">Recent payments:</p>
                          {r.recentPayments.map((p, i) => (
                            <p key={i}>
                              {niceDate(p.chargeDate)} · {pounds(p.amount)} ·{" "}
                              {p.description || "payment"} ({p.status.replace(/_/g, " ")})
                            </p>
                          ))}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        {[false, true].map((ef) => (
                          <button
                            key={String(ef)}
                            type="button"
                            onClick={() => {
                              setManualEf(ef);
                              if (!manualDay) setManualDay(r.suggestedDay || 1);
                            }}
                            className={`p-3 rounded-lg border text-sm font-bold ${
                              customer?.customerId === r.customerId && manualEf === ef
                                ? "bg-purple-600 border-pink-500"
                                : "bg-zinc-900 border-zinc-700"
                            }`}
                          >
                            {ef ? "V4 Excess Free" : "V4"}
                          </button>
                        ))}
                      </div>
                      <label className="block text-xs text-zinc-400">
                        Take the £6 on the
                        <select
                          value={manualDay || r.suggestedDay || 1}
                          onChange={(e) => setManualDay(Number(e.target.value))}
                          className="ml-2 p-2 rounded-lg bg-black border border-zinc-700 text-white"
                        >
                          {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                            <option key={d} value={d}>
                              {ordinal(d)}
                            </option>
                          ))}
                        </select>
                        {r.suggestedDay ? " (matches their last payment)" : ""}
                      </label>
                      <button
                        type="button"
                        disabled={manualEf === null}
                        onClick={() => {
                          const day = manualDay || r.suggestedDay || 1;
                          setCustomer(r);
                          setPlan({
                            id: "",
                            name: `HeatCover+ V4${manualEf ? " Excess Free" : ""} (confirmed by staff)`,
                            amount: manualEf ? 4900 : 3800,
                            dayOfMonth: day,
                            mandateId: r.mandates[0].id,
                            isNeoU: false,
                          });
                        }}
                        className={`w-full p-3 rounded-lg border text-sm font-bold disabled:opacity-40 ${
                          customer?.customerId === r.customerId && plan && !plan.id
                            ? "bg-purple-600 border-pink-500"
                            : "bg-zinc-900 border-zinc-700"
                        }`}
                      >
                        {customer?.customerId === r.customerId && plan && !plan.id
                          ? "✓ Confirmed on V4"
                          : "I've confirmed they're on V4"}
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-zinc-500">Select their V4 plan:</p>
                      {r.subscriptions
                        .filter((s) => !s.isNeoU)
                        .map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              setCustomer(r);
                              setPlan(s);
                            }}
                            className={`w-full p-3 rounded-lg border text-left ${
                              plan?.id === s.id
                                ? "bg-purple-600 border-pink-500"
                                : "bg-zinc-900 border-zinc-700"
                            }`}
                          >
                            <div className="flex justify-between gap-2">
                              <span className="font-bold">{s.name || "Subscription"}</span>
                              <span className="font-bold">{pounds(s.amount)}/mo</span>
                            </div>
                            <p className="text-xs text-zinc-400">
                              Taken on the {ordinal(s.dayOfMonth)}
                              {!looksV4(s) && " · doesn't look like a V4 plan, check before continuing"}
                            </p>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              ))}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={onClose} className={`w-1/3 ${btnBack}`}>
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!customer || !plan}
                  onClick={() => setStep("script")}
                  className={`w-2/3 ${btnMain}`}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ---------- SCRIPT + CONSENT ---------- */}
          {step === "script" && customer && plan && (
            <div className="mt-6 space-y-4">
              <div className="p-4 rounded-xl bg-yellow-900/40 border border-yellow-700 space-y-3">
                <p className="text-sm font-bold text-yellow-400">READ TO CUSTOMER</p>
                <p>
                  Our Neo U oil tank level monitor measures the oil in your tank and
                  emails you a weekly report of how much oil you have left, so you
                  never run out. It&apos;s £6 per month, and there&apos;s a one-off
                  installation fee of{" "}
                  {price?.onSale
                    ? `${pounds(price.regularPence)}, currently discounted to ${install}`
                    : install}
                  .
                </p>
                <p>
                  The equipment stays the property of Gamma Heating and we look after
                  it for you, including batteries and repairs.
                </p>
                <p className="font-bold">
                  Are you happy for us to collect the one-off {install} installation
                  fee, and £6 every month on the {ordinal(plan.dayOfMonth)}, using your
                  existing HeatCover+ Direct Debit with us? GoCardless will email you
                  before each payment.
                </p>
                {priceError && (
                  <p className="text-xs text-red-400">
                    Couldn&apos;t load the current price ({priceError}). Check it on
                    gammaheating.co.uk.
                  </p>
                )}
              </div>
              <p className="text-sm text-zinc-400">
                Only continue if the customer says YES.
              </p>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setStep("search")} className={`w-1/3 ${btnBack}`}>
                  Back
                </button>
                <button
                  type="button"
                  disabled={!price}
                  onClick={() => setStep("review")}
                  className={`w-2/3 ${btnMain}`}
                >
                  Customer Agrees — Continue
                </button>
              </div>
            </div>
          )}

          {/* ---------- REVIEW ---------- */}
          {step === "review" && customer && plan && (
            <div className="mt-6 space-y-4">
              <div className="p-4 rounded-xl bg-zinc-800 border border-zinc-700 space-y-2">
                <p className="text-sm font-bold text-pink-500">CUSTOMER</p>
                <p className="font-bold">{customer.name}</p>
                <p className="text-sm text-zinc-300">{customer.email}</p>
                <p className="text-sm text-zinc-300">
                  {[customer.address, customer.city, customer.postcode].filter(Boolean).join(", ")}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-zinc-800 border border-zinc-700 space-y-3">
                <p className="text-sm font-bold text-pink-500">NEO U</p>
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-400">Existing plan</span>
                  <span className="font-bold">{plan.name || "Subscription"} ({pounds(plan.amount)}/mo)</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-400">Installation fee</span>
                  <span className="font-bold">{install}, as soon as possible</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-400">Monthly</span>
                  <span className="font-bold">£6.00 on the {ordinal(plan.dayOfMonth)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-400">Agreement</span>
                  <span className="font-bold">Emailed to customer</span>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setStep("script")} className={`w-1/3 ${btnBack}`}>
                  Back
                </button>
                <button type="button" disabled={submitting} onClick={submit} className={`w-2/3 ${btnMain}`}>
                  {submitting ? "Adding Neo U..." : "Confirm & Add Neo U"}
                </button>
              </div>
            </div>
          )}

          {/* ---------- DONE ---------- */}
          {step === "done" && done && customer && (
            <div className="mt-6 space-y-4">
              <div className="p-4 rounded-xl bg-yellow-900/40 border border-yellow-700 space-y-3">
                <p className="text-sm font-bold text-yellow-400">READ TO CUSTOMER</p>
                <p>
                  That&apos;s all set up. The {pounds(done.installPence)} installation fee
                  will be collected on {niceDate(done.installChargeDate)}, and £6 a month
                  from {niceDate(done.monthlyStart)}, on the {ordinal(done.monthlyDay)} of
                  each month. GoCardless will email you to confirm.
                </p>
                <p>
                  {done.agreementSent
                    ? `We'll email your Neo U agreement to ${done.email}. `
                    : ""}
                  We&apos;ll be in touch to book the installation. Is there anything else I
                  can help with today?
                </p>
              </div>
              {!done.agreementSent && (
                <div className="p-3 rounded-xl bg-red-900/40 border border-red-700">
                  <p className="text-sm font-bold text-red-400">Agreement not sent</p>
                  <p className="text-sm mt-1">
                    Neo U is set up, but the agreement email failed. Send it manually.
                  </p>
                </div>
              )}
              <button type="button" onClick={onClose} className={`w-full ${btnMain}`}>
                Finish
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
