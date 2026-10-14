"""Google Sheet backup, browser side (Task 5): the Backup card, the dashboard warning, and the "touch" ping after
a staff member saves. Runs after sheet_backup_local.py against the same local stand-ins (emulators + fake Sheets);
the app must be built with VITE_USE_EMULATORS=1 (see sheet_backup_run.sh). Nothing here touches production.

Screenshots go to $SHEET_SHOTS (default: next to the test logs)."""
import json, os, sys, time, urllib.request
from datetime import datetime, timedelta, timezone

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from emu_helpers import BASE, FS, req, put, signup  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

FAKE = os.environ.get("FAKE_SHEETS", "http://127.0.0.1:5799")
SHOTS = os.environ.get("SHEET_SHOTS", os.path.join(os.environ.get("TMPDIR", "."), "shots"))
os.makedirs(SHOTS, exist_ok=True)
SERVICE_EMAIL = "backup-test@leadsmanage-1f7cd.iam.gserviceaccount.com"
OWNER = ("admin@elevategym.com", "Elevate@12345")
STAFF = ("desk2@test.local", "secret123")
results = []


def step(name, ok, info=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"   <- {info}"))


def fake(path="/__dump"):
    return json.loads(urllib.request.urlopen(FAKE + path).read() or b"{}")


def tabs():
    return {t["title"]: t for t in fake()["tabs"]}


def patch_state(**fields):
    """Change fields of the server's backup state (admin bypass), to stage stale / failed situations."""
    from emu_helpers import conv
    mask = "&".join(f"updateMask.fieldPaths={k}" for k in fields)
    s, r = req(f"{FS}/serverSecrets/sheetBackup?{mask}", "PATCH", {"fields": {k: conv(v) for k, v in fields.items()}})
    assert s == 200, (s, r)


CUR = {"page": None}


def pause(seconds):
    """Wait while the browser keeps delivering its events (plain time.sleep would leave request listeners unserved)."""
    pg = CUR["page"]
    if pg is not None:
        pg.wait_for_timeout(int(seconds * 1000))
    else:
        time.sleep(seconds)


def wait_for(fn, seconds=20, every=0.4):
    end = time.time() + seconds
    while time.time() < end:
        try:
            v = fn()
            if v: return v
        except Exception:
            pass
        pause(every)
    return None


# ------------------------------------------------------------------------------- people
signup(*OWNER)
staff = signup(*STAFF)
print("staff uid", staff.get("localId"), staff.get("error"))
print("staffAccess put:", put(f"staffAccess/{staff['localId']}", {"active": True, "admin": False, "permissions": ["members", "finance", "backup"],
                                         "staffId": "", "email": STAFF[0], "name": "Desk Two"}))
put("expenses/e1", {"title": "Electricity", "category": "Utilities", "amount": 1200, "paymentMethod": "Cash",
                    "date": datetime.now(timezone(timedelta(hours=5, minutes=30))).strftime("%Y-%m-%d"), "description": "", "notes": "", "createdBy": "Owner"})
patch_state(lastOkAt=None, lastError=None, checks=[], queue=[])


def login(browser, who, theme="light", width=1440, height=900):
    ctx = browser.new_context(viewport={"width": width, "height": height}, permissions=["clipboard-read", "clipboard-write"])
    ctx.add_init_script(f"localStorage.setItem('rebuild-fitness-theme','{theme}');")
    page = ctx.new_page()
    CUR["page"] = page
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE + "/login")
    page.fill("#email", who[0])
    page.fill("#password", who[1])
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url("**/dashboard", timeout=30000)
    return ctx, page, errors


def add_expense(page, title, amount):
    """Fill and save the Add expense dialog on /expenses. Shows what the page says when the button is missing."""
    page.get_by_role("tab", name="Expenses", exact=True).click()  # the page opens on "Profit & income"
    btn = page.get_by_role("button", name="Add expense").first
    try:
        btn.wait_for(timeout=20000)
    except Exception:
        print("  /expenses shows:", page.locator("body").inner_text()[:500].replace(chr(10), " | "))
        page.screenshot(path=f"{SHOTS}/debug-expenses.png")
        raise
    btn.click()
    dlg = page.get_by_role("dialog")
    dlg.get_by_label("Expense Title").fill(title)
    dlg.locator("#expense-category").click()
    page.get_by_role("option").first.click()
    dlg.locator("#expense-amount").fill(str(amount))
    dlg.get_by_role("button", name="Add expense").click()
    page.get_by_text("Expense added").first.wait_for(timeout=15000)


def snap(page, name, full=False):
    """Screenshot after the page's fade-in has finished (otherwise light pages look washed out)."""
    page.wait_for_timeout(900)
    page.screenshot(path=f"{SHOTS}/{name}.png", full_page=full)


def status_text(page):
    return page.get_by_test_id("sheet-status").inner_text()


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ----------------------------------------------------------------------- owner
    print("== owner: dashboard warning + Backup card")
    ctx, page, errors = login(browser, OWNER)
    step("never filled: the dashboard shows the small warning row", wait_for(lambda: page.get_by_test_id("sheet-warning").is_visible()), "")
    warn = page.get_by_test_id("sheet-warning")
    step("warning says 'Google Sheet backup needs attention'", warn.is_visible() and "Google Sheet backup needs attention" in warn.inner_text(), "")
    step("warning is one short row, not a big banner", warn.bounding_box()["height"] < 56, warn.bounding_box())
    snap(page, "dashboard-warning-light-1440", full=True)
    warn.click()
    page.wait_for_url("**/backup", timeout=15000)
    card = page.get_by_role("region", name="Google Sheet backup")
    wait_for(lambda: card.is_visible(), 20)  # the URL changes a moment before the page content does
    step("the link opens /backup with the card on top", card.is_visible() and "A copy of every member, plan and payment" in card.inner_text(), "")
    step("the card is the first thing under the page heading", page.locator("main section").first.get_attribute("aria-labelledby") == "sheet-backup-title", page.locator("main section").first.get_attribute("aria-labelledby"))
    step("status says the sheet is not filled yet", wait_for(lambda: "not been filled" in status_text(page)), status_text(page))
    step("'Open the sheet' opens in a new tab safely", (lambda a: a.get_attribute("target") == "_blank" and "noopener" in a.get_attribute("rel") and "/spreadsheets/d/" in a.get_attribute("href"))(page.get_by_role("link", name="Open the sheet")), "")

    # Sync now
    page.get_by_role("button", name="Sync now").click()
    step("while syncing the card shows a step number and the button is busy",
         wait_for(lambda: page.get_by_test_id("sheet-status").get_attribute("data-state") == "updating" and "Updating the sheet" in status_text(page), 8, 0.05)
         or wait_for(lambda: "Up to date" in status_text(page), 1), status_text(page))
    step("Sync now finishes: green 'Up to date · matches the app · last updated …'",
         wait_for(lambda: page.get_by_test_id("sheet-status").get_attribute("data-state") == "ok", 120) is not None and "matches the app" in status_text(page) and "last updated" in status_text(page), status_text(page))
    step("and a success toast says so", page.get_by_text("The Google Sheet is up to date.").first.is_visible(), "")
    T = tabs()
    step("the fake sheet now holds the tabs", "Members" in T and any(t.startswith("_data_") for t in T), list(T)[:6])
    snap(page, "backup-ok-light-1440")
    page.goto(BASE + "/dashboard")
    page.get_by_role("heading", name="Needs attention").wait_for()
    pause(1.5)
    step("fresh and matching: no warning on the dashboard", page.get_by_test_id("sheet-warning").count() == 0, "")

    # stale (older than 26 h)
    old = (datetime.now(timezone.utc) - timedelta(hours=30)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    patch_state(lastOkAt=old, lastRunAt=old)
    page.reload()
    step("last good update 30 h ago: the warning row appears", wait_for(lambda: page.get_by_test_id("sheet-warning").is_visible()), "")
    page.goto(BASE + "/backup")
    step("the card says it has not been updated since then", wait_for(lambda: "Not updated since" in status_text(page)) and page.get_by_test_id("sheet-status").get_attribute("data-state") == "problem", status_text(page))
    snap(page, "backup-stale-light-1440")

    # failed check
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    patch_state(lastOkAt=now_iso, lastRunAt=now_iso, checks=[{"name": "Totals match the dashboard", "ok": False, "detail": "Sheet 1,500 but app 2,000"}])
    page.reload()
    step("a failed check shows red with its name and detail",
         wait_for(lambda: "Totals match the dashboard" in status_text(page)) and page.get_by_test_id("sheet-status").get_attribute("data-state") == "problem" and "Sheet 1,500 but app 2,000" in status_text(page), status_text(page))
    snap(page, "backup-failed-light-1440")
    page.goto(BASE + "/dashboard")
    step("a failed check also raises the dashboard warning (even when fresh)", wait_for(lambda: page.get_by_test_id("sheet-warning").is_visible()), "")

    # last run failed
    patch_state(checks=[], lastRunAt=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.999Z"), lastError="Google refused (403): no access")
    page.goto(BASE + "/backup")
    step("a failed last run shows the error in plain words", wait_for(lambda: "Google refused (403)" in status_text(page)) and "last update failed" in status_text(page), status_text(page))

    # Sync clears it
    page.get_by_role("button", name="Sync now").click()
    step("Sync now clears the red note", wait_for(lambda: page.get_by_test_id("sheet-status").get_attribute("data-state") == "ok", 120), status_text(page))

    # Change sheet
    print("\n== owner: change sheet")
    page.get_by_role("button", name="Change sheet").click()
    box = page.get_by_label("Link to the Google Sheet")
    step("Change sheet opens an input with a label", box.is_visible(), "")
    step("it shows the account to share with, and the hint", page.get_by_text(SERVICE_EMAIL).is_visible() and page.get_by_text("Share the sheet with this email as Editor").is_visible(), "")
    page.get_by_role("button", name="Copy").click()
    copied = wait_for(lambda: page.evaluate("navigator.clipboard.readText()") == SERVICE_EMAIL, 5)
    step("Copy puts the email on the clipboard", copied, "")
    snap(page, "backup-change-light-1440")
    save = page.get_by_role("button", name="Save", exact=True)
    step("Save is off until something is typed", save.is_disabled(), "")
    box.fill("hello")
    save.click()
    step("a bad link shows the server's message under the input", wait_for(lambda: "does not look like a Google Sheet link" in page.get_by_role("alert").inner_text()), "")
    box.fill("https://docs.google.com/spreadsheets/d/NOACCESS1234567890abcdefgh/edit")
    save.click()
    step("a sheet the app can't open says to share it as Editor with the account",
         wait_for(lambda: "Editor" in page.get_by_role("alert").inner_text() and SERVICE_EMAIL in page.get_by_role("alert").inner_text()), "")
    box.fill("https://docs.google.com/spreadsheets/d/GOODSHEET1234567890abcdefgh/edit")
    box.press("Enter")
    step("Enter saves a good link, closes the panel and shows 'not filled yet'",
         wait_for(lambda: box.count() == 0) and wait_for(lambda: "not been filled" in status_text(page)), status_text(page))
    step("'Open the sheet' now points at the new sheet", "GOODSHEET1234567890abcdefgh" in page.get_by_role("link", name="Open the sheet").get_attribute("href"), "")
    # back to the first sheet
    page.get_by_role("button", name="Change sheet").click()
    page.get_by_label("Link to the Google Sheet").fill("1Rsn0jB8HX8TsbYmrxeT6VCPl4wcmyh2VhU7yy2_qJxc")
    page.get_by_role("button", name="Save", exact=True).click()
    wait_for(lambda: page.get_by_label("Link to the Google Sheet").count() == 0)
    page.get_by_role("button", name="Sync now").click()
    step("back on the first sheet and synced", wait_for(lambda: page.get_by_test_id("sheet-status").get_attribute("data-state") == "ok", 120), status_text(page))

    # keyboard: tab order reaches the three buttons, visible focus ring
    page.goto(BASE + "/backup")
    page.get_by_test_id("sheet-status").wait_for()
    page.get_by_role("link", name="Open the sheet").focus()
    page.keyboard.press("Tab")
    focused = page.evaluate("document.activeElement.textContent.trim()")
    ring = page.evaluate("getComputedStyle(document.activeElement).boxShadow")
    step("keyboard: Tab goes from 'Open the sheet' to 'Sync now' with a visible focus ring", focused == "Sync now" and ring not in ("none", ""), (focused, ring))
    step("no script errors in the owner session", not errors, errors[:3])
    ctx.close()

    # ----------------------------------------------------------------------- staff
    print("\n== staff: no card, no warning, touch after a save")
    old = (datetime.now(timezone.utc) - timedelta(hours=40)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    patch_state(lastOkAt=old, lastRunAt=old)  # stale, so a leak of the warning would show
    ctx, page, errors = login(browser, STAFF)
    page.on("console", lambda m: print("  console:", m.text[:300]) if m.type in ("error", "warning") else None)
    page.reload()
    touches = []
    page.on("request", lambda r: touches.append(json.loads(r.post_data or "{}")) if r.url.endswith("/api/backup/sheet/touch") else None)
    statuses = []
    page.on("request", lambda r: statuses.append(r.url) if r.url.endswith("/api/backup/sheet/status") else None)
    pause(2)
    step("staff dashboard has no backup warning and never asks for the status", page.get_by_test_id("sheet-warning").count() == 0 and not statuses, statuses)
    page.goto(BASE + "/backup")
    if not wait_for(lambda: "kept exactly as it was exported" in page.locator("main").inner_text(), 30):
        print("staff /backup shows:", page.locator("body").inner_text()[:600].replace(chr(10), " | "))
    pause(1.5)
    step("staff with Backup access see the page but not the Google Sheet card", page.get_by_role("region", name="Google Sheet backup").count() == 0 and "Google Sheet backup" not in page.locator("main").inner_text() and not statuses, statuses)
    step("no touch is sent just for looking", not touches, touches)

    # a save with a short wait (test hook)
    page.evaluate("window.__SHEET_TOUCH_MS = 1500")
    page.goto(BASE + "/expenses")
    page.evaluate("window.__SHEET_TOUCH_MS = 1500")
    add_expense(page, "Gym chalk", 321)
    t0 = time.time()
    step("saving an expense sends a touch naming it after the wait", wait_for(lambda: any(any(x.startswith("expenses/") for x in t.get("paths", [])) for t in touches), 15), touches)
    step("the ping waits for the delay instead of firing at once", time.time() - t0 > 0.5, round(time.time() - t0, 2))
    step("and the audit-log line the save wrote is not sent (only watched collections)", all(all(not x.startswith("auditLogs/") for x in t.get("paths", [])) for t in touches), touches)

    def sheet_has(text):
        T = tabs()
        return any(text in "".join(str(c) for c in row) for row in T.get("Expenses", {"values": []})["values"])
    step("the new expense reaches the fake Google Sheet", wait_for(lambda: sheet_has("Gym chalk"), 40), "")

    # page hide flushes at once
    n = len(touches)
    page.evaluate("window.__SHEET_TOUCH_MS = 600000")
    add_expense(page, "Water cans", 55)
    pause(1)
    step("with a long wait nothing is sent yet", len(touches) == n, touches[n:])
    page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'}); document.dispatchEvent(new Event('visibilitychange'))")
    step("hiding the page sends the waiting ping at once", wait_for(lambda: len(touches) > n and any(x.startswith("expenses/") for x in touches[-1].get("paths", [])), 10), touches[n:])
    step("and that expense reaches the sheet too", wait_for(lambda: sheet_has("Water cans"), 40), "")
    step("no script errors in the staff session", not errors, errors[:3])
    ctx.close()

    # ----------------------------------------------------------------------- not signed in
    ctx = browser.new_context()
    page = ctx.new_page()
    CUR["page"] = page
    seen = []
    page.on("request", lambda r: seen.append(r.url) if "/api/backup/sheet/" in r.url else None)
    page.goto(BASE + "/login")
    pause(2)
    step("signed out: the login page sends no backup requests", not seen, seen)
    ctx.close()

    # ----------------------------------------------------------------------- screenshots (owner, 2 themes x 2 widths)
    print("\n== screenshots")
    patch_state(lastOkAt=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"), checks=[], lastError=None)
    for theme in ("light", "dark"):
        for w, h in ((390, 844), (1440, 900)):
            ctx, page, errors = login(browser, OWNER, theme, w, h)
            # healthy
            page.goto(BASE + "/backup")
            page.get_by_test_id("sheet-status").wait_for()
            wait_for(lambda: page.get_by_test_id("sheet-status").get_attribute("data-state") == "ok", 10)
            snap(page, f"backup-{theme}-{w}")
            noscroll = page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            step(f"/backup {theme} {w}px: no sideways scroll", noscroll, page.evaluate("document.documentElement.scrollWidth"))
            # problem + change panel open
            patch_state(checks=[{"name": "Totals match the dashboard", "ok": False, "detail": "Sheet 1,500 but app 2,000"}])
            page.reload()
            wait_for(lambda: page.get_by_test_id("sheet-status").get_attribute("data-state") == "problem", 10)
            page.get_by_role("button", name="Change sheet").click()
            snap(page, f"backup-problem-{theme}-{w}")
            noscroll = page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            step(f"/backup problem+panel {theme} {w}px: no sideways scroll", noscroll, "")
            # dashboard with the warning
            page.goto(BASE + "/dashboard")
            page.get_by_test_id("sheet-warning").wait_for(timeout=15000)
            snap(page, f"dashboard-{theme}-{w}", full=True)
            noscroll = page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            step(f"/dashboard {theme} {w}px: warning shows, no sideways scroll", noscroll, "")
            patch_state(checks=[])
            ctx.close()
    browser.close()

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
