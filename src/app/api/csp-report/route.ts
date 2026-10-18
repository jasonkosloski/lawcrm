/**
 * CSP violation report sink (report-only rollout, ADR-022).
 *
 * Public by necessity: browsers post reports without a dependable
 * session cookie, including from /login. It never writes to the
 * database; it logs one `[csp-report]` line per violation so a log
 * drain or a Vercel log search can review them before the policy is
 * enforced. Bodies over MAX_BODY bytes are dropped, and only the
 * fields needed to triage are logged (no full report echo).
 */

const MAX_BODY = 8 * 1024;

type Violation = {
  directive: string;
  blocked: string;
  page: string;
};

/** Accepts both the legacy `report-uri` shape ({"csp-report": {...}})
 *  and the Reporting API shape ([{type, body}]). Unknown input → []. */
export function parseCspReport(raw: unknown): Violation[] {
  const pick = (r: Record<string, unknown>): Violation => ({
    directive: String(
      r["effective-directive"] ?? r["violated-directive"] ?? r.effectiveDirective ?? ""
    ).slice(0, 100),
    blocked: String(r["blocked-uri"] ?? r.blockedURL ?? "").slice(0, 300),
    // Path only: query strings can carry search terms.
    page: String(r["document-uri"] ?? r.documentURL ?? "")
      .split("?")[0]
      .slice(0, 300),
  });
  if (raw && typeof raw === "object" && "csp-report" in raw) {
    const r = (raw as Record<string, unknown>)["csp-report"];
    return r && typeof r === "object" ? [pick(r as Record<string, unknown>)] : [];
  }
  if (Array.isArray(raw)) {
    return raw.flatMap((e) =>
      e && typeof e === "object" && e.type === "csp-violation" && e.body && typeof e.body === "object"
        ? [pick(e.body as Record<string, unknown>)]
        : []
    );
  }
  return [];
}

export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY) return new Response(null, { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BODY) return new Response(null, { status: 413 });

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  for (const v of parseCspReport(parsed).slice(0, 10)) {
    console.warn("[csp-report]", JSON.stringify(v));
  }
  return new Response(null, { status: 204 });
}
