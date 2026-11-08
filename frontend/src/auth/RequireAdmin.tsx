import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useCurrentActor } from "./useCurrentActor";

/*
 * Administrator pages. Anyone else is taken to the notes, as if the page
 * did not exist; the API refuses them in any case.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { actor } = useCurrentActor();

  return actor.role === "ADMIN" ? children : <Navigate to="/notes" replace />;
}
