import { afterEach, describe, expect, it, vi } from "vitest";
import { consoleDriver, resendDriver } from "./drivers";

const base = { to: "c@x.com", subject: "S", text: "t", html: "<p>t</p>" };

function stubFetch(json: unknown = { id: "re_123" }) {
  const fn = vi.fn(async () => new Response(JSON.stringify(json), { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
function bodyOf(fn: ReturnType<typeof stubFetch>) {
  const init = (fn.mock.calls[0] as unknown as [string, RequestInit])[1];
  return JSON.parse(init.body as string);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("resendDriver", () => {
  it("resend driver sends reply_to, base64 attachments and display-name from", async () => {
    vi.stubEnv("EMAIL_FROM", "Litgox <noreply@litgox.com>");
    const fn = stubFetch();
    const r = await resendDriver("k")({
      ...base,
      replyTo: "a@firm.com",
      fromName: "Kosloski Law",
      attachments: [{ filename: "Invoice 1.pdf", content: Buffer.from("%PDF") }],
    });
    const body = bodyOf(fn);
    expect(body.reply_to).toBe("a@firm.com");
    expect(body.attachments).toEqual([
      { filename: "Invoice 1.pdf", content: Buffer.from("%PDF").toString("base64") },
    ]);
    expect(body.from).toBe('"Kosloski Law" <noreply@litgox.com>');
    expect(r).toEqual({ ok: true, id: "re_123" });
  });

  it("resend driver payload is unchanged when new fields are absent", async () => {
    vi.stubEnv("EMAIL_FROM", "Litgox <noreply@litgox.com>");
    const fn = stubFetch();
    await resendDriver("k")(base);
    const body = bodyOf(fn);
    expect(Object.keys(body).sort()).toEqual(["from", "html", "subject", "text", "to"]);
    expect(body.from).toBe("Litgox <noreply@litgox.com>");
  });

  it("fromName with quotes is escaped", async () => {
    vi.stubEnv("EMAIL_FROM", "Litgox <noreply@litgox.com>");
    const fn = stubFetch();
    await resendDriver("k")({ ...base, fromName: 'A "B" C' });
    expect(bodyOf(fn).from).toBe('"A \\"B\\" C" <noreply@litgox.com>');
  });
});

describe("resendDriver From header", () => {
  it("strips CR/LF from fromName", async () => {
    vi.stubEnv("EMAIL_FROM", "Litgox <noreply@litgox.com>");
    const fn = stubFetch();
    await resendDriver("k")({ ...base, fromName: "Evil\r\nBcc: x@y.com" });
    expect(bodyOf(fn).from).toBe('"Evil Bcc: x@y.com" <noreply@litgox.com>');
  });

  it("bare-address EMAIL_FROM plus fromName", async () => {
    vi.stubEnv("EMAIL_FROM", "noreply@litgox.com");
    const fn = stubFetch();
    await resendDriver("k")({ ...base, fromName: "Kosloski Law" });
    expect(bodyOf(fn).from).toBe('"Kosloski Law" <noreply@litgox.com>');
  });
});

describe("consoleDriver", () => {
  it("console driver logs attachment names and sizes, not bytes", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const r = await consoleDriver({
      ...base,
      attachments: [{ filename: "a.pdf", content: Buffer.from("SECRETBYTES") }],
    });
    const out = info.mock.calls.flat().join(" ");
    expect(out).toContain("a.pdf");
    expect(out).toContain("11");
    expect(out).not.toContain("SECRETBYTES");
    expect(r.ok).toBe(true);
  });
});
