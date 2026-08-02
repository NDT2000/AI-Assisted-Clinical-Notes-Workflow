import {
  useLocation,
  useNavigate,
} from "react-router-dom";

import type {
  UserRole,
} from "../domain/noteAttributes";
import {
  DEMO_ACTORS,
} from "./currentActor";
import {
  useCurrentActor,
} from "./CurrentActorContext";
import "./CurrentActorSwitcher.css";

function getRoleLabel(
  role: UserRole,
): string {
  switch (role) {
    case "CLINICIAN":
      return "Clinician";
    case "REVIEWER":
      return "Reviewer";
    case "ADMIN":
      return "Administrator";
    case "READONLY_AUDITOR":
      return "Read-only auditor";
  }
}

export function CurrentActorSwitcher() {
  const {
    actor,
    setActorById,
  } = useCurrentActor();

  const location = useLocation();
  const navigate = useNavigate();

  function handleActorChange(
    actorId: string,
  ) {
    if (actorId === actor.id) {
      return;
    }

    setActorById(actorId);

    if (
      location.pathname.startsWith(
        "/notes/",
      )
    ) {
      navigate("/notes");
    }
  }

  return (
    <header className="demo-actor-bar">
      <div className="demo-actor-bar__identity">
        <p className="demo-actor-bar__eyebrow">
          Clinical Notes Workspace
        </p>

        <p className="demo-actor-bar__title">
          Demo identity
        </p>
      </div>

      <div className="demo-actor-bar__control">
        <label
          htmlFor="demo-actor"
        >
          Viewing as
        </label>

        <select
          id="demo-actor"
          value={actor.id}
          onChange={(event) =>
            handleActorChange(
              event.target.value,
            )
          }
        >
          {DEMO_ACTORS.map(
            (candidate) => (
              <option
                key={candidate.id}
                value={candidate.id}
              >
                {
                  candidate.displayName
                }
                {" — "}
                {
                  getRoleLabel(
                    candidate.role,
                  )
                }
              </option>
            ),
          )}
        </select>

        <p
          className="demo-actor-bar__status"
          role="status"
          aria-live="polite"
        >
          Role:{" "}
          <strong>
            {
              getRoleLabel(
                actor.role,
              )
            }
          </strong>
          . Each browser tab keeps
          its own demo identity.
        </p>
      </div>
    </header>
  );
}
