/**
 * MIME builder tests — layer 1 (pure).
 *
 * The decode helpers use Buffer (tests run under Node); the module
 * under test itself is Buffer-free on purpose (client-safe).
 */

import { describe, expect, test } from "vitest";
import {
  buildMimeMessage,
  buildReplySubject,
  deriveReplyRecipients,
  encodeHeaderText,
  encodeMimeForGmail,
  formatAddress,
  formatRfc2822Date,
  isValidEmailAddress,
  parseAddressList,
  plainTextToHtml,
  type MimeMessageInput,
} from "./mime";

const BOUNDARY = "=_test_boundary";

function baseInput(over?: Partial<MimeMessageInput>): MimeMessageInput {
  return {
    from: { name: "Jason Kosloski", email: "jason@firm.com" },
    to: [{ name: "Alice Client", email: "alice@example.com" }],
    subject: "Retainer agreement",
    text: "Hi Alice,\n\nPlease review.",
    html: "<p>Hi Alice,</p><p>Please review.</p>",
    date: new Date("2026-07-06T15:30:05Z"),
    boundary: BOUNDARY,
    ...over,
  };
}

/** Header block / body split. */
function splitMessage(msg: string): { headers: string; body: string } {
  const idx = msg.indexOf("\r\n\r\n");
  return { headers: msg.slice(0, idx), body: msg.slice(idx + 4) };
}

/** Unfold folded headers (CRLF + WSP → single space) and return the
 *  value of `name`. */
function header(msg: string, name: string): string | null {
  const unfolded = splitMessage(msg).headers.replace(/\r\n[ \t]/g, " ");
  for (const line of unfolded.split("\r\n")) {
    const sep = line.indexOf(":");
    if (sep > 0 && line.slice(0, sep).toLowerCase() === name.toLowerCase()) {
      return line.slice(sep + 1).trim();
    }
  }
  return null;
}

/** Decode a base64-CTE part body back to UTF-8. */
function decodePart(partBlock: string): string {
  const b64 = partBlock.split("\r\n\r\n")[1].replace(/\r\n/g, "");
  return Buffer.from(b64, "base64").toString("utf-8");
}

function parts(msg: string): string[] {
  const { body } = splitMessage(msg);
  return body
    .split(`--${BOUNDARY}`)
    .slice(1, -1) // drop preamble slot + the "--\r\n" terminator slot
    .map((p) => p.replace(/^\r\n/, "").replace(/\r\n$/, ""));
}

// ── Address validation ───────────────────────────────────────────────────

describe("isValidEmailAddress", () => {
  test.each([
    "a@b.co",
    "first.last@sub.domain.org",
    "user+tag@example.com",
    "  padded@example.com  ", // trimmed before test
  ])("accepts %s", (email) => {
    expect(isValidEmailAddress(email)).toBe(true);
  });

  test.each([
    "",
    "plainaddress",
    "@no-local.com",
    "no-domain@",
    "no-tld@host",
    "two@@example.com",
    "spaces in@example.com",
    "angle<bracket@example.com",
    "comma,split@example.com",
  ])("rejects %s", (email) => {
    expect(isValidEmailAddress(email)).toBe(false);
  });
});

describe("parseAddressList", () => {
  test("splits on commas and semicolons, trims, keeps order", () => {
    expect(
      parseAddressList("a@x.com, b@y.com ;c@z.com").addresses
    ).toEqual(["a@x.com", "b@y.com", "c@z.com"]);
  });

  test("dedupes case-insensitively, first spelling wins", () => {
    const { addresses } = parseAddressList("A@x.com, a@X.COM, b@y.com");
    expect(addresses).toEqual(["A@x.com", "b@y.com"]);
  });

  test("collects invalid tokens without dropping valid ones", () => {
    const r = parseAddressList("good@x.com, not-an-email, also@bad");
    expect(r.addresses).toEqual(["good@x.com"]);
    expect(r.invalid).toEqual(["not-an-email", "also@bad"]);
  });

  test("empty / separator-only input yields nothing", () => {
    expect(parseAddressList(" , ; ")).toEqual({ addresses: [], invalid: [] });
  });
});

// ── Header encoding ──────────────────────────────────────────────────────

describe("encodeHeaderText (RFC 2047)", () => {
  test("ASCII passes through untouched", () => {
    expect(encodeHeaderText("Plain subject 123")).toBe("Plain subject 123");
  });

  test("strips CR/LF injection attempts", () => {
    expect(encodeHeaderText("Fake\r\nBcc: evil@x.com")).toBe(
      "Fake Bcc: evil@x.com"
    );
  });

  test("non-ASCII becomes a UTF-8 B encoded-word that decodes back", () => {
    const encoded = encodeHeaderText("Née Müller — čest");
    expect(encoded).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    const b64 = encoded.slice("=?UTF-8?B?".length, -2);
    expect(Buffer.from(b64, "base64").toString("utf-8")).toBe(
      "Née Müller — čest"
    );
  });

  test("long non-ASCII text splits into ≤75-char encoded words that reassemble", () => {
    const subject = "žluťoučký kůň úpěl ďábelské ódy ".repeat(4).trim();
    const encoded = encodeHeaderText(subject);
    const words = encoded.split("\r\n ");
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) {
      expect(w.length).toBeLessThanOrEqual(75);
      expect(w).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    }
    const decoded = words
      .map((w) =>
        Buffer.from(w.slice("=?UTF-8?B?".length, -2), "base64").toString(
          "utf-8"
        )
      )
      .join("");
    expect(decoded).toBe(subject);
  });
});

describe("formatAddress", () => {
  test("bare address without a name", () => {
    expect(formatAddress({ email: "a@b.com" })).toBe("a@b.com");
  });

  test("plain ASCII display name", () => {
    expect(formatAddress({ name: "Alice Client", email: "a@b.com" })).toBe(
      "Alice Client <a@b.com>"
    );
  });

  test("name with specials gets quoted with escapes", () => {
    expect(
      formatAddress({ name: 'Kosloski, Jason "JK"', email: "a@b.com" })
    ).toBe('"Kosloski, Jason \\"JK\\"" <a@b.com>');
  });

  test("non-ASCII name becomes an encoded word", () => {
    expect(formatAddress({ name: "Zoë", email: "a@b.com" })).toMatch(
      /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <a@b\.com>$/
    );
  });

  test("throws on an invalid address (programming-error guard)", () => {
    expect(() => formatAddress({ email: "nope" })).toThrow(/invalid email/i);
  });
});

describe("formatRfc2822Date", () => {
  test("renders UTC with +0000", () => {
    expect(formatRfc2822Date(new Date("2026-07-06T15:30:05Z"))).toBe(
      "Mon, 06 Jul 2026 15:30:05 +0000"
    );
  });
});

// ── Message assembly ─────────────────────────────────────────────────────

describe("buildMimeMessage", () => {
  test("carries From/To/Cc/Subject/Date and multipart content type", () => {
    const msg = buildMimeMessage(
      baseInput({ cc: [{ email: "cc@example.com" }] })
    );
    expect(header(msg, "From")).toBe("Jason Kosloski <jason@firm.com>");
    expect(header(msg, "To")).toBe("Alice Client <alice@example.com>");
    expect(header(msg, "Cc")).toBe("cc@example.com");
    expect(header(msg, "Subject")).toBe("Retainer agreement");
    expect(header(msg, "Date")).toBe("Mon, 06 Jul 2026 15:30:05 +0000");
    expect(header(msg, "MIME-Version")).toBe("1.0");
    expect(header(msg, "Content-Type")).toBe(
      `multipart/alternative; boundary="${BOUNDARY}"`
    );
  });

  test("omits Message-ID (Gmail assigns it) and reply headers by default", () => {
    const msg = buildMimeMessage(baseInput());
    expect(header(msg, "Message-ID")).toBeNull();
    expect(header(msg, "In-Reply-To")).toBeNull();
    expect(header(msg, "References")).toBeNull();
  });

  test("multiple recipients fold one mailbox per line and unfold to a list", () => {
    const msg = buildMimeMessage(
      baseInput({
        to: [
          { email: "a@x.com" },
          { name: "B", email: "b@y.com" },
          { email: "c@z.com" },
        ],
      })
    );
    // Raw form is folded (continuation lines start with a space)…
    expect(splitMessage(msg).headers).toContain(
      "To: a@x.com,\r\n B <b@y.com>,\r\n c@z.com"
    );
    // …and unfolds to the full list.
    expect(header(msg, "To")).toBe("a@x.com, B <b@y.com>, c@z.com");
  });

  test("multipart shape: text/plain then text/html, base64 CTE, closing terminator", () => {
    const msg = buildMimeMessage(baseInput());
    const [textPart, htmlPart] = parts(msg);
    expect(textPart).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(textPart).toContain("Content-Transfer-Encoding: base64");
    expect(htmlPart).toContain("Content-Type: text/html; charset=UTF-8");
    expect(msg).toContain(`\r\n--${BOUNDARY}--\r\n`);
  });

  test("part bodies decode to the exact composer content (UTF-8 safe)", () => {
    const text = "Dobrý den,\n\npříloha follows. — Jason";
    const html = "<p>Dobrý den,</p><p>příloha follows. — Jason</p>";
    const msg = buildMimeMessage(baseInput({ text, html }));
    const [textPart, htmlPart] = parts(msg);
    expect(decodePart(textPart)).toBe(text);
    expect(decodePart(htmlPart)).toBe(html);
  });

  test("base64 part lines are wrapped at 76 columns", () => {
    const msg = buildMimeMessage(
      baseInput({ text: "long line ".repeat(100) })
    );
    const b64Lines = parts(msg)[0].split("\r\n\r\n")[1].split("\r\n");
    expect(b64Lines.length).toBeGreaterThan(1);
    for (const line of b64Lines) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
  });

  test("reply headers: In-Reply-To/References rendered with angle brackets", () => {
    const msg = buildMimeMessage(
      baseInput({
        inReplyTo: "abc123@mail.gmail.com",
        references: ["<r1@mail.gmail.com>", "r2@mail.gmail.com"],
      })
    );
    expect(header(msg, "In-Reply-To")).toBe("<abc123@mail.gmail.com>");
    expect(header(msg, "References")).toBe(
      "<r1@mail.gmail.com> <r2@mail.gmail.com>"
    );
  });

  test("non-ASCII subject is RFC 2047 encoded in place", () => {
    const msg = buildMimeMessage(baseInput({ subject: "Smlouva — návrh" }));
    const raw = header(msg, "Subject") ?? "";
    expect(raw).toMatch(/^=\?UTF-8\?B\?/);
    const b64 = raw.slice("=?UTF-8?B?".length, -2);
    expect(Buffer.from(b64, "base64").toString("utf-8")).toBe(
      "Smlouva — návrh"
    );
  });

  test("header injection via subject cannot smuggle a header line", () => {
    const msg = buildMimeMessage(
      baseInput({ subject: "Hi\r\nBcc: evil@x.com" })
    );
    // The payload survives INSIDE the Subject value, but no header
    // line may ever START with the smuggled name.
    const lines = splitMessage(msg).headers.split("\r\n");
    expect(lines.some((l) => l.startsWith("Bcc:"))).toBe(false);
    expect(header(msg, "Subject")).toBe("Hi Bcc: evil@x.com");
  });

  test("throws without a To recipient", () => {
    expect(() => buildMimeMessage(baseInput({ to: [] }))).toThrow(
      /at least one/i
    );
  });

  test("generated boundary (no override) never collides with part content", () => {
    const { boundary: _drop, ...rest } = baseInput();
    const msg = buildMimeMessage(rest);
    const boundary = /boundary="([^"]+)"/.exec(msg)?.[1] ?? "";
    expect(boundary).toMatch(/^=_lawcrm_/);
    // Exactly 2 opening delimiters + 1 terminator.
    expect(msg.split(`--${boundary}`)).toHaveLength(4);
  });
});

describe("encodeMimeForGmail", () => {
  test("round-trips: base64url decodes to the exact message", () => {
    const msg = buildMimeMessage(
      baseInput({ text: "Dobrý den — ověření ✓", html: "<p>✓</p>" })
    );
    const raw = encodeMimeForGmail(msg);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/); // url-safe alphabet, no padding
    expect(raw).not.toContain("\n"); // JSON field — never wrapped
    expect(Buffer.from(raw, "base64url").toString("utf-8")).toBe(msg);
  });
});

// ── plain text → HTML ────────────────────────────────────────────────────

describe("plainTextToHtml", () => {
  test("blank-line paragraphs and single-newline breaks", () => {
    expect(plainTextToHtml("Hi Alice,\n\nline one\nline two")).toBe(
      "<p>Hi Alice,</p><p>line one<br />line two</p>"
    );
  });

  test("escapes HTML so content can't inject markup", () => {
    expect(plainTextToHtml('<script>alert("x")</script> & so')).toBe(
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; so</p>"
    );
  });

  test("CRLF input normalizes like LF", () => {
    expect(plainTextToHtml("a\r\n\r\nb")).toBe("<p>a</p><p>b</p>");
  });

  test("empty input yields a single empty paragraph", () => {
    expect(plainTextToHtml("")).toBe("<p></p>");
    expect(plainTextToHtml("\n\n\n")).toBe("<p></p>");
  });
});

// ── Reply derivation ─────────────────────────────────────────────────────

describe("buildReplySubject", () => {
  test("prefixes Re: once", () => {
    expect(buildReplySubject("Settlement demand")).toBe(
      "Re: Settlement demand"
    );
  });

  test("does not stack Re: (any case, repeated)", () => {
    expect(buildReplySubject("Re: Settlement demand")).toBe(
      "Re: Settlement demand"
    );
    expect(buildReplySubject("RE: re: Settlement demand")).toBe(
      "Re: Settlement demand"
    );
  });

  test("empty subject stays a bare Re:", () => {
    expect(buildReplySubject("")).toBe("Re:");
  });
});

describe("deriveReplyRecipients", () => {
  const OWN = "me@firm.com";
  const msg = (
    fromEmail: string,
    to: string[],
    cc: string[] = [],
    fromName = ""
  ) => ({
    fromName,
    fromEmail,
    toRecipients: to.map((email) => ({ email })),
    ccRecipients: cc.map((email) => ({ email })),
  });

  test("reply targets the last INBOUND sender, skipping my own later reply", () => {
    const { to, cc } = deriveReplyRecipients(
      [
        msg("alice@x.com", [OWN], [], "Alice"),
        msg(OWN, ["alice@x.com"]), // my own reply came after
      ],
      OWN,
      false
    );
    expect(to).toEqual([{ name: "Alice", email: "alice@x.com" }]);
    expect(cc).toEqual([]);
  });

  test("reply-all = From + To + Cc of the last inbound, minus my own address", () => {
    const { to, cc } = deriveReplyRecipients(
      [msg("alice@x.com", [OWN, "bob@y.com"], ["carol@z.com", OWN])],
      OWN,
      true
    );
    expect(to.map((a) => a.email)).toEqual(["alice@x.com", "bob@y.com"]);
    expect(cc.map((a) => a.email)).toEqual(["carol@z.com"]);
  });

  test("self-exclusion is case-insensitive", () => {
    const { to } = deriveReplyRecipients(
      [msg("alice@x.com", ["Me@FIRM.com", "bob@y.com"])],
      OWN,
      true
    );
    expect(to.map((a) => a.email)).toEqual(["alice@x.com", "bob@y.com"]);
  });

  test("dedupes across From/To/Cc — To wins over Cc", () => {
    const { to, cc } = deriveReplyRecipients(
      [msg("alice@x.com", ["alice@x.com", "bob@y.com"], ["BOB@y.com"])],
      OWN,
      true
    );
    expect(to.map((a) => a.email)).toEqual(["alice@x.com", "bob@y.com"]);
    expect(cc).toEqual([]);
  });

  test("all-outbound thread: reply continues to my last message's To", () => {
    const { to, cc } = deriveReplyRecipients(
      [msg(OWN, ["alice@x.com"], ["carol@z.com"])],
      OWN,
      false
    );
    expect(to.map((a) => a.email)).toEqual(["alice@x.com"]);
    expect(cc).toEqual([]); // Cc only joins on reply-all
  });

  test("all-outbound reply-all adds the Cc line", () => {
    const { to, cc } = deriveReplyRecipients(
      [msg(OWN, ["alice@x.com"], ["carol@z.com"])],
      OWN,
      true
    );
    expect(to.map((a) => a.email)).toEqual(["alice@x.com"]);
    expect(cc.map((a) => a.email)).toEqual(["carol@z.com"]);
  });

  test("no messages → empty (caller surfaces edit-recipients)", () => {
    expect(deriveReplyRecipients([], OWN, true)).toEqual({ to: [], cc: [] });
  });
});
