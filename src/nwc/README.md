# Arkade Zaps - NWC Implementation

**Arkade Zaps** are Nostr zaps powered by Arkade vtxos instead of Lightning. This implementation uses NIP-47 (Nostr Wallet Connect) to enable native Arkade payments in Nostr apps.

## What are Arkade Zaps?

Traditional Nostr zaps use Lightning Network. Arkade Zaps use **Arkade vtxos** - providing:
- ⚡ **Instant transfers** (no Lightning channels needed)
- 🔒 **Privacy** (Arkade's covenant-based model)
- ⛓️ **On-chain compatible** (settles to Bitcoin mainnet)
- 💰 **No routing fees** (only minimal on-chain fees)

## Architecture

```
┌──────────────┐         ┌──────────────────┐         ┌─────────────┐
│  Nostr App   │ NIP-47  │  NWC Server      │  SDK    │   Arkade    │
│ (Snort etc)  │◄───────►│  (this wallet)   │◄───────►│   Network   │
└──────────────┘         └──────────────────┘         └─────────────┘
    Sends:                 Receives:                    Executes:
    - Arkade address       - pay_invoice                - sendOffChain()
    - Amount               - get_balance                - vtxo transfer
                           - get_info
                           - make_invoice
```

## Files

- **`pairing.ts`** - Generates NWC pairing URLs with secrets
- **`server.ts`** - NWC server that processes Arkade payments (no Lightning!)
- **`storage.ts`** - Persists connections in localStorage
- **`providers/nwc.tsx`** - React provider for server lifecycle
- **`screens/Settings/WalletConnect.tsx`** - UI for pairing and connection management

## How it works

### 1. Pairing
User generates a QR code with `nostr+walletconnect://` URL containing:
- Wallet's Nostr pubkey
- Relay URL (wss://relay.damus.io)
- Shared secret for encryption

### 2. Connection
Nostr app scans QR and stores connection details. All communication is encrypted via NIP-04.

### 3. Payment Flow

**Traditional Lightning Zap:**
```
App → Lightning invoice → Wallet pays via Lightning → Invoice settled
```

**Arkade Zap:**
```
App → Arkade address (ark1...) → Wallet sends vtxos → Instant settlement
```

When a Nostr app requests payment:
1. App calls `pay_invoice` with an **Arkade address** (ark1...) instead of Lightning invoice
2. NWC server validates the address
3. Server calls `sendOffChain()` to send vtxos
4. Server responds with vtxo txid as "preimage"
5. App can publish zap receipt with txid proof

## NIP-47 Methods (Adapted for Arkade)

### `pay_invoice`
**Request:**
```json
{
  "method": "pay_invoice",
  "params": {
    "invoice": "ark1q...", // Arkade address (not Lightning invoice!)
    "amount": 1000          // Amount in sats
  }
}
```

**Response:**
```json
{
  "result_type": "pay_invoice",
  "result": {
    "preimage": "vtxo-txid" // VTXO transaction ID as proof
  }
}
```

### `get_balance`
Returns wallet balance in millisats (NIP-47 standard).

### `get_info`
Returns wallet information:
```json
{
  "alias": "Arkade Wallet",
  "network": "arkade",
  "methods": ["pay_invoice", "get_balance", "get_info", "make_invoice"]
}
```

### `make_invoice`
Returns an Arkade receiving address instead of Lightning invoice:
```json
{
  "invoice": "ark1q...",  // Arkade address (not BOLT11!)
  "amount": 0,             // Can receive any amount
  "expires_at": 0          // Doesn't expire
}
```

## Integration Guide

### 1. Add NWCProvider

In [src/index.tsx](../index.tsx#L39-L48):

```tsx
<WalletProvider>
  <LightningProvider>  {/* Can keep for Boltz if needed */}
    <NWCProvider>
      <App />
    </NWCProvider>
  </LightningProvider>
</WalletProvider>
```

**Note:** `NWCProvider` only depends on `WalletProvider` now (Lightning not required for Arkade Zaps).

### 2. Access from UI

Already integrated at **Settings > Wallet Connect**. Users can:
- Generate pairing QR codes
- View connected Nostr apps
- Disconnect apps
- See usage timestamps

### 3. For Developers

```tsx
import { useContext } from 'react'
import { NWCContext } from './providers/nwc'

function MyComponent() {
  const { connections, isRunning, reloadServer } = useContext(NWCContext)

  return (
    <div>
      <p>Arkade Zaps enabled: {isRunning ? 'Yes' : 'No'}</p>
      <p>Connected apps: {connections.length}</p>
    </div>
  )
}
```

## NIP-XX: Arkade Zaps Spec (Draft)

### Kind 9734: Arkade Zap Request
Identical to NIP-57 but with `["arkade"]` tag:

```json
{
  "kind": 9734,
  "content": "Great post!",
  "tags": [
    ["relays", "wss://relay.damus.io"],
    ["amount", "1000"],
    ["p", "recipient-pubkey"],
    ["e", "event-id"],
    ["arkade"]  // Identifies this as Arkade zap
  ]
}
```

### Kind 9735: Arkade Zap Receipt
```json
{
  "kind": 9735,
  "content": "",
  "tags": [
    ["p", "recipient-pubkey"],
    ["P", "sender-pubkey"],
    ["e", "zap-request-event-id"],
    ["arkade", "vtxo-txid"],  // Proof of Arkade payment
    ["amount", "1000"]
  ]
}
```

### Profile Metadata (Kind 0)
Add Arkade address to profile:

```json
{
  "name": "Alice",
  "about": "Bitcoiner",
  "arkade": "ark1q...",  // Arkade receiving address
  "lud16": "alice@domain.com"  // Can still have Lightning too
}
```

## Testing

### Manual Test Flow

1. **Setup wallet:**
   - Go to Settings > Wallet Connect
   - You should see a QR code

2. **Connect a Nostr app:**
   - In your forked Snort, scan the QR code
   - Or paste the `nostr+walletconnect://` URL

3. **Test zap:**
   - Find a post in Snort
   - Click zap button
   - App should call `pay_invoice` with your Arkade address
   - Payment executes via vtxos
   - Zap receipt published with vtxo txid

### Debug Logs

Check browser console for:
- `"Starting Arkade NWC server with X connection(s)"`
- `"Processing NWC request from..."`
- `"Sending X sats to Arkade address ark1..."`
- `"Arkade payment successful: vtxo-txid"`

## Differences from Lightning NWC

| Feature | Lightning NWC | Arkade NWC |
|---------|---------------|------------|
| Invoice format | BOLT11 string | Arkade address (ark1...) |
| Payment method | Lightning channels | Arkade vtxos |
| Preimage | Lightning preimage hash | VTXO transaction ID |
| Network | Lightning Network | Arkade Network |
| Fees | Routing + base fee | Minimal on-chain fees |
| Settlement | Off-chain until channel close | Can settle to Bitcoin anytime |

## Next Steps for Full Arkade Zaps

To complete the Arkade Zaps ecosystem:

### 1. Define NIP-XX Specification
Write formal NIP document for Arkade Zaps (kinds 9734/9735).

### 2. Fork Nostr Client (Snort)
Modify zap UI to:
- Check if recipient has `"arkade"` field in profile
- Show "Arkade Zap" option alongside Lightning
- Send Arkade address instead of requesting Lightning invoice
- Parse and display Arkade zap receipts

### 3. Backend Support
Relay operators may want to index Arkade zap events for:
- Zap count aggregation
- Popular content ranking
- User reputation systems

### 4. Future Enhancements
- [ ] Spending limits per connection
- [ ] Approval flow for large amounts
- [ ] Multiple relays per connection
- [ ] Zap history view
- [ ] Connection name/app detection
- [ ] Revocable permissions

## Security

- 🔐 **NIP-04 encryption** - All requests/responses encrypted
- 🎫 **Secret-based auth** - Only apps with correct secret can connect
- ✋ **Permission system** - Each app has allowed methods
- 🔓 **Revocable access** - Disconnect apps anytime

## Contributing

This is part of a larger vision to bring Arkade to Nostr. Contributions welcome:
- Improve NWC protocol
- Add features
- Test with different Nostr clients
- Help write NIP-XX specification

---

Built with ❤️ for the Nostr + Arkade ecosystem
