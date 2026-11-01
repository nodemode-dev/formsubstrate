import hashlib
import hmac
import secrets

import keyring
from keyring.errors import KeyringError, PasswordDeleteError

SERVICE = "subform.triggers"
HEADER = "X-Subform-Signature"


class NoKeyring(Exception):
    pass


def _name(tid: str) -> str:
    return f"webhook-{tid}"


def create(tid: str, given: str = "") -> str:
    value = given.strip() or secrets.token_urlsafe(32)
    try:
        keyring.set_password(SERVICE, _name(tid), value)
    except KeyringError as err:
        raise NoKeyring("no system keyring to keep the webhook secret in") from err
    return value


def reveal(tid: str) -> str | None:
    try:
        return keyring.get_password(SERVICE, _name(tid))
    except KeyringError:
        return None


def forget(tid: str) -> None:
    try:
        keyring.delete_password(SERVICE, _name(tid))
    except (PasswordDeleteError, KeyringError):
        return


def verify(tid: str, raw: bytes, given: str) -> bool:
    secret = reveal(tid)
    if not secret:
        return False
    want = "sha256=" + hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(given.encode("utf-8"), want.encode("utf-8"))
