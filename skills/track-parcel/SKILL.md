---
name: track-parcel
description: >
  This skill should be used when the user asks to "track a package", "where is my parcel",
  "track my shipment", "check delivery status", "track tracking number", or wants to know
  the current location or status of one or more parcels. Also triggers for phrases like
  "has my order shipped", "when will my package arrive", or "track these orders".
metadata:
  version: "0.1.0"
---

Use the `parcel-tracking` MCP tools to fetch live tracking data and present it clearly.

## Single parcel

Call `track_parcel` with the tracking number. If the user mentions a carrier by name, look up its code from the carrier reference table below and pass `carrier_code`.

Format the result as:
- Bold status on the first line
- Latest event with timestamp and location
- Estimated delivery if available
- Condensed history (last 5 events) if the user asks for details

## Multiple parcels

If the user provides 2–40 tracking numbers, call `track_multiple_parcels` in one request rather than looping.

Present results as a numbered list, one parcel per section, with a one-line status summary per parcel. Offer to show full history for any specific one.

## No tracking info yet

When the API returns "registered but no carrier scans yet", tell the user the number is registered and to check back once the carrier picks up the parcel. Do not treat this as an error.

## Common carrier codes

| Carrier          | Code   |
|------------------|--------|
| FedEx            | 100002 |
| UPS              | 100001 |
| DHL Express      | 100003 |
| USPS             | 100027 |
| Amazon Logistics | 100208 |
| Royal Mail       | 190021 |
| DHL eCommerce    | 100116 |

If the carrier is unknown or not listed, omit `carrier_code` — 17track will auto-detect it.
