import { NextResponse } from "next/server";

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

    const res = await fetch(
      `https://api.servicem8.com/api_1.0/job.json?$filter=${filter}`,
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

      return NextResponse.json(
        {
          error: "ServiceM8 lookup failed",
          status: res.status,
          details: text,
        },
        { status: 500 }
      );
    }

    const jobs = await res.json();

    if (!Array.isArray(jobs) || jobs.length === 0) {
      return NextResponse.json(
        { error: "No job found for that job number" },
        { status: 404 }
      );
    }

    const job = jobs[0];

    return NextResponse.json({
      uuid: job.uuid,
      jobNumber: job.generated_job_id,
      customer: job.company_name || job.billing_name || "Unknown customer",
      address: job.job_address || job.billing_address || "",
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