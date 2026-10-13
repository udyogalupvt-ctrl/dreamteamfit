"""Small helpers for the local emulator tests: Firestore REST (admin bypass token "owner") and Auth sign-up.
Ports come from the environment so a test can run beside other emulators; the defaults are the sheet-backup test's."""
import json, os, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone

PROJECT = os.environ.get("EMU_PROJECT", "leadsmanage-1f7cd")
APP = os.environ.get("EMU_APP_PORT", "5999")
FS_PORT = os.environ.get("EMU_FIRESTORE_PORT", "8680")
AUTH_PORT = os.environ.get("EMU_AUTH_PORT", "9699")
BASE = f"http://127.0.0.1:{APP}"
FS = f"http://127.0.0.1:{FS_PORT}/v1/projects/{PROJECT}/databases/(default)/documents"
AUTH = f"http://127.0.0.1:{AUTH_PORT}/identitytoolkit.googleapis.com/v1/accounts"
IST = timezone(timedelta(hours=5, minutes=30))
d = lambda n: (datetime.now(IST) + timedelta(days=n)).strftime("%Y-%m-%d")


def req(url, method="GET", body=None, tok="owner"):
    h = {"Content-Type": "application/json"}
    if tok: h["Authorization"] = f"Bearer {tok}"
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as x: return x.status, json.loads(x.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")


def unval(v):
    k, x = next(iter(v.items()))
    if k == "integerValue": return int(x)
    if k == "doubleValue": return float(x)
    if k == "mapValue": return {a: unval(b) for a, b in x.get("fields", {}).items()}
    if k == "arrayValue": return [unval(i) for i in x.get("values", [])]
    if k == "nullValue": return None
    return x


def get(path):
    s, r = req(f"{FS}/{path}")
    if s != 200: return None
    return {k: unval(v) for k, v in r.get("fields", {}).items()}


def conv(v):
    if isinstance(v, bool): return {"booleanValue": v}
    if isinstance(v, int): return {"integerValue": str(v)}
    if isinstance(v, float): return {"doubleValue": v}
    if isinstance(v, list): return {"arrayValue": {"values": [conv(i) for i in v]}}
    if isinstance(v, dict): return {"mapValue": {"fields": {k: conv(x) for k, x in v.items()}}}
    if v is None: return {"nullValue": None}
    if isinstance(v, datetime): return {"timestampValue": v.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    return {"stringValue": v}


def put(path, fields, tok="owner"):
    body = {k: conv(v) for k, v in fields.items()}
    body.setdefault("createdAt", {"timestampValue": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
    body.setdefault("updatedAt", {"timestampValue": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
    return req(f"{FS}/{path}", "PATCH", {"fields": body}, tok)[0]


def delete(path, tok="owner"):
    return req(f"{FS}/{path}", "DELETE", None, tok)[0]


def signup(email, pw):
    s, r = req(f"{AUTH}:signUp?key=fake", "POST", {"email": email, "password": pw, "returnSecureToken": True}, None)
    if s != 200:  # already there from an earlier run
        r = req(f"{AUTH}:signInWithPassword?key=fake", "POST", {"email": email, "password": pw, "returnSecureToken": True}, None)[1]
    return r
