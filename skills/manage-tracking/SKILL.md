---
name: manage-tracking
description: >
  This skill should be used when the user wants to "register a tracking number",
  "stop tracking a package", "delete a tracking number", "check my API quota",
  "how many tracking slots do I have left", or wants to manage their 17track account
  subscriptions rather than just look up status.
metadata:
  version: "0.1.0"
---

Use the `parcel-tracking` MCP management tools based on the user's intent.

## Register

Call `register_tracking` when the user wants to start monitoring a number without immediately fetching its status. Accepts an optional `tag` label per number. Confirm accepted vs rejected in the response.

## Stop tracking

Call `stop_tracking` when a parcel is delivered and the user wants to conserve quota. Remind the user this pauses monitoring but does not delete the record.

## Delete

Call `delete_tracking` to permanently remove a tracking number from the account. Warn the user this is irreversible before proceeding if they haven't already confirmed.

## Check quota

Call `get_quota` to show remaining tracking slots. Present as:

```
Quota: 150 / 200 used (75%) — 50 remaining
```

If remaining slots are under 10% of total, proactively suggest stopping or deleting delivered parcels.
