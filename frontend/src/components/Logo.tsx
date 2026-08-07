import { Sparkles } from 'lucide-react'

export function Logo({ compact = false }: { compact?: boolean }) {
  return <div className="logo"><span className="logo-mark"><Sparkles size={17} aria-hidden="true" /></span>{!compact && <span>Airem</span>}</div>
}
