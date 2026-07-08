/**
 * Unit tests for the pure Gmail-payload parsing helpers.
 *
 * Pins:
 *   - the RFC 5322 address-list subset (angle form, quoted display
 *     names containing commas, bare addresses, encoded-word names,
 *     group-syntax degradation);
 *   - RFC 2047 encoded-word decoding (B + Q, adjacent-word joining);
 *   - the MIME walk against realistic payload shapes:
 *     multipart/alternative, nested multipart/mixed with
 *     attachments, plain-text-only fallback;
 *   - label→flag mapping + the system/CATEGORY_* label filter;
 *   - base64url + snippet entity decoding.
 */

import { describe, expect, it } from "vitest";
import {
  collectAttachments,
  decodeBase64Url,
  decodeHtmlEntities,
  decodeMimeWords,
  extractBodyHtml,
  gmailLabelSlug,
  headerValue,
  isUserLabelId,
  parseAddressList,
  parseGmailMessage,
  textToHtml,
  threadFlags,
  type GmailMessage,
  type GmailMessagePart,
} from "./gmail-message-parse";

const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64url");

describe("decodeBase64Url", () => {
  it("decodes Gmail's URL-safe base64 (- and _ alphabet)", () => {
    // "<a>?~" exercises bytes that differ between base64 variants.
    const raw = "<p>Hello ✓ ?~></p>";
    expect(decodeBase64Url(b64(raw))).toBe(raw);
  });
});

describe("decodeMimeWords", () => {
  it("decodes a UTF-8 B-encoded word", () => {
    expect(
      decodeMimeWords(`=?UTF-8?B?${Buffer.from("José Ávila").toString("base64")}?=`)
    ).toBe("José Ávila");
  });

  it("decodes Q-encoding with underscores-as-spaces and =XX bytes", () => {
    expect(decodeMimeWords("=?utf-8?Q?Jane_Smith?=")).toBe("Jane Smith");
    expect(decodeMimeWords("=?iso-8859-1?Q?Jos=E9?=")).toBe("José");
  });

  it("drops whitespace between adjacent encoded words (RFC 2047)", () => {
    const word = (t: string) =>
      `=?UTF-8?B?${Buffer.from(t).toString("base64")}?=`;
    expect(decodeMimeWords(`${word("Law ")} ${word("Firm")}`)).toBe("Law Firm");
  });

  it("passes plain text through untouched", () => {
    expect(decodeMimeWords("Plain Subject — no encoding")).toBe(
      "Plain Subject — no encoding"
    );
  });
});

describe("parseAddressList", () => {
  it("parses display-name + angle-addr", () => {
    expect(parseAddressList("Jane Smith <jane@firm.com>")).toEqual([
      { name: "Jane Smith", email: "jane@firm.com" },
    ]);
  });

  it("parses quoted display names containing commas", () => {
    expect(
      parseAddressList('"Smith, Jane" <jane@firm.com>, Bob <bob@x.co>')
    ).toEqual([
      { name: "Smith, Jane", email: "jane@firm.com" },
      { name: "Bob", email: "bob@x.co" },
    ]);
  });

  it("parses bare addresses and mixed lists", () => {
    expect(parseAddressList("a@b.com, Carol <c@d.com>")).toEqual([
      { name: "", email: "a@b.com" },
      { name: "Carol", email: "c@d.com" },
    ]);
  });

  it("decodes RFC 2047 display names", () => {
    const encoded = `=?UTF-8?B?${Buffer.from("José Ávila").toString("base64")}?= <jose@firm.mx>`;
    expect(parseAddressList(encoded)).toEqual([
      { name: "José Ávila", email: "jose@firm.mx" },
    ]);
  });

  it("skips group syntax / tokens without an @", () => {
    expect(parseAddressList("undisclosed-recipients:;")).toEqual([]);
  });

  it("returns [] for null / empty input", () => {
    expect(parseAddressList(null)).toEqual([]);
    expect(parseAddressList("   ")).toEqual([]);
  });
});

describe("textToHtml", () => {
  it("escapes HTML and wraps blank-line blocks in <p>, newlines in <br>", () => {
    expect(textToHtml("Hi <b>you</b>\nline two\n\nnext para")).toBe(
      "<p>Hi &lt;b&gt;you&lt;/b&gt;<br>line two</p><p>next para</p>"
    );
  });

  it("returns empty string for whitespace-only input", () => {
    expect(textToHtml("  \n\n ")).toBe("");
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes the entities Gmail snippets use", () => {
    expect(decodeHtmlEntities("Tom &amp; Jerry&#39;s &lt;brief&gt;&nbsp;&#8212;ok")).toBe(
      "Tom & Jerry's <brief> —ok"
    );
  });
});

// ── MIME fixtures ────────────────────────────────────────────────────────

const HTML_BODY = "<div><p>Hello <strong>counsel</strong></p></div>";
const TEXT_BODY = "Hello counsel\n\nRegards,\nJane";

function alternativePayload(): GmailMessagePart {
  return {
    mimeType: "multipart/alternative",
    headers: [
      { name: "From", value: "Jane Smith <jane@firm.com>" },
      { name: "To", value: "you@kosloskilaw.com" },
      { name: "Subject", value: "Discovery schedule" },
    ],
    parts: [
      { mimeType: "text/plain", body: { data: b64(TEXT_BODY), size: 40 } },
      { mimeType: "text/html", body: { data: b64(HTML_BODY), size: 60 } },
    ],
  };
}

/** multipart/mixed( multipart/alternative(plain, html), pdf ) — the
 *  classic "message with attachment" shape. */
function mixedPayload(): GmailMessagePart {
  return {
    mimeType: "multipart/mixed",
    headers: [
      { name: "From", value: "Jane Smith <jane@firm.com>" },
      { name: "To", value: "you@kosloskilaw.com, Bob <bob@x.co>" },
      { name: "Cc", value: '"Smith, Ann" <ann@x.co>' },
      { name: "Subject", value: "Exhibits" },
    ],
    parts: [
      alternativePayload(),
      {
        mimeType: "application/pdf",
        filename: "exhibit-a.pdf",
        body: { attachmentId: "att-123", size: 54321 },
      },
    ],
  };
}

describe("extractBodyHtml — MIME walk", () => {
  it("prefers text/html in a multipart/alternative", () => {
    expect(extractBodyHtml(alternativePayload())).toBe(HTML_BODY);
  });

  it("digs through nested multipart/mixed to the alternative's html", () => {
    expect(extractBodyHtml(mixedPayload())).toBe(HTML_BODY);
  });

  it("falls back to escaped/paragraphed text/plain when no html part", () => {
    const payload: GmailMessagePart = {
      mimeType: "text/plain",
      body: { data: b64(TEXT_BODY) },
    };
    expect(extractBodyHtml(payload)).toBe(
      "<p>Hello counsel</p><p>Regards,<br>Jane</p>"
    );
  });

  it("never reads body data off an attachment part (filename set)", () => {
    const payload: GmailMessagePart = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "text/html",
          filename: "page.html", // attached html file, not the body
          body: { data: b64("<p>attached</p>"), attachmentId: "a1" },
        },
        { mimeType: "text/plain", body: { data: b64("real body") } },
      ],
    };
    expect(extractBodyHtml(payload)).toBe("<p>real body</p>");
  });

  it("returns empty string when nothing readable exists", () => {
    expect(extractBodyHtml({ mimeType: "multipart/mixed", parts: [] })).toBe("");
    expect(extractBodyHtml(undefined)).toBe("");
  });
});

describe("collectAttachments", () => {
  it("collects filename/mimeType/size/attachmentId from nested parts", () => {
    expect(collectAttachments(mixedPayload())).toEqual([
      {
        filename: "exhibit-a.pdf",
        mimeType: "application/pdf",
        size: 54321,
        attachmentId: "att-123",
      },
    ]);
  });

  it("returns [] when there are no attachment parts", () => {
    expect(collectAttachments(alternativePayload())).toEqual([]);
  });
});

describe("labels + flags", () => {
  it("treats only Label_* ids as user labels (system + CATEGORY_* filtered)", () => {
    expect(isUserLabelId("Label_1234")).toBe(true);
    for (const sys of [
      "INBOX",
      "UNREAD",
      "STARRED",
      "IMPORTANT",
      "SENT",
      "SPAM",
      "TRASH",
      "CATEGORY_PROMOTIONS",
      "CATEGORY_UPDATES",
    ]) {
      expect(isUserLabelId(sys)).toBe(false);
    }
  });

  it("slugs Gmail label names into the custom:* namespace", () => {
    expect(gmailLabelSlug("Clients/Smith")).toBe("custom:clients_smith");
    expect(gmailLabelSlug("  Opposing Counsel!  ")).toBe(
      "custom:opposing_counsel"
    );
    expect(gmailLabelSlug("///")).toBe("custom:label");
  });

  it("maps thread flags: isRead=no UNREAD, isStarred=any STARRED, isArchived=no INBOX", () => {
    const msg = (labels: string[]): GmailMessage => ({
      id: Math.random().toString(36),
      labelIds: labels,
    });
    expect(threadFlags([msg(["INBOX"]), msg(["INBOX", "UNREAD"])])).toEqual({
      isRead: false,
      isStarred: false,
      isArchived: false,
    });
    expect(threadFlags([msg(["STARRED"]), msg([])])).toEqual({
      isRead: true,
      isStarred: true,
      isArchived: true, // no INBOX anywhere
    });
  });
});

describe("parseGmailMessage", () => {
  it("parses headers, recipients, body and attachments from a full message", () => {
    const m: GmailMessage = {
      id: "msg-1",
      threadId: "t-1",
      labelIds: ["INBOX", "UNREAD"],
      snippet: "Exhibits attached",
      internalDate: "1767000000000",
      payload: mixedPayload(),
    };
    const parsed = parseGmailMessage(m);
    expect(parsed.externalId).toBe("msg-1");
    expect(parsed.from).toEqual({ name: "Jane Smith", email: "jane@firm.com" });
    expect(parsed.to).toEqual([
      { name: "", email: "you@kosloskilaw.com" },
      { name: "Bob", email: "bob@x.co" },
    ]);
    expect(parsed.cc).toEqual([{ name: "Smith, Ann", email: "ann@x.co" }]);
    expect(parsed.sentAt).toEqual(new Date(1767000000000));
    expect(parsed.bodyHtmlRaw).toBe(HTML_BODY);
    expect(parsed.attachments).toHaveLength(1);
  });

  it("falls back to the entity-decoded snippet when the MIME tree is unreadable", () => {
    const m: GmailMessage = {
      id: "msg-2",
      snippet: "It&#39;s scheduled &amp; confirmed",
      internalDate: "1767000000000",
      payload: { mimeType: "multipart/mixed", parts: [] },
    };
    expect(parseGmailMessage(m).bodyHtmlRaw).toBe(
      "<p>It&#39;s scheduled &amp; confirmed</p>"
    );
  });

  it("headerValue is case-insensitive", () => {
    expect(headerValue(mixedPayload(), "subject")).toBe("Exhibits");
    expect(headerValue(mixedPayload(), "X-Missing")).toBeNull();
  });
});
