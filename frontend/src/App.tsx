import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { Auth } from './pages/Auth'
import { Dashboard } from './pages/Dashboard'
import { Landing } from './pages/Landing'
import { Placeholder } from './pages/Placeholder'
export default function App() { return <Routes><Route path="/" element={<Landing/>}/><Route path="/login" element={<Auth/>}/><Route path="/register" element={<Auth/>}/><Route path="/forgot-password" element={<Auth/>}/><Route path="/app" element={<AppShell/>}><Route index element={<Dashboard/>}/><Route path="rewrite" element={<Placeholder/>}/><Route path="documents" element={<Placeholder/>}/><Route path="reports" element={<Placeholder/>}/><Route path="billing" element={<Placeholder/>}/><Route path="settings" element={<Placeholder/>}/></Route><Route path="*" element={<Navigate to="/" replace/>}/></Routes> }
