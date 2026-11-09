"""Anonymous feedback QR, end to end on the local emulators + built app server (scripts/test/anon_feedback_run.sh). Nothing touches production."""
import json, os, sys, time, urllib.request
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from emu_helpers import BASE, FS, OWNER_EMAIL, OWNER_PASSWORD, req, put, get, signup  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS = os.environ.get("SHOTS", os.path.join(os.environ.get("TMPDIR", "."), "anon-shots"))
os.makedirs(SHOTS, exist_ok=True)
OWNER = (OWNER_EMAIL, OWNER_PASSWORD)
FB = ("fb@test.local", "secret123")
DESK = ("desk@test.local", "secret123")
results = []


def step(name, ok, info=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"   <- {info}"))


def api(token, body=None, device="dev-A"):
    data = None if body is None else json.dumps({"device": device, **body}).encode()
    r = urllib.request.Request(f"{BASE}/api/feedback/{token}", data=data, method="POST" if body is not None else "GET",
                               headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r) as x: return x.status, json.loads(x.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")


def list_docs(col):
    s, r = req(f"{FS}/{col}?pageSize=300")
    return r.get("documents", [])


signup(*OWNER)
fb = signup(*FB)
desk = signup(*DESK)
put(f"staffAccess/{fb['localId']}", {"active": True, "admin": False, "permissions": ["feedback"], "staffId": "", "email": FB[0], "name": "Feedback Staff"})
put(f"staffAccess/{desk['localId']}", {"active": True, "admin": False, "permissions": ["members"], "staffId": "", "email": DESK[0], "name": "Desk"})
put("settings/business", {"businessName": "Rebuild Fitness", "logoUrl": ""})


def ctx_for(browser, theme, width, height=900):
    ctx = browser.new_context(viewport={"width": width, "height": height}, accept_downloads=True,
                              permissions=["clipboard-read", "clipboard-write"])
    ctx.add_init_script(f"try{{localStorage.setItem('rebuild-fitness-theme','{theme}')}}catch(e){{}}")
    return ctx


def login(browser, who, theme="light", width=1440):
    ctx = ctx_for(browser, theme, width)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(BASE + "/login")
    page.fill("#email", who[0])
    page.fill("#password", who[1])
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url("**/dashboard", timeout=30000)
    return ctx, page, errs


with sync_playwright() as p:
    b = p.chromium.launch(headless=True)

    # ---- staff with "Member feedback" makes two QRs
    ctx, page, errs = login(b, FB)
    page.goto(BASE + "/anonymous-feedback")
    page.get_by_role("heading", name="Anonymous feedback").wait_for(timeout=20000)
    step("menu shows Anonymous feedback", page.get_by_role("link", name="Anonymous feedback").count() > 0)
    page.screenshot(path=f"{SHOTS}/01-empty-inbox.png", full_page=True)
    for name in ["Front desk", "Ladies changing room"]:
        page.get_by_role("button", name="New QR").click()
        page.get_by_label("Name").fill(name)
        page.get_by_role("button", name="Make QR").click()
        page.get_by_text("QR ready").first.wait_for(timeout=15000)
        page.wait_for_timeout(600)
    page.get_by_role("heading", name="Ladies changing room").wait_for(timeout=10000)
    links = {d["fields"]["name"]["stringValue"]: d["name"].split("/")[-1] for d in list_docs("feedbackLinks")}
    step("two links saved with 24-char tokens", len(links) == 2 and all(len(t) == 24 for t in links.values()), links)
    tok = links["Front desk"]

    # Poster downloads
    card = page.locator("li", has=page.get_by_role("heading", name="Front desk"))
    for item, ext in [("Poster · PDF (A4)", "pdf"), ("Poster · PNG image", "png"), ("QR code only · PNG", "png")]:
        card.get_by_role("button", name="Download").click()
        with page.expect_download(timeout=20000) as dl:
            page.get_by_role("menuitem", name=item).click()
        path = f"{SHOTS}/dl-{item.split()[0].lower()}-{dl.value.suggested_filename}"
        dl.value.save_as(path)
        step(f"download {item}", os.path.getsize(path) > 5000, os.path.getsize(path))
    step("no page errors on staff page", not errs, errs)
    ctx.close()

    # ---- public page: info, form, send
    s, info = api(tok)
    step("GET link info", s == 200 and info.get("on") and info.get("place") == "Front desk" and info.get("gymName") == "Rebuild Fitness", (s, info))
    for theme in ["light", "dark"]:
        for w in [390, 1440]:
            c = ctx_for(b, theme, w)
            pg = c.new_page()
            pg.goto(f"{BASE}/f/{tok}")
            pg.get_by_role("heading", name="Tell us honestly").wait_for(timeout=20000)
            pg.screenshot(path=f"{SHOTS}/public-form-{theme}-{w}.png", full_page=True)
            c.close()

    c = ctx_for(b, "light", 390)
    pg = c.new_page()
    perr = []
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(f"{BASE}/f/{tok}")
    pg.get_by_role("heading", name="Tell us honestly").wait_for(timeout=20000)
    pg.get_by_role("button", name="Send anonymously").click()
    step("empty message refused", pg.get_by_role("alert").inner_text().startswith("Write a few words"))
    pg.locator("label", has_text="Complaint").click()
    pg.get_by_label("2 of 5: Bad").check(force=True)
    pg.get_by_label("Your message").fill("Washroom near cardio area was not clean in the evening.")
    pg.get_by_role("button", name="Send anonymously").click()
    pg.get_by_role("heading", name="Thank you!").wait_for(timeout=15000)
    pg.screenshot(path=f"{SHOTS}/public-done-light-390.png", full_page=True)
    step("no page errors on public page", not perr, perr)
    c.close()

    msgs = list_docs("anonymousFeedback")
    step("one message stored", len(msgs) == 1, len(msgs))
    f = msgs[0]["fields"]
    keys = set(f)
    allowed = {"linkId", "linkName", "kind", "rating", "message", "day", "status", "note", "noteBy", "resolvedBy", "resolvedAt", "createdAt"}
    step("message holds nothing about the sender", keys == allowed, keys ^ allowed)
    created = f["createdAt"]["timestampValue"]
    step("time kept only to the hour", created.endswith(":00:00Z") or ":00:00." in created, created)
    step("kind + rating saved", f["kind"]["stringValue"] == "complaint" and f["rating"]["integerValue"] == "2", f)
    lk = get(f"feedbackLinks/{tok}")
    step("link counts the response", lk["responseCount"] == 1 and lk["lastResponseAt"], lk)

    # ---- spam and abuse limits
    s, r = api(tok, {"kind": "idea", "message": "x", "rating": 0})
    step("too-short message 400", s == 400, (s, r))
    n_before = len(list_docs("anonymousFeedback"))
    s, r = api(tok, {"kind": "idea", "message": "buy cheap followers now", "website": "http://spam"})
    step("honeypot says ok, keeps nothing", s == 200 and len(list_docs("anonymousFeedback")) == n_before, (s, r))
    codes = [api(tok, {"kind": "idea", "message": f"Idea number {i}", "rating": 4}, device="dev-B")[0] for i in range(6)]
    step("one phone: 5 a day, then 429", codes == [200] * 5 + [429], codes)
    s, _ = api(tok, {"kind": "praise", "message": "Great trainers here", "rating": 5}, device="dev-C")
    step("another phone on the same Wi-Fi still sends", s == 200, s)
    s, _ = api("AAAAAAAAAAAAAAAAAAAAAAAA", {"kind": "idea", "message": "hello there"})
    step("unknown token 404", s == 404, s)
    s, _ = api("short", {"kind": "idea", "message": "hello there"})
    step("bad token 404", s == 404, s)
    s, _ = api(tok, {"kind": "idea", "message": "rating as text", "rating": "5"}, device="dev-D")
    last = sorted(list_docs("anonymousFeedback"), key=lambda d: d["updateTime"])[-1]["fields"]
    step("rating given as text is dropped", s == 200 and last["rating"]["integerValue"] == "0", last.get("rating"))

    # ---- inbox: staff sees, resolves, notes; screenshots
    for theme in ["light", "dark"]:
        for w in [390, 1440]:
            ctx, page, errs = login(b, OWNER, theme, w)
            page.goto(BASE + "/anonymous-feedback")
            page.get_by_text("Washroom near cardio").wait_for(timeout=20000)
            page.screenshot(path=f"{SHOTS}/inbox-{theme}-{w}.png", full_page=True)
            page.goto(BASE + "/anonymous-feedback?view=qr")
            page.get_by_role("heading", name="Front desk").wait_for(timeout=20000)
            page.wait_for_timeout(500)
            page.screenshot(path=f"{SHOTS}/qr-{theme}-{w}.png", full_page=True)
            ctx.close()

    ctx, page, errs = login(b, FB)
    page.goto(BASE + "/anonymous-feedback")
    card = page.locator("li", has_text="Washroom near cardio")
    card.wait_for(timeout=20000)
    step("staff (not owner) sees no Spam button", card.get_by_role("button", name="Spam").count() == 0)
    card.get_by_role("button", name="Add note").click()
    page.get_by_role("textbox", name="Note").fill("Told the cleaning staff")
    page.get_by_role("button", name="Save note").click()
    page.get_by_text("Note saved").first.wait_for(timeout=10000)
    card.get_by_role("button", name="Mark resolved").click()
    page.get_by_text("Marked resolved").first.wait_for(timeout=10000)
    page.wait_for_timeout(800)
    m = get(f"anonymousFeedback/{msgs[0]['name'].split('/')[-1]}")
    step("resolved with note by staff", m["status"] == "resolved" and m["note"] == "Told the cleaning staff" and m["noteBy"], m)
    # Delete a link that has messages: no Remove offered
    page.goto(BASE + "/anonymous-feedback?view=qr")
    qcard = page.locator("li", has=page.get_by_role("heading", name="Front desk"))
    qcard.wait_for(timeout=20000)
    qcard.get_by_role("button", name="More for Front desk").click()
    step("no Remove for a QR with messages", page.get_by_role("menuitem", name="Remove").count() == 0)
    page.keyboard.press("Escape")
    # Switch off, then the public page says so and POST is 409
    qcard.get_by_role("switch").click()
    page.wait_for_timeout(1500)
    s, r = api(tok, {"kind": "idea", "message": "after switch off"}, device="dev-E")
    step("switched-off QR refuses 409", s == 409, (s, r))
    c = ctx_for(b, "light", 390)
    pg = c.new_page()
    pg.goto(f"{BASE}/f/{tok}")
    pg.get_by_role("heading", name="This QR is switched off").wait_for(timeout=15000)
    pg.screenshot(path=f"{SHOTS}/public-off-light-390.png", full_page=True)
    step("public page shows switched off", True)
    c.close()
    # Remove the unused QR
    c2 = page.locator("li", has=page.get_by_role("heading", name="Ladies changing room"))
    c2.get_by_role("button", name="More for Ladies changing room").click()
    page.get_by_role("menuitem", name="Remove").click()
    page.get_by_role("button", name="Remove").click()
    page.wait_for_timeout(1500)
    step("unused QR removed", get(f"feedbackLinks/{links['Ladies changing room']}") is None)
    step("no page errors (feedback staff)", not errs, errs)
    ctx.close()

    # ---- other login can't open the page
    ctx, page, errs = login(b, DESK)
    page.goto(BASE + "/anonymous-feedback")
    page.wait_for_timeout(3000)
    step("login without Member feedback is kept out", page.get_by_text("Washroom near cardio").count() == 0)
    page.screenshot(path=f"{SHOTS}/desk-blocked.png")
    ctx.close()

    # ---- audit log has no line for the submit, has lines for staff actions
    logs = [d["fields"] for d in list_docs("auditLogs")]
    anon_create = [l for l in logs if l.get("collection", {}).get("stringValue") == "anonymousFeedback" and l.get("action", {}).get("stringValue") == "create"]
    step("no Activity-log line for a submitted message", not anon_create, anon_create[:1])
    b.close()

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
