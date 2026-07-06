import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capAdvanceAmount } from "./bid-sizing.js";

describe("capAdvanceAmount", () => {
  it("caps to face value when advance exceeds invoice", () => {
    assert.equal(capAdvanceAmount("1500", "2", "2000"), "2");
  });

  it("caps to max exposure when lower than face value", () => {
    assert.equal(capAdvanceAmount("500", "2000", "300"), "300");
  });

  it("leaves advance unchanged when within limits", () => {
    assert.equal(capAdvanceAmount("1.5", "2", "2000"), "1.5");
  });
});
