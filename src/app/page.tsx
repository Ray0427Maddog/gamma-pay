'use client'

import { useState } from "react";

export default function Home() {
  const [jobNumber, setJobNumber] = useState("");
  const [amount, setAmount] = useState("");

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
      
      <h1 className="text-3xl font-bold mb-6 text-pink-500">
        Gamma Pay
      </h1>

      <div className="w-full max-w-md space-y-4">

        <input
          type="text"
          placeholder="Job Number"
          value={jobNumber}
          onChange={(e) => setJobNumber(e.target.value)}
          className="w-full p-4 rounded-xl bg-zinc-900 border border-zinc-700"
        />

        <input
          type="number"
          placeholder="Amount (£)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full p-4 rounded-xl bg-zinc-900 border border-zinc-700"
        />

        <button className="w-full p-4 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 font-bold">
          Charge Card
        </button>

      </div>
    </div>
  );
}