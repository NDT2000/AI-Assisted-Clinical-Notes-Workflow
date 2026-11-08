import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { useCurrentActor } from "../../../auth/useCurrentActor";
import type { UserRole } from "../../../domain/noteAttributes";
import { formatDateTime, formatRole } from "../../../shared/formatters";
import { describeEvent, formatAccountStatus } from "../accountText";
import * as defaultApi from "../api/usersApi";
import {
  UsersApiError,
  type SetupLink,
  type UserDetail,
} from "../api/usersApi";
import { SetupLinkNotice } from "../components/SetupLinkNotice";
import { reviewerDirectory } from "../reviewerDirectory";
import { ROLES } from "../roles";
import "../Users.css";

type UsersApi = Pick<
  typeof defaultApi,
  | "getUser"
  | "updateUser"
  | "deactivateUser"
  | "reactivateUser"
  | "issueSetupLink"
>;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: UserDetail };

type Deactivation =
  | { step: "idle" }
  | { step: "confirm" }
  | { step: "openReviews"; message: string };

function messageOf(error: unknown, fallback: string): string {
  return error instanceof UsersApiError ? error.message : fallback;
}

export function UserDetailPage({ api = defaultApi }: { api?: UsersApi }) {
  const { userId = "" } = useParams<{ userId: string }>();
  const { actor } = useCurrentActor();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const show = useCallback((detail: UserDetail) => {
    setState({ status: "ready", detail });
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    api
      .getUser(userId, controller.signal)
      .then(show)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
            message: messageOf(error, "This user could not be loaded."),
          });
        }
      });

    return () => controller.abort();
  }, [api, userId, show]);

  return (
    <main className="users-page">
      <p>
        <Link to="/admin/users">← All users</Link>
      </p>

      {state.status === "loading" && <p role="status">Loading…</p>}

      {state.status === "error" && (
        <p className="users-message users-message--error" role="alert">
          {state.message}
        </p>
      )}

      {state.status === "ready" && (
        <UserDetailView
          // Fresh form state for each user.
          key={state.detail.user.id}
          detail={state.detail}
          isSelf={state.detail.user.id === actor.id}
          api={api}
          onChanged={(detail) => {
            show(detail);
            // Names, roles and active reviewers show up in reviewer lists.
            reviewerDirectory.clear();
          }}
        />
      )}
    </main>
  );
}

interface UserDetailViewProps {
  detail: UserDetail;
  isSelf: boolean;
  api: UsersApi;
  onChanged: (detail: UserDetail) => void;
}

function UserDetailView({ detail, isSelf, api, onChanged }: UserDetailViewProps) {
  const { user } = detail;

  return (
    <>
      <div className="users-page__heading">
        <h1>{user.displayName}</h1>
        <span
          className={`account-status account-status--${user.status.toLowerCase()}`}
        >
          {formatAccountStatus(user.status)}
        </span>
      </div>

      <dl className="users-facts">
        <dt>Username</dt>
        <dd>{user.username}</dd>
        <dt>Role</dt>
        <dd>{formatRole(user.role)}</dd>
        <dt>Created</dt>
        <dd>{formatDateTime(user.createdAt)}</dd>
        <dt>Last signed in</dt>
        <dd>
          {user.lastLoginAt === null
            ? "Never"
            : formatDateTime(user.lastLoginAt)}
        </dd>
        {user.role === "REVIEWER" && (
          <>
            <dt>Open reviews</dt>
            <dd>{detail.openReviewCount}</dd>
          </>
        )}
        {/* A deactivated account's link no longer works. */}
        {detail.setupLinkExpiresAt !== null && user.status !== "DEACTIVATED" && (
          <>
            <dt>Setup link expires</dt>
            <dd>{formatDateTime(detail.setupLinkExpiresAt)}</dd>
          </>
        )}
      </dl>

      <EditAccount detail={detail} isSelf={isSelf} api={api} onChanged={onChanged} />
      <SetupLinkSection detail={detail} api={api} onChanged={onChanged} />
      <ActivationSection detail={detail} isSelf={isSelf} api={api} onChanged={onChanged} />

      <section className="users-panel" aria-labelledby="history-heading">
        <h2 id="history-heading">History</h2>
        <ol className="users-history">
          {detail.history.map((event) => (
            <li key={event.eventId}>
              <span>{describeEvent(event, user.id)}</span>
              <time dateTime={event.occurredAt}>
                {formatDateTime(event.occurredAt)}
              </time>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function EditAccount({
  detail,
  isSelf,
  api,
  onChanged,
}: UserDetailViewProps) {
  const { user } = detail;
  const [displayName, setDisplayName] = useState(user.displayName);
  const [username, setUsername] = useState(user.username);
  const [role, setRole] = useState<UserRole>(user.role);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const changes = {
    ...(displayName.trim() !== user.displayName
      ? { displayName: displayName.trim() }
      : {}),
    ...(username.trim() !== user.username ? { username: username.trim() } : {}),
    ...(role !== user.role ? { role } : {}),
  };
  const hasChanges = Object.keys(changes).length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!hasChanges || isSaving) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const updated = await api.updateUser(user.id, changes);
      setDisplayName(updated.user.displayName);
      setUsername(updated.user.username);
      setRole(updated.user.role);
      setMessage("Changes saved.");
      onChanged(updated);
    } catch (caught) {
      setError(messageOf(caught, "The changes could not be saved."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="users-panel" aria-labelledby="edit-heading">
      <h2 id="edit-heading">Account details</h2>

      {error !== null && (
        <p className="users-message users-message--error" role="alert">
          {error}
        </p>
      )}
      {message !== null && (
        <p className="users-message" role="status">
          {message}
        </p>
      )}

      <form
        className="users-form"
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
      >
        <div className="users-field">
          <label htmlFor="edit-name">Full name</label>
          <input
            id="edit-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>

        <div className="users-field">
          <label htmlFor="edit-username">Username</label>
          <input
            id="edit-username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>

        <div className="users-field">
          <label htmlFor="edit-role">Role</label>
          <select
            id="edit-role"
            value={role}
            disabled={isSelf}
            aria-describedby={isSelf ? "edit-role-hint" : undefined}
            onChange={(event) => setRole(event.target.value as UserRole)}
          >
            {ROLES.map((option) => (
              <option key={option} value={option}>
                {formatRole(option)}
              </option>
            ))}
          </select>
          {isSelf && (
            <small id="edit-role-hint">
              You cannot change your own role.
            </small>
          )}
        </div>

        <div className="users-actions">
          <button type="submit" disabled={!hasChanges || isSaving}>
            {isSaving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </section>
  );
}

function SetupLinkSection({
  detail,
  api,
  onChanged,
}: Omit<UserDetailViewProps, "isSelf">) {
  const { user } = detail;
  const [link, setLink] = useState<SetupLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  if (user.status === "DEACTIVATED") {
    return null;
  }

  const isReset = user.status === "ACTIVE";

  async function handleIssue() {
    setIsSaving(true);
    setError(null);

    try {
      setLink(await api.issueSetupLink(user.id));
      onChanged(await api.getUser(user.id));
    } catch (caught) {
      setError(messageOf(caught, "A setup link could not be made."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="users-panel" aria-labelledby="setup-heading">
      <h2 id="setup-heading">{isReset ? "Password" : "Password setup"}</h2>

      {link === null && (
        <>
          <p>
            {isReset
              ? `A reset link lets ${user.displayName} choose a new password. The current password keeps working until the link is used, and then all their sessions end.`
              : `${user.displayName} has not chosen a password yet. A new link replaces any earlier one.`}
          </p>

          {error !== null && (
            <p className="users-message users-message--error" role="alert">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => void handleIssue()}
            disabled={isSaving}
          >
            {isReset ? "Reset password" : "New setup link"}
          </button>
        </>
      )}

      {link !== null && (
        <SetupLinkNotice
          link={link}
          personName={user.displayName}
          onDismiss={() => setLink(null)}
        />
      )}
    </section>
  );
}

function ActivationSection({
  detail,
  isSelf,
  api,
  onChanged,
}: UserDetailViewProps) {
  const { user } = detail;
  const [step, setStep] = useState<Deactivation>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function run(action: () => Promise<UserDetail>) {
    setIsSaving(true);
    setError(null);

    try {
      onChanged(await action());
      setStep({ step: "idle" });
    } catch (caught) {
      if (caught instanceof UsersApiError && caught.code === "has_open_reviews") {
        setStep({ step: "openReviews", message: caught.message });
      } else {
        setError(messageOf(caught, "The account could not be changed."));
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="users-panel" aria-labelledby="access-heading">
      <h2 id="access-heading">Access</h2>

      {error !== null && (
        <p className="users-message users-message--error" role="alert">
          {error}
        </p>
      )}

      {user.status === "DEACTIVATED" ? (
        <>
          <p>{user.displayName} cannot sign in.</p>
          <button
            type="button"
            onClick={() => void run(() => api.reactivateUser(user.id))}
            disabled={isSaving}
          >
            Reactivate
          </button>
        </>
      ) : isSelf ? (
        <p>You cannot deactivate your own account.</p>
      ) : step.step === "idle" ? (
        <button
          type="button"
          onClick={() => setStep({ step: "confirm" })}
          disabled={isSaving}
        >
          Deactivate
        </button>
      ) : (
        <div className="users-confirm" role="alert">
          <p>
            {step.step === "openReviews"
              ? step.message
              : `Deactivate ${user.displayName}? They are signed out at once and cannot sign in until reactivated. Their notes and history stay.`}
          </p>
          <div className="users-actions">
            <button
              type="button"
              onClick={() =>
                void run(() =>
                  api.deactivateUser(user.id, step.step === "openReviews"),
                )
              }
              disabled={isSaving}
            >
              {step.step === "openReviews" ? "Deactivate anyway" : "Deactivate"}
            </button>
            <button
              type="button"
              onClick={() => setStep({ step: "idle" })}
              disabled={isSaving}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
