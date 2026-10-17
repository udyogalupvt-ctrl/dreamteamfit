"""Google Sheet backup, server side: emulators + a fake Sheets server only (see sheet_backup_run.sh).
Seeds a member, sales, a split payment, a Rs 1 top-up, a refund, a late sale (paid last month) and an old bill
with no payment records; runs the sync as the owner; then checks what the fake sheet received."""
import json, os, sys, time, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from emu_helpers import BASE, IST, OWNER_EMAIL, OWNER_PASSWORD, d, delete, get, put, req, signup  # noqa: E402

FAKE = os.environ.get("FAKE_SHEETS", "http://127.0.0.1:5799")
SERVER_LOG = os.environ.get("SERVER_LOG", "")
EMAIL = "backup-test@leadsmanage-1f7cd.iam.gserviceaccount.com"
results = []

HEADERS = ["S.NO", "DATE PAID", "NAME", "PHONE NO", "PAYMENT FOR", "PACKAGE", "PP", "CASH", "CARD", "OTHER",
           "PAID IN OLD SOFTWARE", "PAID AMOUNT", "DUE NOW", "TOTAL BILL", "GYM FEE", "PT FEE", "DISCOUNT",
           "Counseller", "PT Trainer", "TYPE OF CLIENT", "START DATE", "ENDING DATE", "DAYS", "PT End date",
           "Membership payment due date", "STATUS", "NOTE", "ENTERED ON", "BILL NO", "MEMBER ID"]
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def step(name, ok, info=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"   <- {info}"))


def api(path, body=None, tok=None, method="POST"):
    return req(f"{BASE}{path}", method, body, tok)


def fake(path="/__dump"):
    return json.loads(urllib.request.urlopen(FAKE + path).read() or b"{}")


def fake_post(path, body=None):
    r = urllib.request.Request(FAKE + path, data=json.dumps(body or {}).encode(), method="POST")
    return json.loads(urllib.request.urlopen(r).read() or b"{}")


def tabs():
    return {t["title"]: t for t in fake()["tabs"]}


def title(ym):
    return f"{MON[int(ym[5:7]) - 1]} {ym[:4]}"


def sync_until_done(tok, first=None, limit=15):
    last = None
    for i in range(limit):
        s, last = api("/api/backup/sheet/sync", first if i == 0 and first else {}, tok)
        if s != 200 or last.get("done"):
            break
    return last


def col(tab, name):
    return tab["values"][1].index(name)


def data_rows(tab):
    return [r for r in tab["values"][2:] if any(c != "" for c in r)]


def cell(row, i):
    return row[i] if i < len(row) else ""


# ------------------------------------------------------------------------------- dates
now = datetime.now(IST)
today = d(0)
cur_ym = today[:7]
prev_last = (now.replace(day=1) - timedelta(days=1)).strftime("%Y-%m-%d")
prev_ym = prev_last[:7]
CUR, PREV = title(cur_ym), title(prev_ym)

fake_post("/__reset")

# ------------------------------------------------------------------------------- people
owner = signup(OWNER_EMAIL, OWNER_PASSWORD)
OT = owner["idToken"]
staff = signup("desk@test.local", "secret123")
ST = staff["idToken"]
put(f"staffAccess/{staff['localId']}", {"active": True, "admin": False, "permissions": ["members"], "staffId": "", "email": "desk@test.local"})
nobody = signup("nobody@test.local", "secret123")
NT = nobody["idToken"]

# ------------------------------------------------------------------------------- seed
put("packages/pk1", {"name": "Strength Monthly", "category": "Strength + Cardio", "durationDays": 30, "price": 2000, "isActive": True})
plan_end = d(25)
for n, (cid, name, phone) in enumerate([("c1", "Asha Rao", "9000000001"), ("c2", "Bala Kumar", "9000000002"), ("c3", "Chitra Devi", "9000000003"),
                                       ("c4", "Dev Anand", "9000000004"), ("c5", "Esha Singh", "9000000005"), ("c6", "Farid Khan", "9000000006"),
                                       ("c7", "=Gita Rani", "9000000007")], 1):
    put(f"clients/{cid}", {"clientCode": f"RF{n:04d}", "fullName": name, "phone": phone, "status": "active", "gender": "female", "joinedOn": d(-40),
                           "currentMembership": {"membershipId": f"m{n}", "packageName": "Strength Monthly", "startDate": d(-5), "endDate": plan_end, "status": "active"}})
    put(f"memberships/m{n}", {"clientId": cid, "packageId": "pk1", "packageNameSnapshot": "Strength Monthly", "priceSnapshot": 2000, "durationDaysSnapshot": 30,
                              "startDate": d(-5), "endDate": plan_end, "status": "active", "counsellorName": "Ravi", "invoiceId": f"i{n}"})


def bill(n, cid, name, total, paid, tracked=True, method="Cash", date=None, status=None):
    put(f"invoices/i{n}", {"invoiceNumber": str(1000 + n), "clientId": cid, "clientNameSnapshot": name, "membershipId": f"m{n}", "ptAssignmentId": None,
                           "items": [{"name": "Strength Monthly"}], "subtotal": total, "discount": 0, "total": total, "amountPaid": paid,
                           "balanceDue": total - paid, "paymentStatus": status or ("paid" if total == paid else "partial"), "paymentMethod": method,
                           "invoiceDate": date or today, "dueDate": d(7), "membershipGross": total, "ptGross": 0, "paymentsTracked": tracked, "counsellorName": "Ravi"})


def pay(pid, n, cid, name, amount, method, kind="initial", date=None, **extra):
    put(f"payments/{pid}", {"clientId": cid, "clientNameSnapshot": name, "invoiceId": f"i{n}", "membershipId": f"m{n}", "ptAssignmentId": None, "amount": amount,
                            "method": method, "paymentDate": date or today, "kind": kind, "counsellorName": "Ravi", **extra})


bill(1, "c1", "Asha Rao", 2000, 1500)
pay("p1", 1, "c1", "Asha Rao", 1500, "Cash")
bill(2, "c2", "Bala Kumar", 2000, 2000)
pay("p2a", 2, "c2", "Bala Kumar", 1000, "Cash", splitId="s1")
pay("p2b", 2, "c2", "Bala Kumar", 1000, "UPI", splitId="s1")
bill(3, "c3", "Chitra Devi", 2000, 2000)
pay("p4", 3, "c3", "Chitra Devi", 1999, "Cash")
pay("p3", 3, "c3", "Chitra Devi", 1, "UPI", kind="balance")
bill(4, "c4", "Dev Anand", 1000, 1000, method="Card", status="refunded")
pay("p6", 4, "c4", "Dev Anand", 1000, "Card")
pay("p7", 4, "c4", "Dev Anand", -500, "Card", kind="refund")
bill(5, "c5", "Esha Singh", 2000, 2000, method="UPI")
pay("p8", 5, "c5", "Esha Singh", 2000, "UPI", date=prev_last)  # a late sale: paid last month, typed in today
bill(6, "c6", "Farid Khan", 1500, 1500, tracked=False)  # an old bill with no payment records
bill(7, "c7", "=Gita Rani", 3000, 1000)
pay("p9", 7, "c7", "=Gita Rani", 1000, "Cash")
put("expenses/e1", {"title": "Electricity", "category": "Utilities", "amount": 1200, "paymentMethod": "Cash", "date": today, "description": "", "notes": "", "createdBy": "Owner"})
put("staff/s1", {"name": "Ravi", "phone": "9111111111", "role": "Counsellor", "active": True})
put("trainers/t1", {"name": "Kiran", "phone": "9222222222", "status": "active", "staffId": ""})
put("serverSecrets/whatsappGateway", {"apiKey": "K-SECRET-VALUE"})
put("loginVault/v1", {"secret": "VAULT-SECRET-VALUE"})
put("staffPrivate/s1", {"monthlySalary": 777})

PAY_IDS = ["p1", "p2a", "p2b", "p3", "p4", "p6", "p7", "p8", "p9"]
CUR_PAID = 1500 + 2000 + 1999 + 1 + 1000 - 500 + 1000 + 1500  # payments of this month + the old bill
CUR_ROWS = 8

# ------------------------------------------------------------------------------- who may do what
print("== who may call what")
s, _ = api("/api/backup/sheet/touch", {"paths": ["payments/p1"]})
step("touch without a login: 401", s == 401, s)
s, _ = api("/api/backup/sheet/touch", {"paths": ["payments/p1"]}, NT)
step("touch with a login that is not staff: 401", s == 401, s)
for p, body in (("status", None), ("sync", {}), ("settings", {"sheetUrl": "x"})):
    s, _ = api(f"/api/backup/sheet/{p}", body, ST, "GET" if p == "status" else "POST")
    step(f"staff cannot use {p}: 403", s == 403, s)
    s, _ = api(f"/api/backup/sheet/{p}", body, None, "GET" if p == "status" else "POST")
    step(f"no login cannot use {p}: 401", s == 401, s)
s, r = api("/api/backup/sheet/touch", {"paths": ["serverSecrets/webPush", "bad path", "payments/p1"]}, ST)
step("staff touch of an untouched sheet answers ok (excluded/bad paths ignored)", s == 200 and r.get("ok") is True, f"{s} {r}")
s, r = api("/api/backup/sheet/touch", {"paths": ["payments/p1"] * 201}, ST)
step("more than 200 paths: 400", s == 400, s)
fake_post("/__reset")
req_state = delete("serverSecrets/sheetBackup")

# ------------------------------------------------------------------------------- first full sync
print("\n== owner: full sync")
s, r = api("/api/backup/sheet/sync", {"mode": "full"}, OT)
step("first sync call runs", s == 200 and "done" in r, f"{s} {r}")
if not r.get("done"):
    r = sync_until_done(OT)
step("sync finishes (done) with no error", r.get("done") is True and not r.get("error"), r)
s, st = api("/api/backup/sheet/status", None, OT, "GET")
step("status: lastOkAt set, no error, nothing pending", s == 200 and st["lastOkAt"] and not st["lastError"] and st["pending"] == 0, st)
step("status names the account to share with and the sheet link", st.get("shareWith") == EMAIL and "/spreadsheets/d/1Rsn0jB8" in st.get("sheetUrl", ""), st)
step("status: every check ok", st["checks"] and all(c["ok"] for c in st["checks"]), st["checks"])

dump = fake()
T = {t["title"]: t for t in dump["tabs"]}
names = [t["title"] for t in sorted(dump["tabs"], key=lambda t: t["index"])]
step("Sheet1 is gone", "Sheet1" not in T, names)
want_first = ["Read me", "Members", "Dues", CUR, PREV, "Expenses", "All plans", "Staff & trainers", "Packages"]
step("tab order: Read me, Members, Dues, months newest first, then the rest", names[: len(want_first)] == want_first, names)
hidden = [t for t in dump["tabs"] if t["hidden"]]
step("restore tabs are hidden, protected and last", hidden and all(t["title"].startswith("_data_") and t["protectedRanges"] == 1 for t in hidden)
     and all(t["hidden"] for t in sorted(dump["tabs"], key=lambda t: t["index"])[len(want_first):]), [(t["title"], t["hidden"], t["protectedRanges"]) for t in dump["tabs"]])
step("excluded collections are not copied", not any(n in T for n in ("_data_serverSecrets", "_data_loginVault", "_data_staffPrivate", "_data_auditLogs")), names)
step("business collections are copied", all(f"_data_{c}" in T for c in ("payments", "invoices", "clients", "memberships", "packages", "expenses", "staff")), names)
step("workbook is day-month-year (en_GB), IST", (dump["properties"] or {}).get("locale") == "en_GB" and (dump["properties"] or {}).get("timeZone") == "Asia/Kolkata", dump["properties"])

# ------------------------------------------------------------------------------- the month tab
print("\n== current month tab")
m = T[CUR]
step("row 2 is the header with the 30 columns in order", m["values"][1] == HEADERS, m["values"][1][:6])
step("row 1 is the totals line: TOTAL and a green match line in NAME", cell(m["values"][0], 0) == "TOTAL" and "✓ matches" in str(cell(m["values"][0], 2))
     and f"{CUR_ROWS} payments" in str(cell(m["values"][0], 2)), m["values"][0][:4])
rows = data_rows(m)
step(f"{CUR_ROWS} rows (the split pair is one row; the late sale is in {PREV})", len(rows) == CUR_ROWS, len(rows))
paid_i = HEADERS.index("PAID AMOUNT")
step(f"PAID AMOUNT adds up to the dashboard formula ({CUR_PAID})", sum(cell(r, paid_i) or 0 for r in rows) == CUR_PAID, [cell(r, paid_i) for r in rows])
step("the totals line shows the app's figure", "₹8,500" in str(cell(m["values"][0], 2)), cell(m["values"][0], 2))
step("PAID AMOUNT total is a live SUM formula in row 1", [0, paid_i] in m["formulaCells"] and m["values"][0][paid_i] == "=SUM(L3:L)", m["values"][0][paid_i])
split = [r for r in rows if cell(r, 2) == "Bala Kumar"]
step("split Cash+UPI is one row: CASH 1000, PP 1000, PAID 2000", len(split) == 1 and cell(split[0], 7) == 1000 and cell(split[0], 6) == 1000 and cell(split[0], paid_i) == 2000, split)
topup = [r for r in rows if cell(r, 4) == "Balance"]
step("the Rs 1 balance payment is a Balance row with the top-up note", len(topup) == 1 and "₹1 top-up" in str(cell(topup[0], 26)) and cell(topup[0], 14) == "", topup)
refund = [r for r in rows if cell(r, 4) == "Refund"]
step("refund -500 is a Refund row, status Refunded", len(refund) == 1 and cell(refund[0], paid_i) == -500 and cell(refund[0], 25) == "Refunded", refund)
legacy = [r for r in rows if cell(r, 4) == "Bill (no payment record)"]
step("the old bill without payment records is a row with CASH 1500", len(legacy) == 1 and cell(legacy[0], 7) == 1500, legacy)
step("renewal vs new: first plan of each member is New", all(cell(r, 4) in ("New", "Balance", "Refund", "Bill (no payment record)") for r in rows), [cell(r, 4) for r in rows])
step("dates are real dates (numbers), not text", isinstance(cell(rows[0], 1), (int, float)) and isinstance(cell(rows[0], 27), (int, float)), rows[0][:2])
step("a formula-looking name stays text, not a formula", any(cell(r, 2) == "=Gita Rani" for r in rows) and [rows.index(next(r for r in rows if cell(r, 2) == "=Gita Rani")) + 2, 2] not in m["formulaCells"], "")
step("filter on the header row (row 2 down), 2 frozen rows, no frozen columns", m["filter"] and m["filter"]["startRowIndex"] == 1 and m["frozenRows"] == 2 and m["frozenCols"] == 0, (m["filter"], m["frozenRows"], m["frozenCols"]))
step("no auto-resize; NAME is 170 wide; banding 1; colour rules 3 + match line 2", not m["counts"].get("autoResize") and m["widths"].get("2") == 170 and m["bandingCount"] == 1 and m["conditionalCount"] == 5,
     (m["counts"], m["widths"].get("2"), m["bandingCount"], m["conditionalCount"]))
step("empty money columns are hidden (OTHER, PT FEE), used ones are not (CASH)", HEADERS.index("OTHER") in m["hiddenCols"] and HEADERS.index("PT FEE") in m["hiddenCols"] and HEADERS.index("CASH") not in m["hiddenCols"], m["hiddenCols"])
p = T[PREV]
prows = data_rows(p)
step("the late sale is on last month's tab, noted as entered later", len(prows) == 1 and cell(prows[0], paid_i) == 2000 and "entered later" in str(cell(prows[0], 26)), prows)
step("last month's tab says matches", "✓ matches" in str(cell(p["values"][0], 2)), cell(p["values"][0], 2))

# ------------------------------------------------------------------------------- other tabs
print("\n== other tabs")
mem = T["Members"]
mrows = data_rows(mem)
step("Members: 7 members, DAYS LEFT is a live formula", len(mrows) == 7 and mem["values"][1][0] == "MEMBER ID" and mem["values"][1][9] == "DAYS LEFT" and [2, 9] in mem["formulaCells"], (len(mrows), mem["values"][1][:11]))
du = T["Dues"]
drows = data_rows(du)
dd = du["values"][1].index("DUE")
step("Dues: 2 open bills adding to 2500, line says matches the app", len(drows) == 2 and sum(cell(r, dd) for r in drows) == 2500 and "✓ matches" in str(cell(du["values"][0], 0)) and "₹2,500" in str(cell(du["values"][0], 0)), (drows, du["values"][0][:2]))
step("Dues: DAYS OVERDUE is a formula", du["values"][1][8] == "DAYS OVERDUE" and any(c[1] == 8 for c in du["formulaCells"]), du["formulaCells"][:3])
step("Expenses: one row, 1200", len(data_rows(T["Expenses"])) == 1 and 1200 in T["Expenses"]["values"][2], T["Expenses"]["values"][:3])
step("All plans: 7 rows", len(data_rows(T["All plans"])) == 7, len(data_rows(T["All plans"])))
step("Staff & trainers has Ravi and Kiran", {cell(r, 0) for r in data_rows(T["Staff & trainers"])} >= {"Ravi", "Kiran"}, data_rows(T["Staff & trainers"]))
rm = T["Read me"]
rm_text = "\n".join(str(c) for row in rm["values"] for c in row)
step("Read me: title, tab guide, a tick for the month", rm["values"][0][0] == "REBUILD FITNESS — Backup" and f"✓ {CUR} matches the app" in rm_text and "If the app is down" in rm_text and "Members" in rm_text, rm_text[:300])

print("\n== restore tabs")
dp = T["_data_payments"]
ids = [cell(r, 0) for r in dp["values"][1:] if cell(r, 0) != ""]
step("_data_payments: header + one row per payment, sorted by id", dp["values"][0][:3] == ["id", "updatedAt", "json"] and ids == sorted(PAY_IDS), ids)
rec = json.loads("".join(str(c) for c in dp["values"][1][2:]))
step("a record keeps its fields and Timestamps as {__ts}", rec.get("amount") == 1500 and "__ts" in json.dumps(rec.get("createdAt")), rec)
step("_data_clients has the 7 members", len([r for r in T["_data_clients"]["values"][1:] if r and r[0] != ""]) == 7, "")

# ------------------------------------------------------------------------------- a change -> touch
print("\n== staff touch after a change")
pay("p10", 2, "c2", "Bala Kumar", 700, "Cash", kind="balance")
s, r = api("/api/backup/sheet/touch", {"paths": ["payments/p10"]}, ST)
step("touch answers ok", s == 200 and r.get("ok") is True, f"{s} {r}")
T = tabs()
rows = data_rows(T[CUR])
step("the new payment is a row on the month tab (9 rows, 9,200)", len(rows) == CUR_ROWS + 1 and sum(cell(r, paid_i) or 0 for r in rows) == CUR_PAID + 700 and "₹9,200" in str(T[CUR]["values"][0][2]), (len(rows), T[CUR]["values"][0][2]))
ids = [cell(r, 0) for r in T["_data_payments"]["values"][1:] if cell(r, 0) != ""]
step("and a row in _data_payments (appended, others untouched)", "p10" in ids and len(ids) == len(PAY_IDS) + 1, ids)
step("banding and colour rules do not pile up after a re-run", T[CUR]["bandingCount"] == 1 and T[CUR]["conditionalCount"] == 5, (T[CUR]["bandingCount"], T[CUR]["conditionalCount"]))
delete("payments/p10")
s, r = api("/api/backup/sheet/touch", {"paths": ["payments/p10"]}, ST)
T = tabs()
ids = [cell(r, 0) for r in T["_data_payments"]["values"][1:] if cell(r, 0) != ""]
step("a removed payment leaves the month tab and its restore row is cleared", len(data_rows(T[CUR])) == CUR_ROWS and "p10" not in ids and len(ids) == len(PAY_IDS), (len(data_rows(T[CUR])), ids))
put("clients/c1", {**get("clients/c1"), "fullName": "Asha Rao Changed"})
api("/api/backup/sheet/touch", {"paths": ["clients/c1"]}, ST)
T = tabs()
crow = [r for r in T["_data_clients"]["values"][1:] if cell(r, 0) == "c1"]
step("a changed member: restore row rewritten in place, Members tab refreshed", crow and "Asha Rao Changed" in "".join(str(c) for c in crow[0][2:]) and any(cell(r, 1) == "Asha Rao Changed" for r in data_rows(T["Members"])), "")

# ------------------------------------------------------------------------------- the lease
print("\n== one run at a time")
state = get("serverSecrets/sheetBackup")
put("serverSecrets/sheetBackup", {**state, "leaseUntil": int(time.time() * 1000) + 60_000})
pay("p11", 1, "c1", "Asha Rao Changed", 100, "Cash", kind="balance")
s, r = api("/api/backup/sheet/touch", {"paths": ["payments/p11"]}, ST)
T = tabs()
mid = get("serverSecrets/sheetBackup")
step("while another run holds the lease the sheet is not touched, the change is noted", s == 200 and len(data_rows(T[CUR])) == CUR_ROWS and "payments/p11" in mid["dirtyDocs"] and CUR[:3] and cur_ym in mid["dirtyMonths"], (s, mid.get("dirtyDocs"), mid.get("dirtyMonths")))
put("serverSecrets/sheetBackup", {**mid, "leaseUntil": 0})
r = sync_until_done(OT)
T = tabs()
after = get("serverSecrets/sheetBackup")
step("the next run picks the note up and clears it", r.get("done") and len(data_rows(T[CUR])) == CUR_ROWS + 1 and not after.get("dirtyDocs") and not after.get("dirtyMonths"), (r, after.get("dirtyDocs")))

# ------------------------------------------------------------------------------- failures and retries
print("\n== Google errors")
pay("p12", 1, "c1", "Asha Rao Changed", 50, "Cash", kind="balance")
api("/api/backup/sheet/touch", {"paths": ["payments/p12"]}, ST)  # queued below by the failing run
fake_post("/__control", {"failNext": {"status": 403, "count": 1000}})
pay("p13", 1, "c1", "Asha Rao Changed", 25, "Cash", kind="balance")
s, r = api("/api/backup/sheet/touch", {"paths": ["payments/p13"]}, ST)
step("touch while Google refuses still answers 200 ok:false (the sale already went through)", s == 200 and r.get("ok") is False, f"{s} {r}")
s, st = api("/api/backup/sheet/status", None, OT, "GET")
step("status shows the error and the steps left; no token or key in it", st["lastError"] and "403" in st["lastError"] and st["pending"] > 0 and "fake-token" not in json.dumps(st) and "PRIVATE KEY" not in json.dumps(st), st)
fake_post("/__control", {"failNext": {"status": 0, "count": 0}})
r = sync_until_done(OT)
s, st = api("/api/backup/sheet/status", None, OT, "GET")
T = tabs()
step("after Google recovers the next sync finishes and clears the error", r.get("done") and not st["lastError"] and st["pending"] == 0 and len(data_rows(T[CUR])) == CUR_ROWS + 3, (r, st["lastError"], len(data_rows(T[CUR]))))
pay("p14", 1, "c1", "Asha Rao Changed", 10, "Cash", kind="balance")
fake_post("/__control", {"failNext": {"status": 429, "count": 1}})
t0 = time.time()
s, r = api("/api/backup/sheet/touch", {"paths": ["payments/p14"]}, ST)
T = tabs()
step("a 429 from Google is retried and the change still lands", r.get("ok") is True and len(data_rows(T[CUR])) == CUR_ROWS + 4, (r, round(time.time() - t0, 1)))

# ------------------------------------------------------------------------------- the night cron
print("\n== night cron")
s, r = req(f"{BASE}/api/cron/night", "POST", None, "localtest")
sb = (r or {}).get("sheetBackup", {})
step("night job runs the sheet backup (nightly mode) and finishes", s == 200 and sb.get("done") is True and "readme" in sb.get("wrote", []), f"{s} {r}")
T = tabs()
step("after a full night run there is still one banding, 5 colour rules", T[CUR]["bandingCount"] == 1 and T[CUR]["conditionalCount"] == 5, (T[CUR]["bandingCount"], T[CUR]["conditionalCount"]))
s, r = req(f"{BASE}/api/cron/morning", "POST", None, "localtest")
step("the morning job does not run the backup", "sheetBackup" not in (r or {}), r)

# ------------------------------------------------------------------------------- unchanged restore tabs
print("\n== unchanged restore tabs are left alone")
n0 = len(fake()["requests"])
r = sync_until_done(OT, {"mode": "full"})
puts = [x for x in fake()["requests"][n0:] if x.startswith("PUT") and "_data_" in x]
step("a full sync with no changes rewrites no restore tab", r.get("done") and not puts, puts)
put("clients/c2", {**get("clients/c2"), "fullName": "Bala Changed"})
n0 = len(fake()["requests"])
r = sync_until_done(OT, {"mode": "full"})
puts = [x for x in fake()["requests"][n0:] if x.startswith("PUT") and "_data_" in x]
step("a changed collection is rewritten, the others are not", r.get("done") and len(puts) == 1 and "_data_clients" in puts[0], puts)
step("and the new name is in the copy", any("Bala Changed" in "".join(str(c) for c in row[2:]) for row in tabs()["_data_clients"]["values"][1:]), "")

# ------------------------------------------------------------------------------- settings
print("\n== change sheet")
s, r = api("/api/backup/sheet/settings", {"sheetUrl": "hello"}, OT)
step("not a sheet link: 400", s == 400, f"{s} {r}")
s, r = api("/api/backup/sheet/settings", {"sheetUrl": "https://docs.google.com/spreadsheets/d/NOACCESS1234567890abcdefgh/edit"}, OT)
step("a sheet the app cannot open: 400 telling the owner to share it as Editor with the account", s == 400 and "Editor" in r.get("error", "") and EMAIL in r.get("error", ""), f"{s} {r}")
s, r = api("/api/backup/sheet/settings", {"sheetUrl": "https://docs.google.com/spreadsheets/d/GOODSHEET1234567890abcdefgh/edit#gid=0"}, OT)
s2, st = api("/api/backup/sheet/status", None, OT, "GET")
step("a sheet it can open is saved", s == 200 and "GOODSHEET1234567890abcdefgh" in st["sheetUrl"] and st["pending"] == 0, f"{s} {r} {st}")
api("/api/backup/sheet/settings", {"sheetUrl": "1Rsn0jB8HX8TsbYmrxeT6VCPl4wcmyh2VhU7yy2_qJxc"}, OT)

# ------------------------------------------------------------------------------- secrets
print("\n== secrets stay out")
blob = json.dumps(fake())
step("no secret value, key or token in anything written to the sheet", all(x not in blob for x in ("K-SECRET-VALUE", "VAULT-SECRET-VALUE", "BEGIN PRIVATE KEY", "fake-token")), "")
tr = fake()["tokenRequests"]
step("Google sign-in: a signed JWT for the spreadsheets scope from the service account", tr and tr[0]["parts"] == 3 and tr[0]["iss"] == EMAIL and tr[0]["scope"].endswith("/auth/spreadsheets"), tr[:1])
step("the token was fetched once and reused (cached)", len(tr) <= 3, len(tr))
if SERVER_LOG and os.path.exists(SERVER_LOG):
    log = open(SERVER_LOG, encoding="utf-8", errors="replace").read()
    step("server log has no token or key", "fake-token" not in log and "BEGIN PRIVATE KEY" not in log, "")

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
