import assert from "node:assert/strict";
import { test } from "node:test";
import { billBusiness } from "./invoice-utils.ts";

test("billBusiness: a bill with no business block still renders (old-software carry)", () => {
  const b = billBusiness(undefined);
  assert.equal(b.address, "");
  assert.equal(b.businessName, "");
  assert.equal(b.taxRate, 0);
});

test("billBusiness: keeps only the billing fields, fills the gaps", () => {
  const b = billBusiness({ businessName: "Gym", address: "Main Rd", taxRate: 18, secret: "x" });
  assert.equal(b.businessName, "Gym");
  assert.equal(b.address, "Main Rd");
  assert.equal(b.taxRate, 18);
  assert.equal(b.phone, "");
  assert.equal(b.invoicePrefix, "INV");
  assert.equal("secret" in b, false);
});

test("billBusiness: wrong types fall back to defaults", () => {
  const b = billBusiness({ address: 5, taxRate: "18", taxEnabled: "yes" });
  assert.equal(b.address, "");
  assert.equal(b.taxRate, 0);
  assert.equal(b.taxEnabled, false);
});
