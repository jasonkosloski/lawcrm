import { describe, expect, test } from "vitest";
import {
  documentRequestEmail,
  documentsSharedEmail,
  invoicePostedEmail,
  portalMessageEmail,
  statusUpdateEmail,
} from "./emails";

const LINK = "https://portal.example.com/x?a=1&b=2";

describe("portal notification emails", () => {
  test("keep their exact wording around the link", () => {
    expect(statusUpdateEmail(LINK)).toEqual({
      subject: "Your legal team posted an update",
      text: `Your legal team posted an update on your case. Sign in to the client portal to read it:\n\n${LINK}`,
      html: `<p>Your legal team posted an update on your case. Sign in to the client portal to read it:</p><p><a href="https://portal.example.com/x?a=1&amp;b=2">Open the client portal</a></p>`,
    });
  });

  test("every one links to the portal and ends the prompt with a colon", () => {
    for (const build of [
      documentRequestEmail,
      documentsSharedEmail,
      statusUpdateEmail,
      portalMessageEmail,
      invoicePostedEmail,
    ]) {
      const email = build(LINK);
      expect(email.text.endsWith(`:\n\n${LINK}`)).toBe(true);
      expect(email.html).toContain(">Open the client portal</a>");
    }
  });
});
