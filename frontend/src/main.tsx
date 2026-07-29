import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { BrowserRouter } from 'react-router-dom'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Browser makes the Route and Routes property of react to work and give the context where we are in the URL */}
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
