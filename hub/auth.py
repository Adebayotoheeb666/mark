"""RBAC matrix (Phase 5). Server-side enforcement. Roles: admin, head, teacher, viewer."""
import hashlib

PERMS = {
    "admin": {"setup", "import", "scores.enter", "flags.triage", "comments.edit",
              "reports.draft", "reports.lock", "backup", "keys", "users"},
    "head": {"flags.triage", "comments.edit", "reports.draft", "reports.lock", "backup", "users.view"},
    "teacher": {"scores.enter", "flags.triage", "comments.edit", "reports.draft"},
    "viewer": set(),
}

# scoped: teachers only their assigned (subject, class) — checked by caller with assignment list
def can(role, action):
    return action in PERMS.get(role, set())


def hash_pin(pin, salt="agm-phase5"):
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), 100_000).hex()
