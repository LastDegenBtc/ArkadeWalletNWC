import { useState, useEffect, useContext } from 'react'
import { useIonToast } from '@ionic/react'
import Button from '../../components/Button'
import Padded from '../../components/Padded'
import Content from '../../components/Content'
import Header from './Header'
import Text, { TextSecondary } from '../../components/Text'
import FlexCol from '../../components/FlexCol'
import QrCode from '../../components/QrCode'
import { copyToClipboard } from '../../lib/clipboard'
import { copiedToClipboard } from '../../lib/toast'
import Shadow from '../../components/Shadow'
import { NWCContext } from '../../providers/nwc'
import { generatePairingUrl, reconstructPairingUrl } from '../../nwc/pairing'
import { removeConnection, getUnusedConnection } from '../../nwc/storage'
import { getPrivateKey } from '../../lib/privateKey'
import { defaultPassword } from '../../lib/constants'
import { consoleError, consoleLog } from '../../lib/logs'
import Loading from '../../components/Loading'

export default function WalletConnect() {
  const [present] = useIonToast()
  const { connections, reloadServer } = useContext(NWCContext)

  const [pairingUrl, setPairingUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const initPairing = async () => {
      try {
        setLoading(true)
        // Get wallet private key to generate pairing URL
        const privateKey = await getPrivateKey(defaultPassword)

        // Check if there's already an unused connection
        const unusedConnection = getUnusedConnection()

        let url: string
        if (unusedConnection) {
          // Reuse the existing unused connection instead of creating a new one
          consoleLog('[WalletConnect] Found unused connection, reusing it:', unusedConnection.id)
          url = reconstructPairingUrl(privateKey, unusedConnection)
        } else {
          // No unused connection, create a new one
          consoleLog('[WalletConnect] No unused connection found, creating new one')
          const result = await generatePairingUrl(privateKey)
          url = result.url

          // Reload server to pick up the new connection
          await reloadServer()
        }

        setPairingUrl(url)
      } catch (error) {
        consoleError(error, 'Failed to generate pairing URL')
        setError('Failed to initialize Wallet Connect')
      } finally {
        setLoading(false)
      }
    }

    initPairing()
  }, [])

  const handleCopyUrl = async () => {
    if (!pairingUrl) return
    await copyToClipboard(pairingUrl)
    present(copiedToClipboard)
  }

  const handleDisconnect = async (connectionId: string) => {
    try {
      // Remove connection from storage
      removeConnection(connectionId)

      // Reload the NWC server to apply changes
      await reloadServer()

      present({
        message: 'App disconnected',
        duration: 2000,
        color: 'success',
      })
    } catch (error) {
      consoleError(error, 'Failed to disconnect app')
      present({
        message: 'Failed to disconnect app',
        duration: 2000,
        color: 'danger',
      })
    }
  }

  const handleRefresh = async () => {
    try {
      setLoading(true)
      await reloadServer()
    } catch (error) {
      consoleError(error, 'Failed to refresh connections')
    } finally {
      setLoading(false)
    }
  }

  const handleGenerateNew = async () => {
    try {
      setLoading(true)
      consoleLog('[WalletConnect] Generating new connection manually')
      const privateKey = await getPrivateKey(defaultPassword)
      const { url } = await generatePairingUrl(privateKey)
      setPairingUrl(url)

      // Reload server to pick up the new connection
      await reloadServer()

      present({
        message: 'New pairing QR code generated',
        duration: 2000,
        color: 'success',
      })
    } catch (error) {
      consoleError(error, 'Failed to generate new pairing')
      present({
        message: 'Failed to generate new pairing',
        duration: 2000,
        color: 'danger',
      })
    } finally {
      setLoading(false)
    }
  }

  if (loading && !pairingUrl) {
    return (
      <>
        <Header text='Wallet Connect' back />
        <Content>
          <Padded>
            <Loading text='Loading Wallet Connect...' />
          </Padded>
        </Content>
      </>
    )
  }

  if (error) {
    return (
      <>
        <Header text='Wallet Connect' back />
        <Content>
          <Padded>
            <Text color='danger'>{error}</Text>
          </Padded>
        </Content>
      </>
    )
  }

  return (
    <>
      <Header text='Wallet Connect' back />
      <Content>
        <Padded>
          <FlexCol gap='1.5rem'>
            {/* Section QR Code de pairing */}
            <FlexCol gap='0.5rem'>
              <Text capitalize color='dark50'>
                Connect a Nostr app
              </Text>
              <TextSecondary>
                Scan this QR code with a Nostr app to enable <strong>Arkade Zaps</strong> - native Bitcoin payments
                using Arkade vtxos instead of Lightning
              </TextSecondary>
              <QrCode value={pairingUrl} />

              {/* Display pairing URL in a text field */}
              <div style={{ width: '100%' }}>
                <textarea
                  readOnly
                  value={pairingUrl}
                  style={{
                    width: '100%',
                    minHeight: '80px',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    padding: '8px',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    resize: 'vertical',
                    wordBreak: 'break-all',
                  }}
                  onClick={(e) => e.currentTarget.select()}
                />
              </div>

              <Button onClick={handleCopyUrl} label='Copy pairing URL' secondary />
              <Button onClick={handleGenerateNew} label='Generate new QR code' secondary small />
            </FlexCol>

            {/* Section Apps connectées */}
            <FlexCol gap='0.5rem'>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Text capitalize color='dark50'>
                  Connected apps
                </Text>
                {connections.length > 0 && <Button onClick={handleRefresh} label='Refresh' secondary small />}
              </div>
              {connections.length === 0 ? (
                <TextSecondary>
                  No apps connected yet. Scan the QR code above with a compatible Nostr app to enable Arkade Zaps.
                </TextSecondary>
              ) : (
                <FlexCol gap='0.5rem'>
                  {connections.map((conn) => (
                    <Shadow key={conn.id}>
                      <div
                        style={{
                          padding: '1rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.5rem',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <Text>{conn.name || 'Nostr App'}</Text>
                          <Button onClick={() => handleDisconnect(conn.id)} label='Disconnect' secondary small />
                        </div>
                        <Text small color='dark50'>
                          {conn.clientPubkey.substring(0, 16)}...
                        </Text>
                        <TextSecondary small>
                          Connected {new Date(conn.createdAt).toLocaleDateString()}
                          {conn.lastUsed ? ` • Last used ${new Date(conn.lastUsed).toLocaleDateString()}` : ''}
                        </TextSecondary>
                      </div>
                    </Shadow>
                  ))}
                </FlexCol>
              )}
            </FlexCol>

            {/* Section informations */}
            <FlexCol gap='0.5rem'>
              <Text capitalize color='dark50'>
                What are Arkade Zaps?
              </Text>
              <TextSecondary small>
                Arkade Zaps are Nostr zaps powered by Arkade instead of Lightning. When you zap someone, you send
                Bitcoin via Arkade vtxos - instant, private, and on-chain compatible.
              </TextSecondary>
              <TextSecondary small>
                This uses NIP-47 (Nostr Wallet Connect) with Arkade addresses instead of Lightning invoices. You can
                disconnect apps at any time.
              </TextSecondary>
            </FlexCol>
          </FlexCol>
        </Padded>
      </Content>
    </>
  )
}
