/**
 * Pins the v1 signature contract: nothing automatic. When per-user
 * signatures land, replace this with tests for lookup + sanitize.
 */

import { expect, test } from "vitest";
import { getEmailSignature } from "./email-signature";

test("v1: no automatic signature — composers seed an empty editor", () => {
  expect(getEmailSignature()).toBeNull();
});
