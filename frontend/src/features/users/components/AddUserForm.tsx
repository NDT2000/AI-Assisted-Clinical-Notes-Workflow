import { useEffect, useRef, useState, type FormEvent } from "react";

import type { UserRole } from "../../../domain/noteAttributes";
import { formatRole } from "../../../shared/formatters";
import {
  createUser,
  UsersApiError,
  type SetupLink,
  type UserAccount,
} from "../api/usersApi";
import { ROLES } from "../roles";

interface AddUserFormProps {
  onCreated: (user: UserAccount, link: SetupLink) => void;
  onCancel: () => void;
  create?: typeof createUser;
}

export function AddUserForm({
  onCreated,
  onCancel,
  create = createUser,
}: AddUserFormProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<UserRole>("CLINICIAN");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSaving) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const created = await create({
        displayName: displayName.trim(),
        username: username.trim(),
        role,
      });
      onCreated(created.user, created.setupLink);
    } catch (caught) {
      setError(
        caught instanceof UsersApiError
          ? caught.message
          : "The account could not be created. Try again.",
      );
      setIsSaving(false);
    }
  }

  return (
    <section className="users-panel" aria-labelledby="add-user-heading">
      <h2 id="add-user-heading">Add a user</h2>
      <p>
        The new user chooses their own password with a one-time setup link,
        which you will see next.
      </p>

      {error !== null && (
        <p className="users-message users-message--error" role="alert">
          {error}
        </p>
      )}

      <form
        className="users-form"
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
      >
        <div className="users-field">
          <label htmlFor="new-user-name">Full name</label>
          <input
            id="new-user-name"
            ref={nameRef}
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>

        <div className="users-field">
          <label htmlFor="new-user-username">Username</label>
          <input
            id="new-user-username"
            aria-describedby="new-user-username-hint"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <small id="new-user-username-hint">
            3 to 32 characters: lowercase letters, digits, dots, dashes or
            underscores.
          </small>
        </div>

        <div className="users-field">
          <label htmlFor="new-user-role">Role</label>
          <select
            id="new-user-role"
            value={role}
            onChange={(event) => setRole(event.target.value as UserRole)}
          >
            {ROLES.map((option) => (
              <option key={option} value={option}>
                {formatRole(option)}
              </option>
            ))}
          </select>
        </div>

        <div className="users-actions">
          <button
            type="submit"
            disabled={
              isSaving || displayName.trim() === "" || username.trim() === ""
            }
          >
            {isSaving ? "Adding…" : "Add user"}
          </button>
          <button type="button" onClick={onCancel} disabled={isSaving}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
