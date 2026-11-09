import { after, before, test } from "node:test";
import { env, seed, LOGINS, owner, staff, nobody, assertFails, assertSucceeds } from "./helpers.mjs";

let t;
const TOKEN = "AbCdEfGhIjKlMnOpQrStUv_-";
const TOKEN2 = "ZyXwVuTsRqPoNmLkJiHgFe12";
const newLink = (over = {}) => ({
  name: "Front desk",
  active: true,
  responseCount: 0,
  lastResponseAt: null,
  rate: null,
  createdBy: "Desk",
  createdAt: new Date(),
  updatedBy: "Desk",
  updatedAt: new Date(),
  ...over,
});
const message = {
  linkId: TOKEN,
  linkName: "Front desk",
  kind: "complaint",
  rating: 2,
  message: "Washroom was not clean",
  day: "2026-11-09",
  status: "new",
  note: "",
  noteBy: "",
  resolvedBy: "",
  resolvedAt: null,
  createdAt: new Date(),
};

before(async () => {
  t = await env();
  await seed(t, {
    ...LOGINS,
    "staffAccess/fb": { active: true, admin: false, permissions: ["feedback"] },
    [`feedbackLinks/${TOKEN}`]: newLink({ responseCount: 3 }),
    "anonymousFeedback/a1": message,
    "anonFeedbackRate/s_x": { day: "2026-11-09", count: 1 },
  });
});
after(() => t.cleanup());

test("Member feedback logins make, rename and switch off QR links", async () => {
  const fb = staff(t, "fb");
  await assertSucceeds(fb.collection("feedbackLinks").get());
  await assertSucceeds(fb.doc(`feedbackLinks/${TOKEN2}`).set(newLink({ name: "Changing room" })));
  await assertSucceeds(
    fb.doc(`feedbackLinks/${TOKEN2}`).update({ name: "Ladies changing room", updatedAt: new Date() }),
  );
  await assertSucceeds(fb.doc(`feedbackLinks/${TOKEN}`).update({ active: false }));
  // Nothing taken yet: it may go. One with messages stays.
  await assertSucceeds(fb.doc(`feedbackLinks/${TOKEN2}`).delete());
  await assertFails(fb.doc(`feedbackLinks/${TOKEN}`).delete());
});

test("links: a real token id, a sane name, counters only from the server", async () => {
  const fb = staff(t, "fb");
  await assertFails(fb.doc("feedbackLinks/short").set(newLink()));
  await assertFails(fb.doc(`feedbackLinks/${TOKEN2}`).set(newLink({ name: "A" })));
  await assertFails(fb.doc(`feedbackLinks/${TOKEN2}`).set(newLink({ name: "x".repeat(61) })));
  await assertFails(fb.doc(`feedbackLinks/${TOKEN2}`).set(newLink({ responseCount: 50 })));
  await assertFails(fb.doc(`feedbackLinks/${TOKEN2}`).set(newLink({ extra: 1 })));
  await assertFails(fb.doc(`feedbackLinks/${TOKEN}`).update({ responseCount: 0 }));
  await assertFails(fb.doc(`feedbackLinks/${TOKEN}`).update({ active: "no" }));
});

test("messages: read and resolve with a note; the text never changes; nobody adds one", async () => {
  const fb = staff(t, "fb");
  await assertSucceeds(fb.collection("anonymousFeedback").where("status", "==", "new").get());
  await assertSucceeds(
    fb.doc("anonymousFeedback/a1").update({
      status: "resolved",
      resolvedBy: "Desk",
      resolvedAt: new Date(),
      note: "Cleaner told",
      noteBy: "Desk",
    }),
  );
  await assertFails(fb.doc("anonymousFeedback/a1").update({ message: "edited" }));
  await assertFails(fb.doc("anonymousFeedback/a1").update({ rating: 5 }));
  await assertFails(fb.doc("anonymousFeedback/a1").update({ status: "spam" }));
  await assertFails(fb.doc("anonymousFeedback/a1").update({ note: "x".repeat(501) }));
  await assertFails(fb.doc("anonymousFeedback/a2").set(message));
  await assertFails(owner(t).doc("anonymousFeedback/a2").set(message));
  await assertFails(nobody(t).doc("anonymousFeedback/a2").set(message));
});

test("only the owner removes a message (spam)", async () => {
  await assertFails(staff(t, "fb").doc("anonymousFeedback/a1").delete());
  await assertFails(staff(t, "all").doc("anonymousFeedback/a1").delete());
  await assertSucceeds(owner(t).doc("anonymousFeedback/a1").delete());
});

test("other logins, switched off or none see nothing; counters are server only", async () => {
  await assertFails(staff(t, "desk").doc(`feedbackLinks/${TOKEN}`).get());
  await assertFails(staff(t, "desk").collection("anonymousFeedback").get());
  await assertFails(staff(t, "off").collection("anonymousFeedback").get());
  await assertFails(nobody(t).doc(`feedbackLinks/${TOKEN}`).get());
  await assertFails(nobody(t).collection("anonymousFeedback").get());
  await assertFails(owner(t).doc("anonFeedbackRate/s_x").get());
  await assertFails(staff(t, "fb").doc("anonFeedbackRate/s_x").set({ day: "x", count: 0 }));
});
