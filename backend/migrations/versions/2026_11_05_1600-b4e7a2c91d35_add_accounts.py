"""Add accounts: usernames, active flag, setup links, renewal tokens, audit log.

Existing users get their id as their username, so what they sign in with
does not change. The admin action log is append-only, like the note history.

Revision ID: b4e7a2c91d35
Revises: 8d3f6b1c2e90
Create Date: 2026-11-05 16:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b4e7a2c91d35"
down_revision: str | Sequence[str] | None = "8d3f6b1c2e90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

USERNAME_PATTERN = "^[a-z0-9._-]{3,32}$"
USER_ADMIN_ACTIONS = (
    "'CREATED', 'RENAMED', 'ROLE_CHANGED', 'DEACTIVATED', 'REACTIVATED', "
    "'SETUP_LINK_ISSUED', 'PASSWORD_SET'"
)


def _timestamp(name: str, nullable: bool = False) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def upgrade() -> None:
    # --- users ---------------------------------------------------------------
    op.add_column("users", sa.Column("username", sa.String(length=32), nullable=True))
    op.execute("UPDATE users SET username = lower(id)")
    op.alter_column("users", "username", nullable=False)
    op.create_unique_constraint(op.f("uq_users_username"), "users", ["username"])
    op.create_check_constraint(
        op.f("ck_users_username_format"),
        "users",
        f"username ~ '{USERNAME_PATTERN}'",
    )
    op.add_column(
        "users",
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.add_column(
        "users",
        sa.Column("created_by_id", sa.String(length=64), nullable=True),
    )
    op.create_foreign_key(
        op.f("fk_users_created_by_id_users"),
        "users",
        "users",
        ["created_by_id"],
        ["id"],
    )
    op.add_column("users", _timestamp("last_login_at", nullable=True))

    # --- setup links -----------------------------------------------------------
    op.create_table(
        "user_setup_links",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_by_id", sa.String(length=64), nullable=True),
        _timestamp("created_at"),
        _timestamp("expires_at"),
        _timestamp("used_at", nullable=True),
        sa.CheckConstraint(
            "expires_at > created_at",
            name=op.f("ck_user_setup_links_expires_after_created"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            name=op.f("fk_user_setup_links_created_by_id_users"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_user_setup_links_user_id_users"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_setup_links")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_user_setup_links_token_hash")),
    )
    op.create_index(
        op.f("ix_user_setup_links_user_id"),
        "user_setup_links",
        ["user_id"],
    )

    # --- renewal tokens --------------------------------------------------------
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("family_id", sa.String(length=64), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        _timestamp("created_at"),
        _timestamp("expires_at"),
        _timestamp("revoked_at", nullable=True),
        sa.Column("replaced_by_id", sa.String(length=64), nullable=True),
        sa.CheckConstraint(
            "expires_at > created_at",
            name=op.f("ck_refresh_tokens_expires_after_created"),
        ),
        sa.ForeignKeyConstraint(
            ["replaced_by_id"],
            ["refresh_tokens.id"],
            name=op.f("fk_refresh_tokens_replaced_by_id_refresh_tokens"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_refresh_tokens_user_id_users"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_refresh_tokens")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_refresh_tokens_token_hash")),
    )
    op.create_index(
        op.f("ix_refresh_tokens_family_id"),
        "refresh_tokens",
        ["family_id"],
    )
    op.create_index(op.f("ix_refresh_tokens_user_id"), "refresh_tokens", ["user_id"])

    # --- admin action log ------------------------------------------------------
    op.create_table(
        "user_admin_events",
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("actor_id", sa.String(length=64), nullable=True),
        sa.Column("target_user_id", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column(
            "details",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        _timestamp("occurred_at"),
        sa.CheckConstraint(
            f"action IN ({USER_ADMIN_ACTIONS})",
            name=op.f("ck_user_admin_events_action"),
        ),
        sa.ForeignKeyConstraint(
            ["actor_id"],
            ["users.id"],
            name=op.f("fk_user_admin_events_actor_id_users"),
        ),
        sa.ForeignKeyConstraint(
            ["target_user_id"],
            ["users.id"],
            name=op.f("fk_user_admin_events_target_user_id_users"),
        ),
        sa.PrimaryKeyConstraint("event_id", name=op.f("pk_user_admin_events")),
    )
    op.create_index(
        op.f("ix_user_admin_events_target_user_id"),
        "user_admin_events",
        ["target_user_id"],
    )
    # Same rule as note history: once written, never changed.
    op.execute(
        "CREATE TRIGGER user_admin_events_reject_changes "
        "BEFORE UPDATE OR DELETE ON user_admin_events "
        "FOR EACH ROW EXECUTE FUNCTION reject_history_change();"
    )


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS user_admin_events_reject_changes ON user_admin_events;"
    )
    op.drop_index(
        op.f("ix_user_admin_events_target_user_id"),
        table_name="user_admin_events",
    )
    op.drop_table("user_admin_events")
    op.drop_index(op.f("ix_refresh_tokens_user_id"), table_name="refresh_tokens")
    op.drop_index(op.f("ix_refresh_tokens_family_id"), table_name="refresh_tokens")
    op.drop_table("refresh_tokens")
    op.drop_index(op.f("ix_user_setup_links_user_id"), table_name="user_setup_links")
    op.drop_table("user_setup_links")

    op.drop_column("users", "last_login_at")
    op.drop_constraint(
        op.f("fk_users_created_by_id_users"),
        "users",
        type_="foreignkey",
    )
    op.drop_column("users", "created_by_id")
    op.drop_column("users", "created_at")
    op.drop_column("users", "is_active")
    op.drop_constraint(op.f("ck_users_username_format"), "users", type_="check")
    op.drop_constraint(op.f("uq_users_username"), "users", type_="unique")
    op.drop_column("users", "username")
