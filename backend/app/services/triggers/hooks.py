import hashlib
import hmac
import re
import secrets
import time

import keyring
from keyring.errors import KeyringError, PasswordDeleteError

SERVICE = "subform.triggers"
HEADER = "X-Subform-Signature"
TS_HEADER = "X-Subform-Timestamp"
NONCE_HEADER = "X-Subform-Nonce"
WINDOW = 300
NONCE_TTL = 600
MAX_NONCES = 2000
MIN_TYPED = 24
GENERATED_BYTES = 32
NONCE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
_SEEN: dict[str, dict[str, float]] = {}


class NoKeyring(Exception):
    pass


class WeakSecret(Exception):
    pass


def _name(tid: str) -> str:
    return f"webhook-{tid}"


def create(tid: str, given: str = "") -> str:
    value = given.strip() or secrets.token_urlsafe(GENERATED_BYTES)
    if len(value) < MIN_TYPED:
        raise WeakSecret(f"a typed webhook secret needs at least {MIN_TYPED} characters; leave it empty to generate one")
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
    forget_nonces(tid)
    try:
        keyring.delete_password(SERVICE, _name(tid))
    except (PasswordDeleteError, KeyringError):
        return


def sign(secret: str, ts: str, nonce: str, raw: bytes) -> str:
    message = f"{ts}.{nonce}.".encode("utf-8") + raw
    return "sha256=" + hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def _remember(tid: str, nonce: str, now: float) -> str:
    seen = _SEEN.setdefault(tid, {})
    for old in [n for n, until in seen.items() if until <= now]:
        del seen[old]
    if nonce in seen:
        return "this request was already received"
    if len(seen) >= MAX_NONCES:
        return "too many recent requests; try again in a few minutes"
    seen[nonce] = now + NONCE_TTL
    return ""


def forget_nonces(tid: str) -> None:
    _SEEN.pop(tid, None)


def verify(tid: str, raw: bytes, given: str, ts: str, nonce: str, now: float | None = None) -> str:
    secret = reveal(tid)
    if not secret:
        return "bad signature"
    if not ts.isdigit() or len(ts) > 12 or not NONCE.match(nonce or ""):
        return "a timestamp and a nonce header are required"
    clock = time.time() if now is None else now
    if abs(clock - int(ts)) > WINDOW:
        return "the timestamp is outside the five minute window"
    if not hmac.compare_digest(given.encode("utf-8"), sign(secret, ts, nonce, raw).encode("utf-8")):
        return "bad signature"
    return _remember(tid, nonce, clock)
