import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  RouterProvider,
} from "react-router-dom";

import App from "./App.tsx";
import { USE_MOCK_API } from "./api/apiConfig.ts";
import "./index.css";

// The in-browser mock server answers only when mocks are on (see
// api/apiConfig.ts); otherwise requests go to the API.
async function enableMocking(): Promise<void> {
  if (!USE_MOCK_API) {
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