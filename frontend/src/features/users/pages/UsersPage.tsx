import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import type { UserRole } from "../../../domain/noteAttributes";
import { formatDateTime, formatRole } from "../../../shared/formatters";
import { formatAccountStatus } from "../accountText";
import {
  listUsers,
  type SetupLink,
  type UserAccount,
  type UserListFilters,
} from "../api/usersApi";
import { AddUserForm } from "../components/AddUserForm";
import { SetupLinkNotice } from "../components/SetupLinkNotice";
import { reviewerDirectory } from "../reviewerDirectory";
import { ROLES } from "../roles";
import "../Users.css";

const SEARCH_DELAY_MS = 250;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; users: UserAccount[] };

interface UsersPageProps {
  load?: typeof listUsers;
}

export function UsersPage({ load = listUsers }: UsersPageProps) {
  const [filters, setFilters] = useState<UserListFilters>({
    q: "",
    role: "",
    active: "",
  });
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [isAdding, setIsAdding] = useState(false);
  const [created, setCreated] = useState<{
    user: UserAccount;
    link: SetupLink;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // Wait for a pause in typing before asking the server.
    const timer = window.setTimeout(() => {
      load(filters, controller.signal)
        .then(({ users }) => setState({ status: "ready", users }))
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setState({
              status: "error",
              message:
                error instanceof Error
                  ? error.message
                  : "The users could not be loaded.",
            });
          }
        });
    }, SEARCH_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [filters, load, reloadKey]);

  function handleCreated(user: UserAccount, link: SetupLink) {
    setIsAdding(false);
    setCreated({ user, link });
    setReloadKey((key) => key + 1);
    // A new reviewer appears in the notes pages' reviewer lists.
    reviewerDirectory.clear();
  }

  return (
    <main className="users-page">
      <div className="users-page__heading">
        <h1>Users</h1>
        {!isAdding && created === null && (
          <button type="button" onClick={() => setIsAdding(true)}>
            Add user
          </button>
        )}
      </div>

      {isAdding && (
        <AddUserForm
          onCreated={handleCreated}
          onCancel={() => setIsAdding(false)}
        />
      )}

      {created !== null && (
        <SetupLinkNotice
          link={created.link}
          personName={created.user.displayName}
          onDismiss={() => setCreated(null)}
        />
      )}

      <form
        className="users-filters"
        role="search"
        aria-label="Filter users"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="users-field">
          <label htmlFor="users-search">Name or username</label>
          <input
            id="users-search"
            type="search"
            value={filters.q}
            onChange={(event) =>
              setFilters({ ...filters, q: event.target.value })
            }
          />
        </div>

        <div className="users-field">
          <label htmlFor="users-role">Role</label>
          <select
            id="users-role"
            value={filters.role}
            onChange={(event) =>
              setFilters({
                ...filters,
                role: event.target.value as UserRole | "",
              })
            }
          >
            <option value="">All roles</option>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {formatRole(role)}
              </option>
            ))}
          </select>
        </div>

        <div className="users-field">
          <label htmlFor="users-active">Status</label>
          <select
            id="users-active"
            value={filters.active}
            onChange={(event) =>
              setFilters({
                ...filters,
                active: event.target.value as UserListFilters["active"],
              })
            }
          >
            <option value="">Everyone</option>
            <option value="true">Active</option>
            <option value="false">Deactivated</option>
          </select>
        </div>
      </form>

      {state.status === "loading" && <p role="status">Loading users…</p>}

      {state.status === "error" && (
        <p className="users-message users-message--error" role="alert">
          {state.message}
        </p>
      )}

      {state.status === "ready" && (
        <table className="users-table">
          <caption>
            {state.users.length === 1
              ? "1 user"
              : `${state.users.length} users`}
          </caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Username</th>
              <th scope="col">Role</th>
              <th scope="col">Status</th>
              <th scope="col">Last signed in</th>
            </tr>
          </thead>
          <tbody>
            {state.users.map((user) => (
              <tr key={user.id}>
                <th scope="row">
                  <Link to={`/admin/users/${encodeURIComponent(user.id)}`}>
                    {user.displayName}
                  </Link>
                </th>
                <td>{user.username}</td>
                <td>{formatRole(user.role)}</td>
                <td>
                  <span
                    className={`account-status account-status--${user.status.toLowerCase()}`}
                  >
                    {formatAccountStatus(user.status)}
                  </span>
                </td>
                <td>
                  {user.lastLoginAt === null
                    ? "Never"
                    : formatDateTime(user.lastLoginAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {state.status === "ready" && state.users.length === 0 && (
        <p>No users match these filters.</p>
      )}
    </main>
  );
}
