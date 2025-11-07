import { IonBadge } from '@ionic/react'

interface BadgeProps {
  children: React.ReactNode
  color?: string
  variant?: 'solid' | 'outline'
}

export default function Badge({ children, color = 'primary', variant = 'solid' }: BadgeProps) {
  const style: React.CSSProperties = {
    fontSize: '0.7rem',
    fontWeight: 600,
    padding: '0.25rem 0.5rem',
    borderRadius: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    ...(variant === 'outline'
      ? {
          background: 'transparent',
          border: '1px solid var(--ion-color-primary)',
          color: 'var(--ion-color-primary)',
        }
      : {}),
  }

  return (
    <IonBadge color={color} style={style}>
      {children}
    </IonBadge>
  )
}
