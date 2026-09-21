"""Cascade validation_results/validation_issues on validation_rules delete.

Deleting a rule that already has results from a past run previously hit a
foreign key violation (RuleEditor's Remove button did nothing but revert,
since the frontend's optimistic UI update got undone by the ensuing
refresh). A rule doesn't need to survive its own deletion for its run
history to make sense -- the run itself keeps its own aggregate stats.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-22

"""
from typing import Sequence, Union

from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("validation_results_rule_id_fkey", "validation_results", type_="foreignkey")
    op.create_foreign_key(
        "validation_results_rule_id_fkey",
        "validation_results",
        "validation_rules",
        ["rule_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.drop_constraint("validation_issues_rule_id_fkey", "validation_issues", type_="foreignkey")
    op.create_foreign_key(
        "validation_issues_rule_id_fkey",
        "validation_issues",
        "validation_rules",
        ["rule_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("validation_issues_rule_id_fkey", "validation_issues", type_="foreignkey")
    op.create_foreign_key(
        "validation_issues_rule_id_fkey", "validation_issues", "validation_rules", ["rule_id"], ["id"]
    )
    op.drop_constraint("validation_results_rule_id_fkey", "validation_results", type_="foreignkey")
    op.create_foreign_key(
        "validation_results_rule_id_fkey", "validation_results", "validation_rules", ["rule_id"], ["id"]
    )
