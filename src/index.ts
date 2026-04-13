#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = "https://api.17track.net/track/v2.2";

function getApiKey(): string {
  const key = process.env.SEVENTEEN_TRACK_API_KEY;
  if (!key) {
    throw new Error(
      "SEVENTEEN_TRACK_API_KEY environment variable is required. " +
        "Get your key at https://www.17track.net/en/api"
    );
  }
  return key;
}

async function apiPost<T>(
  endpoint: string,
  body: unknown
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "17token": getApiKey(),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`17track API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface TrackEvent {
  time_iso: string;
  time_raw: string | null;
  time_utc: string | null;
  description: string;
  location: string | null;
  stage: string | null;
  sub_status: string | null;
}

interface Provider {
  provider: { key: number; name: string; alias: string };
  latest_sync_status: string;
  latest_sync_time: string;
  events: TrackEvent[];
}

interface TrackInfo {
  latest_status: {
    status: string;
    sub_status: string;
    sub_status_descr: string | null;
  };
  latest_event: TrackEvent | null;
  shipping_info: {
    shipper_address: { country: string | null };
    recipient_address: { country: string | null };
  };
  time_metrics: {
    days_after_order: number;
    days_of_transit: number;
    estimated_delivery_date: {
      source: string | null;
      from: string | null;
      to: string | null;
    };
  };
  tracking: {
    providers: Provider[];
  };
}

interface TrackAccepted {
  number: string;
  carrier: number;
  track_info: TrackInfo;
}

interface ApiTrackInfoResponse {
  code: number;
  data: {
    accepted: TrackAccepted[];
    rejected: Array<{ number: string; error: { code: number; message: string } }>;
  };
}

interface ApiRegisterResponse {
  code: number;
  data: {
    accepted: Array<{ number: string; carrier: number }>;
    rejected: Array<{ number: string; error: { code: number; message: string } }>;
  };
}

interface ApiQuotaResponse {
  code: number;
  data: {
    quota_total: number;
    quota_used: number;
    quota_remain: number;
    today_used: number;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  NotFound: "Not Found",
  InfoReceived: "Info Received",
  InTransit: "In Transit",
  Expired: "Expired",
  AvailableForPickup: "Available for Pickup",
  OutForDelivery: "Out for Delivery",
  DeliveryFailure: "Delivery Failure",
  Delivered: "Delivered",
  Exception: "Exception",
};

function formatTrackInfo(item: TrackAccepted): string {
  const lines: string[] = [];
  const info = item.track_info;
  const status = info.latest_status.status;
  const statusLabel = STATUS_LABELS[status] ?? status;
  const subStatus = info.latest_status.sub_status;

  lines.push(`Tracking Number : ${item.number}`);
  lines.push(`Carrier Code    : ${item.carrier}`);
  lines.push(`Status          : ${statusLabel}${subStatus ? ` (${subStatus})` : ""}`);

  if (info.latest_event) {
    const ev = info.latest_event;
    if (ev.description) lines.push(`Latest Update   : ${ev.description}`);
    if (ev.location)    lines.push(`Location        : ${ev.location}`);
    if (ev.time_utc)    lines.push(`Time (UTC)      : ${ev.time_utc}`);
  }

  const edd = info.time_metrics.estimated_delivery_date;
  if (edd.from || edd.to) {
    const range = edd.from && edd.to ? `${edd.from} – ${edd.to}` : (edd.from ?? edd.to);
    lines.push(`Est. Delivery   : ${range}`);
  }

  const origin = info.shipping_info.shipper_address.country;
  const dest   = info.shipping_info.recipient_address.country;
  if (origin) lines.push(`Origin          : ${origin}`);
  if (dest)   lines.push(`Destination     : ${dest}`);

  if (info.time_metrics.days_of_transit > 0) {
    lines.push(`Days in Transit : ${info.time_metrics.days_of_transit}`);
  }

  // Collect all events from all providers
  const allEvents: TrackEvent[] = [];
  for (const p of info.tracking.providers) {
    allEvents.push(...p.events);
  }

  if (allEvents.length > 0) {
    lines.push("");
    lines.push("Tracking History:");
    for (const ev of allEvents) {
      const time = ev.time_utc ?? ev.time_iso ?? ev.time_raw ?? "—";
      const loc  = ev.location ? ` — ${ev.location}` : "";
      lines.push(`  [${time}]${loc}`);
      lines.push(`    ${ev.description}`);
    }
  }

  return lines.join("\n");
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "parcel-tracking-mcp",
  version: "1.0.0",
});

// Tool: track_parcel
server.tool(
  "track_parcel",
  "Register a tracking number (if not already registered) and return the latest tracking information for a parcel. Supports hundreds of carriers worldwide via the 17track service.",
  {
    tracking_number: z
      .string()
      .min(1)
      .describe("The parcel tracking number to look up"),
    carrier_code: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Optional numeric carrier code (e.g. 100002 for FedEx). Omit to let 17track auto-detect the carrier."
      ),
  },
  async ({ tracking_number, carrier_code }) => {
    // First register the tracking number (idempotent — safe to call again)
    const registerPayload = carrier_code
      ? [{ number: tracking_number, carrier: carrier_code }]
      : [{ number: tracking_number }];

    await apiPost<ApiRegisterResponse>("/register", registerPayload).catch(
      () => {
        // Ignore registration errors — the number may already be registered
      }
    );

    // Fetch tracking info
    const getPayload = carrier_code
      ? [{ number: tracking_number, carrier: carrier_code }]
      : [{ number: tracking_number }];

    const result = await apiPost<ApiTrackInfoResponse>(
      "/gettrackinfo",
      getPayload
    );

    if (result.data.rejected && result.data.rejected.length > 0) {
      const err = result.data.rejected[0];
      // -18019909 = registered but no carrier scan yet — not a hard error
      const noInfoYet = err.error.code === -18019909;
      return {
        isError: !noInfoYet,
        content: [
          {
            type: "text",
            text: noInfoYet
              ? `Tracking number ${err.number} is registered but no carrier scans have been recorded yet. Check back later.`
              : `Failed to retrieve tracking for ${err.number}: ${err.error.message} (code ${err.error.code})`,
          },
        ],
      };
    }

    if (!result.data.accepted || result.data.accepted.length === 0) {
      return {
        isError: true,
        content: [{ type: "text", text: "No tracking data returned by the API." }],
      };
    }

    return {
      content: [{ type: "text", text: formatTrackInfo(result.data.accepted[0]) }],
    };
  }
);

// Tool: track_multiple_parcels
server.tool(
  "track_multiple_parcels",
  "Register and retrieve tracking information for up to 40 parcels in a single request.",
  {
    tracking_numbers: z
      .array(
        z.object({
          number: z.string().min(1).describe("Tracking number"),
          carrier: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Optional numeric carrier code"),
        })
      )
      .min(1)
      .max(40)
      .describe("List of tracking numbers to look up (max 40)"),
  },
  async ({ tracking_numbers }) => {
    // Register all numbers first
    await apiPost<ApiRegisterResponse>("/register", tracking_numbers).catch(
      () => {}
    );

    // Fetch tracking info for all
    const result = await apiPost<ApiTrackInfoResponse>(
      "/gettrackinfo",
      tracking_numbers
    );

    const lines: string[] = [];

    if (result.data.accepted && result.data.accepted.length > 0) {
      for (const item of result.data.accepted) {
        lines.push("─".repeat(60));
        lines.push(formatTrackInfo(item));
      }
    }

    if (result.data.rejected && result.data.rejected.length > 0) {
      lines.push("─".repeat(60));
      lines.push("Failed lookups:");
      for (const item of result.data.rejected) {
        lines.push(`  ${item.number}: ${item.error.message}`);
      }
    }

    if (lines.length === 0) {
      return {
        isError: true,
        content: [{ type: "text", text: "No tracking data returned by the API." }],
      };
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  }
);

// Tool: register_tracking
server.tool(
  "register_tracking",
  "Register one or more tracking numbers with 17track to start monitoring them. Registration is a prerequisite for retrieving tracking info on new numbers.",
  {
    tracking_numbers: z
      .array(
        z.object({
          number: z.string().min(1).describe("Tracking number"),
          carrier: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Optional numeric carrier code"),
          tag: z
            .string()
            .optional()
            .describe("Optional label/tag for this shipment"),
        })
      )
      .min(1)
      .max(40)
      .describe("Tracking numbers to register (max 40)"),
  },
  async ({ tracking_numbers }) => {
    const result = await apiPost<ApiRegisterResponse>(
      "/register",
      tracking_numbers
    );

    const lines: string[] = [];

    if (result.data.accepted && result.data.accepted.length > 0) {
      lines.push("Successfully registered:");
      for (const item of result.data.accepted) {
        lines.push(`  ✓ ${item.number} (carrier code: ${item.carrier})`);
      }
    }

    if (result.data.rejected && result.data.rejected.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push("Failed to register:");
      for (const item of result.data.rejected) {
        lines.push(`  ✗ ${item.number}: ${item.error.message}`);
      }
    }

    return {
      content: [{ type: "text", text: lines.join("\n") || "No results returned." }],
    };
  }
);

// Tool: stop_tracking
server.tool(
  "stop_tracking",
  "Stop monitoring one or more parcels. Useful to conserve quota once a parcel is delivered.",
  {
    tracking_numbers: z
      .array(
        z.object({
          number: z.string().min(1).describe("Tracking number"),
          carrier: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Optional carrier code"),
        })
      )
      .min(1)
      .max(40)
      .describe("Tracking numbers to stop (max 40)"),
  },
  async ({ tracking_numbers }) => {
    interface StopResponse {
      code: number;
      data: {
        accepted: Array<{ number: string }>;
        rejected: Array<{ number: string; error: { code: number; message: string } }>;
      };
    }

    const result = await apiPost<StopResponse>("/stoptrack", tracking_numbers);

    const lines: string[] = [];

    if (result.data.accepted && result.data.accepted.length > 0) {
      lines.push("Stopped tracking:");
      for (const item of result.data.accepted) {
        lines.push(`  ✓ ${item.number}`);
      }
    }

    if (result.data.rejected && result.data.rejected.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push("Failed:");
      for (const item of result.data.rejected) {
        lines.push(`  ✗ ${item.number}: ${item.error.message}`);
      }
    }

    return {
      content: [{ type: "text", text: lines.join("\n") || "No results returned." }],
    };
  }
);

// Tool: delete_tracking
server.tool(
  "delete_tracking",
  "Permanently delete one or more tracking numbers from your 17track account.",
  {
    tracking_numbers: z
      .array(
        z.object({
          number: z.string().min(1).describe("Tracking number"),
          carrier: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Optional carrier code"),
        })
      )
      .min(1)
      .max(40)
      .describe("Tracking numbers to delete (max 40)"),
  },
  async ({ tracking_numbers }) => {
    interface DeleteResponse {
      code: number;
      data: {
        accepted: Array<{ number: string }>;
        rejected: Array<{ number: string; error: { code: number; message: string } }>;
      };
    }

    const result = await apiPost<DeleteResponse>(
      "/deletetrack",
      tracking_numbers
    );

    const lines: string[] = [];

    if (result.data.accepted && result.data.accepted.length > 0) {
      lines.push("Deleted:");
      for (const item of result.data.accepted) {
        lines.push(`  ✓ ${item.number}`);
      }
    }

    if (result.data.rejected && result.data.rejected.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push("Failed:");
      for (const item of result.data.rejected) {
        lines.push(`  ✗ ${item.number}: ${item.error.message}`);
      }
    }

    return {
      content: [{ type: "text", text: lines.join("\n") || "No results returned." }],
    };
  }
);

// Tool: get_quota
server.tool(
  "get_quota",
  "Check your 17track API quota — how many tracking slots are available, used, and remaining.",
  {},
  async () => {
    const result = await apiPost<ApiQuotaResponse>("/getquota", []);

    const { quota_total, quota_used, quota_remain, today_used } = result.data;
    const pct = quota_total > 0 ? ((quota_used / quota_total) * 100).toFixed(1) : "0.0";

    const text = [
      `Total quota  : ${quota_total.toLocaleString()}`,
      `Used         : ${quota_used.toLocaleString()} (${pct}%)`,
      `Remaining    : ${quota_remain.toLocaleString()}`,
      `Used today   : ${today_used.toLocaleString()}`,
    ].join("\n");

    return { content: [{ type: "text", text }] };
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
