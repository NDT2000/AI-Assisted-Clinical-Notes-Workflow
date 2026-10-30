import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  RouterProvider,
} from "react-router-dom";

import App from "./App.tsx";
import "./index.css";

async function enableMocking(): Promise<void> {
  if (!import.meta.env.DEV) {
    return;
  }

  const { worker } = await import(
    "./mock-server/browser.ts"
  );

  await worker.start({
    onUnhandledRequest(
      request,
      print,
    ) {
      const url = new URL(request.url);

      if (
        url.origin ===
          window.location.origin &&
        !url.pathname.startsWith(
          "/api/",
        )
      ) {
        return;
      }

      print.warning();
    },
  });
}

await enableMocking();

// A data router is required for useBlocker (unsaved-changes guard).
// App keeps its own <Routes>, so it is mounted under a catch-all route.
const router = createBrowserRouter([
  {
    path: "*",
    element: <App />,
  },
]);

createRoot(
  document.getElementById("root")!,
).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);