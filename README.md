# parcel-tracking-mcp

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that lets Claude (and any other MCP-compatible AI) track parcels worldwide via the [17track API](https://www.17track.net/en/api).

## Features

| Tool | Description |
|------|-------------|
| `track_parcel` | Register + fetch live tracking info for a single parcel |
| `track_multiple_parcels` | Batch-track up to 40 parcels at once |
| `register_tracking` | Register tracking numbers without fetching data |
| `stop_tracking` | Stop monitoring parcels (conserves quota) |
| `delete_tracking` | Permanently remove parcels from your account |
| `get_quota` | Check your API quota usage |

Supports **2,400+ carriers** including FedEx, UPS, DHL, USPS, Royal Mail, Amazon Logistics, and hundreds more.

## Requirements

- Node.js 18+
- A [17track API key](https://www.17track.net/en/api) (free tier: 200 tracking numbers)

## Installation

### Option 1 — npx (no install needed)

```bash
SEVENTEEN_TRACK_API_KEY=your_key npx parcel-tracking-mcp
```

### Option 2 — global install

```bash
npm install -g parcel-tracking-mcp
SEVENTEEN_TRACK_API_KEY=your_key parcel-tracking-mcp
```

### Option 3 — build from source

```bash
git clone https://github.com/YOUR_USERNAME/parcel-tracking-mcp
cd parcel-tracking-mcp
npm install
npm run build
SEVENTEEN_TRACK_API_KEY=your_key npm start
```

## Claude Desktop / Claude Code setup

Add this to your MCP config file.

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "parcel-tracking": {
      "command": "npx",
      "args": ["parcel-tracking-mcp"],
      "env": {
        "SEVENTEEN_TRACK_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

**Claude Code** (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "parcel-tracking": {
      "command": "npx",
      "args": ["parcel-tracking-mcp"],
      "env": {
        "SEVENTEEN_TRACK_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## Getting a 17track API Key

1. Sign up at [17track.net](https://www.17track.net/en/api)
2. Go to **API** in your account dashboard
3. Create an API key and copy it
4. New accounts get **200 free tracking slots**

## Usage examples

Once connected, you can ask Claude things like:

> "Track my parcel with tracking number 1Z999AA10123456784"

> "Where are these packages? [list of tracking numbers]"

> "Check the status of my FedEx shipment 449044304137821"

> "How much API quota do I have left?"

## Carrier codes

17track uses numeric carrier codes. You can usually omit the carrier and 17track will auto-detect it. Common codes:

| Carrier | Code |
|---------|------|
| FedEx | 100002 |
| UPS | 100001 |
| DHL Express | 100003 |
| USPS | 100027 |
| DHL eCommerce | 100116 |
| Amazon Logistics | 100208 |
| Royal Mail | 190021 |

See the [full carrier list](https://www.17track.net/en/support/api-doc#carrier) in the 17track docs.

## Development

```bash
npm install
npm run dev   # runs with tsx (no build step)
npm run build # compile to dist/
```

## License

MIT
