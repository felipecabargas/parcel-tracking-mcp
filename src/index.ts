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
  time_utc: string;
  time_raw: string;
  description: string;
  location: string;
  stage: string;
  sub_status: string;
}

interface LatestStatus {
  status: string;
  substatus: string;
  time_iso: string;
  time_utc: string;
  time_raw: string;
  location: string;
  description: string;
}

interface TrackInfo {
  number: string;
  carrier: number;
  carrier_name?: string;
  status: string;
  substatus: string;
  latest_status: LatestStatus;
  events: TrackEvent[];
  original_country?: string;
  destination_country?: string;
  estimated_delivery_time?: string;
}

interface ApiTrackInfoResponse {
  code: number;
  data: {
    accepted: Array<{ number: string; "track_info": TrackInfo }>;
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
    quota: number;
    used: number;
    remaining: number;
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

function formatTrackInfo(info: TrackInfo): string {
  const lines: string[] = [];
  const statusLabel = STATUS_LABELS[info.status] ?? info.status;

  lines.push(`Tracking Number : ${info.number}`);
  lines.push(`Status          : ${statusLabel}${info.substatus ? ` (${info.substatus})` : ""}`);

  if (info.latest_status) {
    lines.push(`Latest Update   : ${info.latest_status.description}`);
    if (info.latest_status.location) {
      lines.push(`Location        : ${info.latest_status.location}`);
    }
    lines.push(`Time (UTC)      : ${info.latest_status.time_utc}`);
  }

  if (info.estimated_delivery_time) {
    lines.push(`Est. Delivery   : ${info.estimated_delivery_time}`);
  }

  if (info.original_country) {
    lines.push(`Origin          : ${info.original_country}`);
  }

  if (info.destination_country) {
    lines.push(`Destination     : ${info.destination_country}`);
  }

  if (info.events && info.events.length > 0) {
    lines.push("");
    lines.push("Tracking History:");
    for (const ev of info.events) {
      const loc = ev.location ? ` — ${ev.location}` : "";
      lines.push(`  [${ev.time_utc}]${loc}`);
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
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Failed to retrieve tracking for ${err.number}: ${err.error.message} (code ${err.error.code})`,
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

    const info = result.data.accepted[0].track_info;
    return {
      content: [{ type: "text", text: formatTrackInfo(info) }],
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
        lines.push(formatTrackInfo(item.track_info));
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

    const { quota, used, remaining } = result.data;
    const pct = quota > 0 ? ((used / quota) * 100).toFixed(1) : "0.0";

    const text = [
      `Total quota  : ${quota.toLocaleString()}`,
      `Used         : ${used.toLocaleString()} (${pct}%)`,
      `Remaining    : ${remaining.toLocaleString()}`,
    ].join("\n");

    return { content: [{ type: "text", text }] };
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
