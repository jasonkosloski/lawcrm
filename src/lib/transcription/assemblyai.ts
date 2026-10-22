import "server-only";

import type { AssemblyAITranscript } from "./types";

/**
 * The only module that talks to AssemblyAI (REST v2, plain fetch).
 * Job lifecycle lives in the transcript actions; this is transport only.
 */

const BASE_URL = "https://api.assemblyai.com";

export const WEBHOOK_SECRET_HEADER = "x-transcript-secret";

export function transcriptionConfigured(): boolean {
  return !!process.env.ASSEMBLYAI_API_KEY;
}

function apiKey(): string {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw new Error("ASSEMBLYAI_API_KEY is not configured");
  return key;
}

async function providerError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === "string" && body.error) return body.error;
  } catch {
    // fall through
  }
  return `HTTP ${res.status}`;
}

async function failIfNotOk(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  throw new Error(`AssemblyAI ${what} failed: ${await providerError(res)}`);
}

export async function submitJob(input: {
  audioUrl: string;
  webhookUrl: string | null;
  webhookSecret: string;
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = {
    audio_url: input.audioUrl,
    speaker_labels: true,
    punctuate: true,
    format_text: true,
  };
  if (input.webhookUrl) {
    body.webhook_url = input.webhookUrl;
    body.webhook_auth_header_name = WEBHOOK_SECRET_HEADER;
    body.webhook_auth_header_value = input.webhookSecret;
  }
  const res = await fetch(`${BASE_URL}/v2/transcript`, {
    method: "POST",
    headers: { authorization: apiKey(), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await failIfNotOk(res, "submit");
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error("AssemblyAI submit returned no job id");
  return { jobId: json.id };
}

export async function fetchJob(jobId: string): Promise<{
  status: "queued" | "processing" | "completed" | "error";
  error?: string;
  raw?: AssemblyAITranscript;
}> {
  const res = await fetch(
    `${BASE_URL}/v2/transcript/${encodeURIComponent(jobId)}`,
    { headers: { authorization: apiKey() } },
  );
  await failIfNotOk(res, "fetch");
  const json = (await res.json()) as AssemblyAITranscript & { error?: string };
  if (json.status === "error") {
    return { status: "error", error: json.error ?? "Transcription failed" };
  }
  if (json.status === "completed") return { status: "completed", raw: json };
  return { status: json.status === "queued" ? "queued" : "processing" };
}

/** Best-effort removal of the provider-side copy; failures are logged only. */
export async function deleteJob(jobId: string): Promise<void> {
  try {
    const res = await fetch(
      `${BASE_URL}/v2/transcript/${encodeURIComponent(jobId)}`,
      { method: "DELETE", headers: { authorization: apiKey() } },
    );
    if (!res.ok) {
      console.warn(
        `[assemblyai] deleteJob ${jobId} failed: ${await providerError(res)}`,
      );
    }
  } catch (err) {
    console.warn(`[assemblyai] deleteJob ${jobId} failed`, err);
  }
}

/** Upload raw bytes to AssemblyAI, returning a provider URL (local-driver dev only). */
export async function uploadBytes(bytes: Uint8Array): Promise<string> {
  const res = await fetch(`${BASE_URL}/v2/upload`, {
    method: "POST",
    headers: {
      authorization: apiKey(),
      "content-type": "application/octet-stream",
    },
    body: bytes as unknown as BodyInit,
  });
  await failIfNotOk(res, "upload");
  const json = (await res.json()) as { upload_url?: string };
  if (!json.upload_url) throw new Error("AssemblyAI upload returned no URL");
  return json.upload_url;
}
