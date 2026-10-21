import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "./send";
import { captureEmails } from "@/test/email-capture";

const msg = {
  to: "a@example.com",
  subject: "Hello subject",
  text: "plain",
  html: "<p>html</p>",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendEmail", () => {
  it("console driver is used when RESEND_API_KEY is unset and logs the message", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await sendEmail(msg);
    expect(res).toEqual({ ok: true });
    expect(JSON.stringify(info.mock.calls)).toContain("Hello subject");
  });

  it("resend driver POSTs to https://api.resend.com/emails with bearer key and EMAIL_FROM", async () => {
    vi.stubEnv("RESEND_API_KEY", "k");
    vi.stubEnv("EMAIL_FROM", "Firm <noreply@firm.test>");
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ id: "x" }) });
    vi.stubGlobal("fetch", fetchMock);
    const res = await sendEmail(msg);
    expect(res).toMatchObject({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer k");
    const body = JSON.parse(init.body);
    expect(body.from).toBe("Firm <noreply@firm.test>");
    expect(body.to).toBe("a@example.com");
    expect(body.subject).toBe("Hello subject");
  });

  it("resend non-2xx returns ok:false without throwing", async () => {
    vi.stubEnv("RESEND_API_KEY", "k");
    vi.stubEnv("EMAIL_FROM", "a@b.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: async () => "bad",
        json: async () => ({}),
      }),
    );
    const res = await sendEmail(msg);
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).toContain("422");
  });

  it("production without RESEND_API_KEY refuses and logs nothing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", " ");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await sendEmail(msg);
    expect(res).toEqual({ ok: false, error: "Email is not configured." });
    expect(info).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("missing EMAIL_FROM returns ok:false without calling fetch", async () => {
    vi.stubEnv("RESEND_API_KEY", "k");
    vi.stubEnv("EMAIL_FROM", " ");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await sendEmail(msg);
    expect(res).toEqual({ ok: false, error: "EMAIL_FROM is not set." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejected fetch returns ok:false instead of throwing", async () => {
    vi.stubEnv("RESEND_API_KEY", "k");
    vi.stubEnv("EMAIL_FROM", "a@b.test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    const res = await sendEmail(msg);
    expect(res).toEqual({ ok: false, error: "boom" });
  });

  it("captureEmails records messages instead of sending", async () => {
    vi.stubEnv("RESEND_API_KEY", "k");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const cap = captureEmails();
    try {
      expect(await sendEmail(msg)).toMatchObject({ ok: true });
      expect(cap.sent).toEqual([msg]);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      cap.restore();
    }
  });
});
