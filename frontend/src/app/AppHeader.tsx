import { useState } from "react";

import { useCurrentActor } from "../auth/useCurrentActor";
import { useOfflineSaveReplaySnapshot } from "../features/notes/offline/useOfflineSaveReplaySnapshot";
import { formatRole } from "../shared/formatters";
import "./AppHeader.css";
import { signOutAndClear } from "./signOut";

interface AppHeaderProps {
  signOut?: () => Promise<void>;
}

export function AppHeader({ signOut = signOutAndClear }: AppHeaderProps) {
  const { actor } = useCurrentActor();
  const { pendingCount } = useOfflineSaveReplaySnapshot();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function finishSignOut() {
    setIsSigningOut(true);
    await signOut();
  }

  function handleSignOut() {
    // Signing out clears this browser's offline queue: warn first.
    if (pendingCount > 0) {
      setIsConfirming(true);
      return;
    }

    void finishSignOut();
  }

  const changes =
    pendingCount === 1 ? "1 change" : `${pendingCount} changes`;

  return (
    <header className="app-header">
      <p className="app-header__name">Clinical Notes Workspace</p>

      <div className="app-header__user">
        <p>
          Signed in as <strong>{actor.displayName}</strong>
          <span className="app-header__role">{formatRole(actor.role)}</span>
        </p>

        {!isConfirming && (
          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
          >
            {isSigningOut ? "Signing out…" : "Sign out"}
          </button>
        )}
      </div>

      {isConfirming && (
        <div className="app-header__confirm" role="alert">
          <p>
            {changes} saved offline {pendingCount === 1 ? "has" : "have"} not
            reached the server yet. Signing out deletes{" "}
            {pendingCount === 1 ? "it" : "them"} from this browser.
          </p>
          <div>
            <button
              type="button"
              onClick={() => void finishSignOut()}
              disabled={isSigningOut}
            >
              Sign out anyway
            </button>
            <button
              type="button"
              onClick={() => setIsConfirming(false)}
              disabled={isSigningOut}
            >
              Stay signed in
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
