import { ArrowRight, BarChart3, CreditCard, FilePlus2, Files, Settings } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
const config: Record<string, {title:string; copy:string; icon: typeof Files}> = {
  '/app/rewrite': { title:'Create a new rewrite', copy:'Paste or upload your content, then choose how you want it to sound.', icon:FilePlus2 },
  '/app/documents': { title:'Your documents', copy:'Rewrites and saved drafts will be organized here.', icon:Files },
  '/app/reports': { title:'Writing reports', copy:'Track clarity, tone, and rewriting activity over time.', icon:BarChart3 },
  '/app/billing': { title:'Usage & plan', copy:'Review your word allowance and informational plan metadata. Billing is not enabled.', icon:CreditCard },
  '/app/settings': { title:'Workspace settings', copy:'Manage your profile, preferences, and security.', icon:Settings },
}
export function Placeholder() { const path = useLocation().pathname; const item = config[path]; const Icon=item.icon; return <section className="placeholder card"><span><Icon size={25}/></span><p className="eyebrow">Workspace</p><h2>{item.title}</h2><p>{item.copy}</p>{path !== '/app/rewrite' && <Link to="/app/rewrite" className="button primary">Start a rewrite <ArrowRight size={16}/></Link>}</section> }
