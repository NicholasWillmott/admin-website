/* @refresh reload */
import { render } from 'solid-js/web'
import './css/index.css'
import App from '../frontend/App.tsx'
import { ClerkProvider } from 'clerk-solidjs'

const root = document.getElementById('root')

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!publishableKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY')
}

render(() => (
  <ClerkProvider publishableKey={publishableKey}>
    <App />
  </ClerkProvider>
), root!)
