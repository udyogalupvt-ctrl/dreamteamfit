"""Restore script test (emulators + fake Sheets only, see sheet_backup_run.sh).
Sync a small data set to the fake sheet, then break Firestore (delete a payment, change a client) and check
scripts/restore-from-sheet.mjs: dry run writes nothing and reports 1 new + 1 different, --apply puts both back
exactly (Timestamps too), excluded collections and a missing --confirm are refused before any write."""
import json, os, re, shutil, subprocess, sys, tempfile, urllib.request
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from emu_helpers import BASE, FS, OWNER_EMAIL, OWNER_PASSWORD, d, delete, put, req, signup  # noqa: E402

FAKE = os.environ.get("FAKE_SHEETS", "http://127.0.0.1:5799")
SHEET_ID = "1Rsn0jB8HX8TsbYmrxeT6VCPl4wcmyh2VhU7yy2_qJxc"
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
results = []


def step(name, ok, info=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"   <- {info}"))


def fake_post(path):
    return json.loads(urllib.request.urlopen(urllib.request.Request(FAKE + path, data=b"{}", method="POST")).read() or b"{}")


def raw(path):
    s, r = req(f"{FS}/{path}")
    return r.get("fields") if s == 200 else None


def run(args, env=None, key=None):
    e = dict(os.environ if env is None else env)
    p = subprocess.run(["node", "--experimental-strip-types", "--no-warnings", "scripts/restore-from-sheet.mjs", key or KEY, SHEET_ID, *args],
                       cwd=REPO, env=e, capture_output=True, text=True, encoding="utf-8")
    return p.returncode, p.stdout + p.stderr


NO_EMU = {k: v for k, v in os.environ.items() if k != "FIRESTORE_EMULATOR_HOST"}

# a throwaway key file from the account the run script made (never printed, deleted at the end)
sa = json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT"])
tmp = tempfile.mkdtemp()
KEY = os.path.join(tmp, "key.json")
open(KEY, "w").write(json.dumps(sa))
NOPROJECT_KEY = os.path.join(tmp, "other.json")
open(NOPROJECT_KEY, "w").write(json.dumps({**sa, "project_id": "no-such-project-xyz"}))

# ---------------------------------------------------------------- seed + full sync
fake_post("/__reset")
delete("serverSecrets/sheetBackup")
owner = signup(OWNER_EMAIL, OWNER_PASSWORD)
OT = owner["idToken"]
put("packages/pk1", {"name": "Strength Monthly", "category": "Strength + Cardio", "durationDays": 30, "price": 2000, "isActive": True})
for n, (cid, name) in enumerate([("c1", "Asha Rao"), ("c2", "Bala Kumar")], 1):
    put(f"clients/{cid}", {"clientCode": f"RF{n:04d}", "fullName": name, "phone": f"900000000{n}", "status": "active", "gender": "female", "joinedOn": d(-40),
                           "lastVisit": datetime(2026, 9, 1, 7, 30, 15, tzinfo=timezone.utc)})
    put(f"payments/p{n}", {"clientId": cid, "clientNameSnapshot": name, "invoiceId": f"i{n}", "amount": 1000 * n, "method": "Cash", "paymentDate": d(0), "kind": "initial",
                           "paidAt": datetime(2026, 9, 2, 10, 0, 1, tzinfo=timezone.utc)})
put("payments/p3", {"clientId": "c2", "clientNameSnapshot": "Bala Kumar", "invoiceId": "i2", "amount": 500, "method": "UPI", "paymentDate": d(0), "kind": "balance"})
# a collection the app does not know about, with every special Firestore value
req(f"{FS}/restoreProbe/x", "PATCH", {"fields": {
    "when": {"timestampValue": "2026-03-04T05:06:07.123Z"},
    "where": {"geoPointValue": {"latitude": 17.385, "longitude": 78.4867}},
    "who": {"referenceValue": "projects/leadsmanage-1f7cd/databases/(default)/documents/clients/c1"},
    "blob": {"bytesValue": "AAECA/8="},
    "nested": {"mapValue": {"fields": {"list": {"arrayValue": {"values": [{"integerValue": "1"}, {"doubleValue": 2.5}, {"timestampValue": "2025-01-01T00:00:00Z"}]}}, "flag": {"booleanValue": True}, "nothing": {"nullValue": None}}}},
    "text": {"stringValue": "Rs 1 — चेक 🙂"},
}})
put("serverSecrets/whatsappGateway", {"apiKey": "K-SECRET-VALUE"})

r = {}
for i in range(15):
    s, r = req(f"{BASE}/api/backup/sheet/sync", "POST", {"mode": "full"} if i == 0 else {}, OT)
    if s != 200 or r.get("done"):
        break
step("full sync to the fake sheet finishes", r.get("done") is True and not r.get("error"), r)

before = {p: raw(p) for p in ("payments/p1", "payments/p2", "payments/p3", "clients/c1", "clients/c2", "restoreProbe/x")}
step("seed is readable", all(before.values()), [k for k, v in before.items() if not v])

# ---------------------------------------------------------------- nothing wrong yet
code, out = run(["all"])
step("untouched data: nothing new, nothing different", code == 0 and "Total: new 0 · different 0" in out and "restoreProbe: new 0 · different 0 · same 1" in out, out)

# ---------------------------------------------------------------- break two things
delete("payments/p2")
req(f"{FS}/clients/c2?updateMask.fieldPaths=fullName", "PATCH", {"fields": {"fullName": {"stringValue": "Bala CHANGED"}}})
broken = {p: raw(p) for p in ("payments/p1", "payments/p3", "clients/c1", "clients/c2", "restoreProbe/x")}

print("\n== dry run")
code, out = run(["all"])
step("dry run exits 0", code == 0, out)
step("payments: new 1 (p2)", re.search(r"payments: new 1 · different 0 · same \d+", out) and "new: p2" in out, out)
step("clients: different 1 (c2, fullName)", re.search(r"clients: new 0 · different 1 · same \d+", out) and "c2 (fullName)" in out, out)
step("totals: new 1 · different 1", "Total: new 1 · different 1" in out and "nothing was written" in out, out)
after = {p: raw(p) for p in broken}
step("dry run wrote nothing (p2 still gone, c2 still changed, others identical)", raw("payments/p2") is None and after == broken, "")
step("the output holds no key or token", "PRIVATE KEY" not in out and sa["private_key"][40:80] not in out and "fake-token" not in out, "")

print("\n== --apply")
code, out = run(["all", "--apply"])
step("apply exits 0 and says what it wrote", code == 0 and "wrote 1 to payments: p2" in out and "wrote 1 to clients: c2" in out and "Wrote 2 records. Nothing was deleted." in out, out)
step("the deleted payment is back, field for field (Timestamps included)", raw("payments/p2") == before["payments/p2"], (raw("payments/p2"), before["payments/p2"]))
step("the changed client is back, field for field", raw("clients/c2") == before["clients/c2"], (raw("clients/c2"), before["clients/c2"]))
step("untouched records are identical (incl. geo, reference, bytes, nested)", all(raw(p) == before[p] for p in ("payments/p1", "payments/p3", "clients/c1", "restoreProbe/x")), "")
code, out = run(["all"])
step("a second dry run finds nothing to do", code == 0 and "Total: new 0 · different 0" in out, out)

print("\n== one record, one collection")
delete("payments/p3")
req(f"{FS}/payments/p1?updateMask.fieldPaths=amount", "PATCH", {"fields": {"amount": {"integerValue": "1"}}})
code, out = run(["payments", "--doc", "p3", "--apply"])
step("--doc restores only that record (p1 stays changed)", code == 0 and "wrote 1 to payments: p3" in out and raw("payments/p3") == before["payments/p3"] and raw("payments/p1") != before["payments/p1"], out)
code, out = run(["payments", "--apply"])
step("one collection: restores the rest of it", code == 0 and raw("payments/p1") == before["payments/p1"], out)

print("\n== refusals")
code, out = run(["serverSecrets", "--apply"])
step("an excluded collection is refused (exit 2)", code == 2 and "never copied" in out, (code, out))
code, out = run(["all", "--apply"], env=NO_EMU, key=NOPROJECT_KEY)
step("no emulator, no --confirm: refused before any write (exit 2)", code == 2 and "--confirm no-such-project-xyz" in out and "wrote" not in out, (code, out))
code, out = run(["all", "--apply", "--confirm", "leadsmanage-1f7cd"], env=NO_EMU, key=NOPROJECT_KEY)
step("wrong --confirm: refused (exit 2)", code == 2 and "does not match" in out, (code, out))
code, out = run(["nonexistentcollection"])
step("a collection with no tab is refused, nothing written", code == 2 and "no tab" in out, (code, out))
code, out = run(["payments", "--bogus"])
step("an unknown option is refused", code == 2, (code, out))

shutil.rmtree(tmp, ignore_errors=True)
sys.exit(0 if all(results) else 1)
