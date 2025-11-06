import { NWCConnection } from '../lib/types'

const NWC_CONNECTIONS_KEY = 'nwc_connections'
const NWC_PENDING_SECRET_KEY = 'nwc_pending_secret'
const NWC_INVOICE_AMOUNTS_KEY = 'nwc_invoice_amounts'

/**
 * Get all NWC connections from localStorage
 */
export function getConnections(): NWCConnection[] {
  try {
    const stored = localStorage.getItem(NWC_CONNECTIONS_KEY)
    if (!stored) return []
    return JSON.parse(stored)
  } catch (error) {
    console.error('Failed to load NWC connections:', error)
    return []
  }
}

/**
 * Save NWC connections to localStorage
 */
export function saveConnections(connections: NWCConnection[]): void {
  try {
    localStorage.setItem(NWC_CONNECTIONS_KEY, JSON.stringify(connections))
  } catch (error) {
    console.error('Failed to save NWC connections:', error)
  }
}

/**
 * Add a new NWC connection
 */
export function addConnection(connection: NWCConnection): void {
  const connections = getConnections()
  connections.push(connection)
  saveConnections(connections)
}

/**
 * Remove a connection by ID or client pubkey
 */
export function removeConnection(idOrPubkey: string): void {
  const connections = getConnections()
  const filtered = connections.filter((c) => c.id !== idOrPubkey && c.clientPubkey !== idOrPubkey)
  saveConnections(filtered)
}

/**
 * Update a connection's last used timestamp
 */
export function updateLastUsed(clientPubkey: string): void {
  const connections = getConnections()
  const updated = connections.map((c) => (c.clientPubkey === clientPubkey ? { ...c, lastUsed: Date.now() } : c))
  saveConnections(updated)
}

/**
 * Get a connection by client pubkey
 */
export function getConnectionByPubkey(clientPubkey: string): NWCConnection | null {
  const connections = getConnections()
  return connections.find((c) => c.clientPubkey === clientPubkey) || null
}

/**
 * Get a connection by secret
 */
export function getConnectionBySecret(secret: string): NWCConnection | null {
  const connections = getConnections()
  return connections.find((c) => c.secret === secret) || null
}

/**
 * Update connection's client pubkey (for first-time pairing when actual client pubkey differs from derived one)
 */
export function updateConnectionPubkey(idOrSecret: string, clientPubkey: string): void {
  const connections = getConnections()
  const updated = connections.map((c) =>
    c.id === idOrSecret || c.secret === idOrSecret ? { ...c, clientPubkey } : c,
  )
  saveConnections(updated)
}

/**
 * Update connection name
 */
export function updateConnectionName(idOrPubkey: string, name: string): void {
  const connections = getConnections()
  const updated = connections.map((c) =>
    c.id === idOrPubkey || c.clientPubkey === idOrPubkey ? { ...c, name } : c,
  )
  saveConnections(updated)
}

/**
 * Store the pending secret temporarily (used during pairing)
 * This allows us to match incoming connection requests with the QR code we generated
 */
export function setPendingSecret(secret: string): void {
  try {
    localStorage.setItem(NWC_PENDING_SECRET_KEY, secret)
  } catch (error) {
    console.error('Failed to save pending secret:', error)
  }
}

/**
 * Get the pending secret
 */
export function getPendingSecret(): string | null {
  try {
    return localStorage.getItem(NWC_PENDING_SECRET_KEY)
  } catch (error) {
    console.error('Failed to load pending secret:', error)
    return null
  }
}

/**
 * Clear the pending secret
 */
export function clearPendingSecret(): void {
  try {
    localStorage.removeItem(NWC_PENDING_SECRET_KEY)
  } catch (error) {
    console.error('Failed to clear pending secret:', error)
  }
}

/**
 * Get the first unused connection (one that has never been used)
 * This is useful for reusing pending pairing URLs instead of creating duplicates
 */
export function getUnusedConnection(): NWCConnection | null {
  const connections = getConnections()
  // Find a connection that has never been used (no lastUsed timestamp)
  return connections.find((c) => !c.lastUsed) || null
}

/**
 * Store an invoice amount for later retrieval during pay_invoice
 * Needed because Arkade addresses don't encode amounts like Lightning invoices
 */
export function storeInvoiceAmount(invoice: string, amountSats: number): void {
  try {
    const stored = localStorage.getItem(NWC_INVOICE_AMOUNTS_KEY)
    const amounts = stored ? JSON.parse(stored) : {}
    amounts[invoice] = amountSats
    localStorage.setItem(NWC_INVOICE_AMOUNTS_KEY, JSON.stringify(amounts))
  } catch (error) {
    console.error('Failed to store invoice amount:', error)
  }
}

/**
 * Retrieve and remove an invoice amount
 */
export function retrieveInvoiceAmount(invoice: string): number | null {
  try {
    const stored = localStorage.getItem(NWC_INVOICE_AMOUNTS_KEY)
    if (!stored) return null

    const amounts = JSON.parse(stored)
    const amount = amounts[invoice]

    if (amount) {
      // Remove the amount after retrieval
      delete amounts[invoice]
      localStorage.setItem(NWC_INVOICE_AMOUNTS_KEY, JSON.stringify(amounts))
    }

    return amount || null
  } catch (error) {
    console.error('Failed to retrieve invoice amount:', error)
    return null
  }
}

/**
 * Clear all NWC data
 */
export function clearAllNWCData(): void {
  try {
    localStorage.removeItem(NWC_CONNECTIONS_KEY)
    localStorage.removeItem(NWC_PENDING_SECRET_KEY)
    localStorage.removeItem(NWC_INVOICE_AMOUNTS_KEY)
  } catch (error) {
    console.error('Failed to clear NWC data:', error)
  }
}
