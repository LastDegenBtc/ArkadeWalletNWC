import { useContext, useEffect, useState } from 'react'
import { AspContext } from '../../providers/asp'
import Header from './Header'
import Table from '../../components/Table'
import Padded from '../../components/Padded'
import Content from '../../components/Content'
import { gitCommit } from '../../_gitCommit'
import { prettyDelta } from '../../lib/format'
import FlexCol from '../../components/FlexCol'
import ErrorMessage from '../../components/Error'
import Badge from '../../components/Badge'
import Text from '../../components/Text'

export default function About() {
  const { aspInfo } = useContext(AspContext)

  const [error, setError] = useState(false)

  useEffect(() => {
    setError(aspInfo.unreachable)
  }, [aspInfo.unreachable])

  const data = [
    ['Server URL', aspInfo.url],
    ['Server pubkey', aspInfo.signerPubkey],
    ['Forfeit address', aspInfo.forfeitAddress],
    ['Network', aspInfo.network],
    ['Dust', `${aspInfo.dust} SATS`],
    ['Session duration', prettyDelta(Number(aspInfo.sessionDuration), true)],
    ['Boarding exit delay', prettyDelta(Number(aspInfo.boardingExitDelay), true)],
    ['Unilateral exit delay', prettyDelta(Number(aspInfo.unilateralExitDelay), true)],
    ['Git commit hash', gitCommit],
  ]

  return (
    <>
      <Header text='About' back />
      <Content>
        <Padded>
          <FlexCol gap='1rem'>
            <FlexCol gap='0.5rem' style={{ alignItems: 'center', padding: '1rem 0' }}>
              <Text bold style={{ fontSize: '1.1rem' }}>
                Purple Arkade Wallet
              </Text>
              <Badge color='secondary'>NWC Edition</Badge>
              <Text small color='dark80' centered style={{ marginTop: '0.5rem' }}>
                Nostr Wallet Connect (NIP-47) enabled
              </Text>
              <Text small color='dark80' centered>
                Native Arkade Zaps • No Lightning Required
              </Text>
            </FlexCol>
            <ErrorMessage error={error} text='Ark server unreachable' />
            <Table data={data} />
          </FlexCol>
        </Padded>
      </Content>
    </>
  )
}
