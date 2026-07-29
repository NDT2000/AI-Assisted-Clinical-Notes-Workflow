import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { BrowserRouter } from 'react-router-dom'

async function enableMocking(): Promise<void> {
  if(!import.meta.env.DEV) {
    return;
  }

  const { worker } = await import("./mock-server/browser.ts");

  await worker.start({
    onUnhandledRequest: "warn",
  });
}

await enableMocking();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Browser makes the Route and Routes property of react to work and give the context where we are in the URL */}
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
