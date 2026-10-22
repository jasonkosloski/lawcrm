// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST, parseCspReport } from "./route";

const post = (body: string) =>
  POST(new Request("https://app.example/api/csp-report", { method: "POST", body }));

afterEach(() => vi.restoreAllMocks());

describe("parseCspReport", () => {
  it("reads the legacy report-uri shape and strips the query string", () => {
    expect(
      parseCspReport({
        "csp-report": {
          "document-uri": "https://app.example/search?q=client+name",
          "violated-directive": "script-src-elem",
          "blocked-uri": "https://evil.example/x.js",
        },
      }),
    ).toEqual([
      {
        directive: "script-src-elem",
        blocked: "https://evil.example/x.js",
        page: "https://app.example/search",
      },
    ]);
  });

  it("reads Reporting API batches and ignores other report types", () => {
    const out = parseCspReport([
      {
        type: "csp-violation",
        body: { effectiveDirective: "img-src", blockedURL: "x", documentURL: "y" },
      },
      { type: "deprecation", body: {} },
    ]);
    expect(out).toEqual([{ directive: "img-src", blocked: "x", page: "y" }]);
  });

  it("returns nothing for junk", () => {
    expect(parseCspReport(null)).toEqual([]);
    expect(parseCspReport({ hello: 1 })).toEqual([]);
  });
});

describe("POST /api/csp-report", () => {
  it("logs one line per violation and answers 204", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await post(
      JSON.stringify({ "csp-report": { "violated-directive": "img-src", "blocked-uri": "data" } }),
    );
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledWith("[csp-report]", expect.stringContaining("img-src"));
  });

  it("rejects oversized and malformed bodies without logging", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await post("x".repeat(9000))).status).toBe(413);
    expect((await post("{not json")).status).toBe(400);
    expect(warn).not.toHaveBeenCalled();
  });
});
