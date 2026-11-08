import type { UserRole } from "../../domain/noteAttributes";
import { formatDateTime, formatRole } from "../../shared/formatters";
import type { AccountStatus, AdminEvent } from "./api/usersApi";

export function formatAccountStatus(status: AccountStatus): string {
  switch (status) {
    case "ACTIVE":
      return "Active";
    case "SETUP_PENDING":
      return "Waiting for password";
    case "DEACTIVATED":
      return "Deactivated";
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function role(value: unknown): string {
  return typeof value === "string" ? formatRole(value as UserRole) : "";
}

/* One admin action as a sentence, e.g. "Jordan Lee changed the role …". */
export function describeEvent(event: AdminEvent, targetUserId: string): string {
  const who =
    event.actorName ??
    (event.actorId === null ? "A setup command" : event.actorId);
  const details = event.details;

  switch (event.action) {
    case "CREATED":
      return `${who} created the account as ${role(details.role)}`;
    case "RENAMED":
      return details.field === "username"
        ? `${who} changed the username from ${text(details.from)} to ${text(details.to)}`
        : `${who} changed the name from ${text(details.from)} to ${text(details.to)}`;
    case "ROLE_CHANGED":
      return `${who} changed the role from ${role(details.from)} to ${role(details.to)}`;
    case "DEACTIVATED": {
      const open = Number(details.openReviewCount ?? 0);
      return open > 0
        ? `${who} deactivated the account with ${open} open ${open === 1 ? "review" : "reviews"}`
        : `${who} deactivated the account`;
    }
    case "REACTIVATED":
      return `${who} reactivated the account`;
    case "SETUP_LINK_ISSUED": {
      const expires = text(details.expiresAt);
      return expires === ""
        ? `${who} issued a setup link`
        : `${who} issued a setup link, valid until ${formatDateTime(expires)}`;
    }
    case "PASSWORD_SET":
      return event.actorId === targetUserId
        ? `${who} set their password`
        : `${who} set the password`;
  }
}
