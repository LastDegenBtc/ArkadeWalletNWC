import { getPublicKey } from 'nostr-tools'
import { hex } from '@scure/base'
import { NWCConnection } from '../lib/types'
import { addConnection } from './storage'

// Use multiple relays to avoid rate-limiting and improve reliability
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
]

const DEFAULT_RELAY = DEFAULT_RELAYS[0]

/**
 * Generate a random 32-byte secret for NWC connection
 */
export function generateSecret(): string {
  const secret = crypto.getRandomValues(new Uint8Array(32))
  return hex.encode(secret)
}

/**
 * SHA-256 hash using Web Crypto API
 */
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return new Uint8Array(hashBuffer)
}

/**
 * Derive client keypair from secret (NIP-47 spec)
 * client_privkey = sha256(secret)
 * client_pubkey = get_public_key(client_privkey)
 */
export async function deriveClientKeypair(secret: string): Promise<{ privkey: Uint8Array; pubkey: string }> {
  const secretBytes = hex.decode(secret)
  const privkey = await sha256(secretBytes)
  const pubkey = getPublicKey(privkey)
  return { privkey, pubkey }
}

/**
 * Reconstruct a pairing URL from an existing connection
 * @param walletPrivateKey - The wallet's Nostr private key (32 bytes)
 * @param connection - Existing NWC connection
 * @returns Pairing URL
 */
export function reconstructPairingUrl(walletPrivateKey: Uint8Array, connection: NWCConnection): string {
  const walletPubkey = getPublicKey(walletPrivateKey)
  const params = new URLSearchParams()
  params.set('relay', connection.relay)
  params.set('secret', connection.secret)
  return `nostr+walletconnect://${walletPubkey}?${params.toString()}`
}

/**
 * Generate a pairing URL AND create the connection in storage
 * This is the main function to use when creating a new pairing
 *
 * Note: We create a connection with a placeholder client pubkey.
 * The actual client pubkey will be updated on first request, since some clients
 * use their user pubkey instead of deriving one from the secret.
 *
 * @param walletPrivateKey - The wallet's Nostr private key (32 bytes)
 * @param relay - Optional relay URL (defaults to wss://relay.damus.io)
 * @returns Object with pairing URL and the created connection
 */
export async function generatePairingUrl(
  walletPrivateKey: Uint8Array,
  relay: string = DEFAULT_RELAY,
): Promise<{ url: string; connection: NWCConnection }> {
  const walletPubkey = getPublicKey(walletPrivateKey)
  const secret = generateSecret()

  // Derive the expected client pubkey from the secret (NIP-47 spec)
  // This might not be the actual pubkey used by the client (some use their user pubkey)
  // We'll update it on first request if needed
  const { pubkey: clientPubkey } = await deriveClientKeypair(secret)

  // Create the connection in storage
  const connection = createConnection(clientPubkey, secret, relay, 'Nostr App')
  addConnection(connection)

  // Generate the pairing URL (NIP-47 format)
  const params = new URLSearchParams()
  params.set('relay', relay)
  params.set('secret', secret)
  const url = `nostr+walletconnect://${walletPubkey}?${params.toString()}`

  return {
    url,
    connection,
  }
}

/**
 * Parse a pairing URL and extract connection details
 * @param pairingUrl - The NWC pairing URL
 * @returns Connection details or null if invalid
 */
export function parsePairingUrl(pairingUrl: string): {
  walletPubkey: string
  relay: string
  secret: string
} | null {
  try {
    // Handle both nostr+walletconnect:// and regular parsing
    const url = pairingUrl.replace('nostr+walletconnect://', 'https://')
    const parsed = new URL(url)

    const walletPubkey = parsed.hostname
    const relay = parsed.searchParams.get('relay')
    const secret = parsed.searchParams.get('secret')

    if (!walletPubkey || !relay || !secret) {
      return null
    }

    return { walletPubkey, relay, secret }
  } catch (error) {
    console.error('Failed to parse pairing URL:', error)
    return null
  }
}

/**
 * Create a new NWC connection from pairing details
 * @param clientPubkey - The client's public key
 * @param secret - The shared secret
 * @param relay - The relay URL
 * @param name - Optional name for the connection
 * @returns NWCConnection object
 */
export function createConnection(
  clientPubkey: string,
  secret: string,
  relay: string,
  name?: string,
): NWCConnection {
  return {
    id: crypto.randomUUID(),
    clientPubkey,
    secret,
    relay,
    name,
    createdAt: Date.now(),
    permissions: ['pay_invoice', 'get_balance', 'get_info', 'make_invoice', 'lookup_invoice'],
  }
}
