import type { CSSProperties } from 'react'

export type LogoVariant = 'mark' | 'wordmark' | 'stacked'
export type LogoTone = 'dark' | 'light'

interface LogoProps {
  variant?: LogoVariant
  tone?: LogoTone
  /** Rendered width; height follows the source artwork's aspect ratio. */
  size?: number | string
  alt?: string
  decorative?: boolean
  className?: string
}

const sources: Record<LogoTone, Record<LogoVariant, string>> = {
  dark: { mark: '/brand/airem-mark.svg', wordmark: '/brand/airem-wordmark.svg', stacked: '/brand/airem-stacked.svg' },
  light: { mark: '/brand/airem-mark.svg', wordmark: '/brand/airem-wordmark-light.svg', stacked: '/brand/airem-stacked-light.svg' },
}

const defaultSizes: Record<LogoVariant, string> = { mark: '2rem', wordmark: '7.5rem', stacked: '9rem' }

export function Logo({ variant = 'wordmark', tone = 'dark', size, alt = 'Airem', decorative = false, className }: LogoProps) {
  const style = { '--logo-width': typeof size === 'number' ? `${size}px` : size ?? defaultSizes[variant] } as CSSProperties

  return <img className={['brand-logo', `brand-logo--${variant}`, className].filter(Boolean).join(' ')} src={sources[tone][variant]} alt={decorative ? '' : alt} aria-hidden={decorative || undefined} style={style} />
}
