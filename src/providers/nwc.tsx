import { ReactNode, createContext, useContext, useEffect, useRef, useState } from 'react'
import { NWCServer } from '../nwc/server'
import { WalletContext } from './wallet'
import { getPrivateKey } from '../lib/privateKey'
import { defaultPassword } from '../lib/constants'
import { consoleError, consoleLog } from '../lib/logs'
import { getConnections } from '../nwc/storage'
import { NWCConnection } from '../lib/types'

interface NWCContextProps {
  server: NWCServer | null
  connections: NWCConnection[]
  isRunning: boolean
  startServer: () => Promise<void>
  stopServer: () => Promise<void>
  reloadServer: () => Promise<void>
}

export const NWCContext = createContext<NWCContextProps>({
  server: null,
  connections: [],
  isRunning: false,
  startServer: async () => {},
  stopServer: async () => {},
  reloadServer: async () => {},
})

export const NWCProvider = ({ children }: { children: ReactNode }) => {
  const { svcWallet } = useContext(WalletContext)

  const [server, setServer] = useState<NWCServer | null>(null)
  const [connections, setConnections] = useState<NWCConnection[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const initializingRef = useRef(false)

  // Initialize NWC server when wallet is ready
  useEffect(() => {
    if (!svcWallet || initializingRef.current) return

    const initServer = async () => {
      try {
        initializingRef.current = true
        consoleLog('Initializing Arkade NWC server')

        // Get wallet private key
        const privateKey = await getPrivateKey(defaultPassword)

        // Create NWC server instance for Arkade
        const nwcServer = new NWCServer({
          wallet: svcWallet,
          privateKey,
          onPayment: (address, amount, txid) => {
            consoleLog(`Arkade zap sent: ${amount} sats to ${address.substring(0, 16)}... (txid: ${txid})`)
            // Could trigger notifications here
          },
        })

        setServer(nwcServer)

        // Load connections
        const conns = getConnections()
        setConnections(conns)

        // ALWAYS start the server (even without connections)
        // This is required to publish the kind 13194 info event
        // so clients can discover wallet capabilities
        await nwcServer.start()
        setIsRunning(true)
      } catch (error) {
        consoleError(error, 'Failed to initialize Arkade NWC server')
      } finally {
        initializingRef.current = false
      }
    }

    initServer()

    // Cleanup on unmount
    return () => {
      if (server) {
        server.stop().catch(consoleError)
      }
    }
  }, [svcWallet])

  const startServer = async () => {
    if (!server || isRunning) return
    try {
      await server.start()
      setIsRunning(true)
    } catch (error) {
      consoleError(error, 'Failed to start Arkade NWC server')
      throw error
    }
  }

  const stopServer = async () => {
    if (!server || !isRunning) return
    try {
      await server.stop()
      setIsRunning(false)
    } catch (error) {
      consoleError(error, 'Failed to stop Arkade NWC server')
      throw error
    }
  }

  const reloadServer = async () => {
    if (!server) return
    try {
      await server.reload()
      const conns = getConnections()
      setConnections(conns)
      setIsRunning(conns.length > 0)
    } catch (error) {
      consoleError(error, 'Failed to reload Arkade NWC server')
      throw error
    }
  }

  return (
    <NWCContext.Provider
      value={{
        server,
        connections,
        isRunning,
        startServer,
        stopServer,
        reloadServer,
      }}
    >
      {children}
    </NWCContext.Provider>
  )
}
