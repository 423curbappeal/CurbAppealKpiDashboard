import type { HcpEstimate, HcpJob, HcpOption } from "@/lib/housecall";

/** Synthetic records with the exact shape of the live Housecall Pro API (no real customer data). */
export function option(over: Partial<HcpOption> = {}): HcpOption {
  return { id: `opt_${Math.random().toString(36).slice(2, 8)}`, name: "Option #1", total_amount: 47500, status: "submitted for signoff", approval_status: null, created_at: "2026-11-02T15:00:00Z", ...over };
}

export function estimate(id: string, over: Partial<HcpEstimate> = {}): HcpEstimate {
  return {
    id,
    estimate_number: id.replace(/\D/g, "") || "100",
    work_status: "needs scheduling",
    customer: { id: `cus_${id}`, first_name: "Pat", last_name: "Lee", company: null },
    created_at: "2026-11-02T14:00:00Z",
    options: [option()],
    ...over,
  };
}

export function job(id: string, over: Partial<HcpJob> = {}): HcpJob {
  return {
    id,
    invoice_number: id.replace(/\D/g, "") || "200",
    work_status: "needs scheduling",
    customer: { id: `cus_${id}`, first_name: "Sam", last_name: "Diaz", company: null },
    address: { street: "1 Main St", city: "Hixson" },
    schedule: { scheduled_start: null, scheduled_end: null },
    total_amount: 41400,
    job_fields: { job_type: { name: "House Wash" } },
    created_at: "2026-11-01T14:00:00Z",
    deleted_at: null,
    canceled_at: null,
    ...over,
  };
}
