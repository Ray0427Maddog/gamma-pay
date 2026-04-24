import { NextResponse } from "next/server";

async function serviceM8Get(path: string, apiKey: string) {
  const res = await fetch(`https://api.servicem8.com/api_1.0/${path}`, {
    method: "GET",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ServiceM8 error ${res.status}: ${text}`);
  }

  return res.json();
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const jobNumber = searchParams.get("jobNumber");

    if (!jobNumber) {
      return NextResponse.json(
        { error: "Missing job number" },
        { status: 400 }
      );
    }

    const apiKey = process.env.SERVICEM8_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing SERVICEM8_API_KEY" },
        { status: 500 }
      );
    }

    const filter = encodeURIComponent(`generated_job_id eq '${jobNumber}'`);

    const jobs = await serviceM8Get(`job.json?$filter=${filter}`, apiKey);

    if (!Array.isArray(jobs) || jobs.length === 0) {
      return NextResponse.json(
        { error: "No job found for that job number" },
        { status: 404 }
      );
    }

    const job = jobs[0];

    let customer = "Unknown customer";
    let billingAddress = job.billing_address || "";

    if (job.company_uuid) {
      try {
        const client = await serviceM8Get(
          `company/${job.company_uuid}.json`,
          apiKey
        );

        customer =
          client.name ||
          client.company_name ||
          job.company_name ||
          job.billing_name ||
          "Unknown customer";

        billingAddress = client.billing_address || client.address || billingAddress;
      } catch (err) {
        console.error("Client lookup failed:", err);
      }
    }

    return NextResponse.json({
      uuid: job.uuid,
      jobNumber: job.generated_job_id,
      customer,
      address: job.job_address || billingAddress || "",
      billingAddress,
      status: job.status || "",
      paymentReceived: job.payment_received || "",
      raw: job,
    });
  } catch (err: any) {
    console.error("ServiceM8 job lookup error:", err);

    return NextResponse.json(
      { error: err.message || "ServiceM8 job lookup failed" },
      { status: 500 }
    );
  }
}