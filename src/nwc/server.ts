import { finalizeEvent, getPublicKey, nip04, type Event as NostrEvent, Relay } from 'nostr-tools'
import { ServiceWorkerWallet } from '@arkade-os/sdk'
import { NWCConnection } from '../lib/types'
import { getConnections, updateLastUsed, updateConnectionPubkey, storeInvoiceAmount, retrieveInvoiceAmount } from './storage'
import { getBalance, sendOffChain, getReceivingAddresses } from '../lib/asp'
import { consoleError, consoleLog } from '../lib/logs'
import { isArkAddress } from '../lib/address'

// NIP-47 Event kinds
const NWC_INFO_KIND = 13194 // Wallet info/capabilities
const NWC_REQUEST_KIND = 23194
const NWC_RESPONSE_KIND = 23195

// NIP-47 Methods (adapted for Arkade)
type NWCMethod = 'pay_invoice' | 'get_balance' | 'get_info' | 'make_invoice'

interface NWCRequest {
  method: NWCMethod
  params: any
}

interface NWCResponse {
  result_type: NWCMethod
  result?: any
  error?: {
    code: string
    message: string
  }
}

interface NWCServerOptions {
  wallet: ServiceWorkerWallet
  privateKey: Uint8Array
  onPayment?: (address: string, amount: number, txid: string) => void
}

/**
 * NWC Server - Implements NIP-47 for Arkade Wallet
 * Enables Nostr apps to make Arkade zaps natively (no Lightning)
 */
export class NWCServer {
  private wallet: ServiceWorkerWallet
  private privateKey: Uint8Array
  private publicKey: string
  private relays: Map<string, Relay> = new Map()
  private connections: NWCConnection[] = []
  private running = false
  private onPayment?: (address: string, amount: number, txid: string) => void

  constructor(options: NWCServerOptions) {
    this.wallet = options.wallet
    this.privateKey = options.privateKey
    this.publicKey = getPublicKey(this.privateKey)
    this.onPayment = options.onPayment
  }

  /**
   * Start the NWC server
   */
  async start(): Promise<void> {
    if (this.running) {
      consoleLog('[NWC] Server already running')
      return
    }

    this.connections = getConnections()

    consoleLog(`[NWC] Starting Arkade NWC server with ${this.connections.length} connection(s)`)

    // Use multiple relays to avoid rate-limiting and improve reliability
    const defaultRelays = [
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.primal.net',
    ]

    const relaysToConnect = this.connections.length > 0
      ? [...new Set([...defaultRelays, ...this.connections.map((c) => c.relay)])]
      : defaultRelays

    consoleLog(`[NWC] Connecting to ${relaysToConnect.length} relay(s): ${relaysToConnect.join(', ')}`)

    for (const relayUrl of relaysToConnect) {
      try {
        await this.connectToRelay(relayUrl)
      } catch (error) {
        consoleError(error, `[NWC] Failed to connect to relay ${relayUrl}`)
      }
    }

    this.running = true
    consoleLog(`[NWC] ✓ Arkade NWC server started with ${this.relays.size} connected relay(s)`)

    // Publish wallet info event (kind 13194) to announce capabilities
    // This MUST be published even without connections for clients to discover the wallet
    await this.publishWalletInfo()
  }

  /**
   * Stop the NWC server
   */
  async stop(): Promise<void> {
    if (!this.running) return

    consoleLog('Stopping NWC server')
    for (const [url, relay] of this.relays.entries()) {
      try {
        await relay.close()
        this.relays.delete(url)
      } catch (error) {
        consoleError(error, `Failed to close relay ${url}`)
      }
    }

    this.running = false
    consoleLog('NWC server stopped')
  }

  /**
   * Reload connections from storage
   */
  async reload(): Promise<void> {
    consoleLog('[NWC] Reloading server...')
    await this.stop()
    consoleLog('[NWC] Server stopped, restarting...')
    await this.start()
    consoleLog('[NWC] Server reloaded')
  }

  /**
   * Get current connections
   */
  getConnections(): NWCConnection[] {
    return this.connections
  }

  /**
   * Publish NIP-47 wallet info event (kind 13194)
   * This announces the wallet's capabilities to clients
   */
  private async publishWalletInfo(): Promise<void> {
    try {
      const relaysList = [...this.relays.keys()]

      // Create wallet info event
      const infoEvent = finalizeEvent(
        {
          kind: NWC_INFO_KIND,
          tags: relaysList.map((relay) => ['relay', relay]),
          content: JSON.stringify({
            methods: ['pay_invoice', 'get_balance', 'get_info', 'make_invoice'],
            notifications: ['payment_received'],
          }),
          created_at: Math.floor(Date.now() / 1000),
        },
        this.privateKey,
      )

      // Publish to all relays
      const publishPromises = []
      for (const [url, relay] of this.relays.entries()) {
        const publishPromise = relay.publish(infoEvent)
        publishPromises.push(
          publishPromise.catch((error) => {
            consoleError(error, `[NWC] Failed to publish info to ${url}`)
          })
        )
      }

      await Promise.all(publishPromises)
      consoleLog('[NWC] ✓ Wallet info published')

      // Note: Verification disabled to avoid rate-limiting during development
      // The publish promises above will throw if there's an error anyway

    } catch (error) {
      consoleError(error, 'Failed to publish wallet info event')
    }
  }

  /**
   * Connect to a Nostr relay and start listening for requests
   */
  private async connectToRelay(relayUrl: string): Promise<void> {
    if (this.relays.has(relayUrl)) {
      consoleLog(`[NWC] Already connected to ${relayUrl}`)
      return
    }

    consoleLog(`[NWC] Connecting to relay ${relayUrl}...`)
    try {
      const relay = await Relay.connect(relayUrl)
      this.relays.set(relayUrl, relay)
      consoleLog(`[NWC] ✓ Connected to ${relayUrl}`)

      // Subscribe to NWC requests addressed to this wallet
      relay.subscribe(
        [
          {
            kinds: [NWC_REQUEST_KIND],
            '#p': [this.publicKey],
          },
        ],
        {
          onevent: (event: NostrEvent) => {
            this.handleRequest(event).catch((error) => {
              consoleError(error, 'Error handling NWC request')
            })
          },
        },
      )

      consoleLog(`[NWC] ✓ Subscribed to NWC requests on ${relayUrl}`)
    } catch (error) {
      consoleError(error, `[NWC] ✗ Failed to connect to ${relayUrl}`)
      throw error
    }
  }

  /**
   * Handle incoming NWC request
   */
  private async handleRequest(event: NostrEvent): Promise<void> {
    try {
      // Find connection for this client
      let connection = this.connections.find((c) => c.clientPubkey === event.pubkey)

      if (!connection) {
        // Check if this is a new client using an unused connection
        // (client pubkey might differ from derived pubkey - some clients use their user pubkey)
        const unusedConnection = this.connections.find((c) => !c.lastUsed)
        if (unusedConnection) {
          consoleLog(`[NWC] New connection paired from ${event.pubkey.substring(0, 8)}...`)

          // Update the connection with the actual client pubkey
          updateConnectionPubkey(unusedConnection.id, event.pubkey)

          // Update our in-memory copy
          unusedConnection.clientPubkey = event.pubkey
          connection = unusedConnection

          // Reload connections from storage to ensure consistency
          this.connections = getConnections()
        } else {
          consoleLog(`[NWC] Rejecting request from unknown client`)
          return
        }
      }

      // Decrypt request content using NIP-04
      const decryptedContent = await nip04.decrypt(this.privateKey, event.pubkey, event.content)
      const request: NWCRequest = JSON.parse(decryptedContent)

      consoleLog(`[NWC] ${request.method} from ${connection.name || 'client'}`)

      // Update last used timestamp
      updateLastUsed(event.pubkey)

      // Check if method is allowed
      if (!connection.permissions.includes(request.method)) {
        await this.sendErrorResponse(event, connection, 'UNAUTHORIZED', 'Method not permitted')
        return
      }

      // Process request based on method
      let response: NWCResponse
      switch (request.method) {
        case 'pay_invoice':
          response = await this.handlePayInvoice(request.params, event)
          break
        case 'get_balance':
          response = await this.handleGetBalance()
          break
        case 'get_info':
          response = await this.handleGetInfo()
          break
        case 'make_invoice':
          response = await this.handleMakeInvoice(request.params)
          break
        default:
          response = {
            result_type: request.method,
            error: {
              code: 'NOT_IMPLEMENTED',
              message: `Method ${request.method} not implemented`,
            },
          }
      }

      // Send response
      await this.sendResponse(event, connection, response)
    } catch (error) {
      consoleError(error, 'Error processing NWC request')
    }
  }

  /**
   * Handle pay_invoice command
   * Note: "invoice" is actually an Arkade address (ark1...) for Arkade Zaps
   */
  private async handlePayInvoice(params: any, event: NostrEvent): Promise<NWCResponse> {
    try {
      const { invoice, amount } = params

      // "invoice" is actually an Arkade address for native Arkade zaps
      const arkadeAddress = invoice

      if (!arkadeAddress) {
        return {
          result_type: 'pay_invoice',
          error: {
            code: 'OTHER',
            message: 'Arkade address is required',
          },
        }
      }

      // Validate it's an Arkade address
      if (!isArkAddress(arkadeAddress)) {
        consoleLog(`[NWC] Invalid Arkade address: ${arkadeAddress}`)
        return {
          result_type: 'pay_invoice',
          error: {
            code: 'OTHER',
            message: 'Invalid Arkade address',
          },
        }
      }

      // Check amount - NIP-47 specifies amounts are in millisats
      let amountSats: number | undefined

      // Try 'amount' field first (should be in millisats per NIP-47)
      if (amount) {
        amountSats = Math.floor(amount / 1000)
      }
      // Fallback to 'amount_msat' field
      else if (params.amount_msat) {
        amountSats = Math.floor(params.amount_msat / 1000)
      }

      // If no amount provided, check if we stored it during make_invoice
      if (!amountSats || amountSats <= 0) {
        const storedAmount = retrieveInvoiceAmount(arkadeAddress)
        if (storedAmount) {
          amountSats = storedAmount
        } else {
          return {
            result_type: 'pay_invoice',
            error: {
              code: 'OTHER',
              message: 'Amount is required',
            },
          }
        }
      }

      consoleLog(`[NWC] Sending ${amountSats} sats to ${arkadeAddress.substring(0, 20)}...`)

      // Send Arkade vtxos directly (no Lightning/Boltz involved)
      const txid = await sendOffChain(this.wallet, amountSats, arkadeAddress)

      if (!txid) {
        throw new Error('Failed to send Arkade payment')
      }

      // Notify callback
      if (this.onPayment) {
        this.onPayment(arkadeAddress, amountSats, txid)
      }

      consoleLog(`[NWC] ✓ Payment sent: ${txid}`)

      return {
        result_type: 'pay_invoice',
        result: {
          preimage: txid, // Return vtxo txid as "preimage" for NIP-47 compatibility
        },
      }
    } catch (error: any) {
      consoleError(error, 'Error sending Arkade payment')
      return {
        result_type: 'pay_invoice',
        error: {
          code: 'PAYMENT_FAILED',
          message: error.message || 'Payment failed',
        },
      }
    }
  }

  /**
   * Handle get_balance command
   */
  private async handleGetBalance(): Promise<NWCResponse> {
    try {
      const balance = await getBalance(this.wallet)

      // Convert sats to millisats for NIP-47 compliance
      const balanceMsats = balance * 1000

      return {
        result_type: 'get_balance',
        result: {
          balance: balanceMsats,
        },
      }
    } catch (error: any) {
      consoleError(error, 'Error getting balance')
      return {
        result_type: 'get_balance',
        error: {
          code: 'INTERNAL',
          message: error.message || 'Failed to get balance',
        },
      }
    }
  }

  /**
   * Handle get_info command
   */
  private async handleGetInfo(): Promise<NWCResponse> {
    return {
      result_type: 'get_info',
      result: {
        alias: 'Arkade Wallet',
        color: '#FF6B35',
        pubkey: this.publicKey,
        network: 'arkade',
        block_height: 0,
        block_hash: '',
        methods: ['pay_invoice', 'get_balance', 'get_info', 'make_invoice'],
      },
    }
  }

  /**
   * Handle make_invoice command
   * Returns an Arkade receiving address instead of a Lightning invoice
   */
  private async handleMakeInvoice(params: any): Promise<NWCResponse> {
    try {
      // Get Arkade receiving address
      const addresses = await getReceivingAddresses(this.wallet)
      const arkadeAddress = addresses.offchainAddr

      // Extract amount from params
      let amountSats = params?.amount
      if (!amountSats && params?.amount_msat) {
        amountSats = Math.floor(params.amount_msat / 1000)
      }

      // Store the amount for later use in pay_invoice
      // This is needed because Arkade addresses don't encode amounts like Lightning invoices
      if (amountSats && amountSats > 0) {
        storeInvoiceAmount(arkadeAddress, amountSats)
      }

      return {
        result_type: 'make_invoice',
        result: {
          type: 'incoming',
          invoice: arkadeAddress, // Return Arkade address as "invoice"
          description: params?.description || 'Arkade Wallet Receive Address',
          description_hash: null,
          preimage: null,
          payment_hash: null,
          amount: amountSats || 0, // Return the requested amount
          fees_paid: 0,
          created_at: Math.floor(Date.now() / 1000),
          expires_at: 0, // Arkade addresses don't expire
          metadata: {
            arkade: true,
          },
        },
      }
    } catch (error: any) {
      consoleError(error, 'Error creating Arkade receive address')
      return {
        result_type: 'make_invoice',
        error: {
          code: 'INTERNAL',
          message: error.message || 'Failed to create receive address',
        },
      }
    }
  }

  /**
   * Send response to client
   */
  private async sendResponse(requestEvent: NostrEvent, connection: NWCConnection, response: NWCResponse): Promise<void> {
    try {
      // Encrypt response content
      const encryptedContent = await nip04.encrypt(this.privateKey, connection.clientPubkey, JSON.stringify(response))

      // Create response event
      const responseEvent = finalizeEvent(
        {
          kind: NWC_RESPONSE_KIND,
          tags: [
            ['p', connection.clientPubkey],
            ['e', requestEvent.id],
          ],
          content: encryptedContent,
          created_at: Math.floor(Date.now() / 1000),
        },
        this.privateKey,
      )

      // Publish to relay
      const relay = this.relays.get(connection.relay)
      if (relay) {
        await relay.publish(responseEvent)
        consoleLog('Response sent successfully')
      }
    } catch (error) {
      consoleError(error, 'Error sending response')
    }
  }

  /**
   * Send error response to client
   */
  private async sendErrorResponse(
    requestEvent: NostrEvent,
    connection: NWCConnection,
    code: string,
    message: string,
  ): Promise<void> {
    const response: NWCResponse = {
      result_type: 'pay_invoice',
      error: { code, message },
    }
    await this.sendResponse(requestEvent, connection, response)
  }
}
