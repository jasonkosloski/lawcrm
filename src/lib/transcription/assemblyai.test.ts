import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WEBHOOK_SECRET_HEADER,
  deleteJob,
  fetchJob,
  submitJob,
  transcriptionConfigured,
  uploadBytes,
} from "./assemblyai";

const fetchMock = vi.fn();

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  process.env.ASSEMBLYAI_API_KEY = "key-123";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.ASSEMBLYAI_API_KEY;
});

describe("transcriptionConfigured", () => {
  it("reflects the API key", () => {
    expect(transcriptionConfigured()).toBe(true);
    delete process.env.ASSEMBLYAI_API_KEY;
    expect(transcriptionConfigured()).toBe(false);
  });
});

describe("submitJob", () => {
  it("sends the exact body and headers and returns the id", async () => {
    fetchMock.mockResolvedValue(res(200, { id: "job-1" }));
    const out = await submitJob({
      audioUrl: "https://x/a.mp3",
      webhookUrl: "https://app/hook",
      webhookSecret: "s3",
    });
    expect(out).toEqual({ jobId: "job-1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.assemblyai.com/v2/transcript");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("key-123");
    expect(JSON.parse(init.body)).toEqual({
      audio_url: "https://x/a.mp3",
      speaker_labels: true,
      language_detection: true,
      punctuate: true,
      format_text: true,
      webhook_url: "https://app/hook",
      webhook_auth_header_name: WEBHOOK_SECRET_HEADER,
      webhook_auth_header_value: "s3",
    });
  });

  it("omits webhook fields when webhookUrl is null", async () => {
    fetchMock.mockResolvedValue(res(200, { id: "job-2" }));
    await submitJob({ audioUrl: "u", webhookUrl: null, webhookSecret: "s" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      audio_url: "u",
      speaker_labels: true,
      language_detection: true,
      punctuate: true,
      format_text: true,
    });
  });

  it("throws including the provider error on non-2xx", async () => {
    fetchMock.mockResolvedValue(res(400, { error: "audio_url is bad" }));
    await expect(
      submitJob({ audioUrl: "u", webhookUrl: null, webhookSecret: "s" }),
    ).rejects.toThrow(/audio_url is bad/);
  });
});

describe("fetchJob", () => {
  it("maps provider errors", async () => {
    fetchMock.mockResolvedValue(
      res(200, { id: "j", status: "error", error: "no audio" }),
    );
    expect(await fetchJob("j")).toEqual({ status: "error", error: "no audio" });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.assemblyai.com/v2/transcript/j",
    );
  });

  it("returns raw for completed", async () => {
    const raw = { id: "j", status: "completed", words: [] };
    fetchMock.mockResolvedValue(res(200, raw));
    expect(await fetchJob("j")).toEqual({ status: "completed", raw });
  });

  it("maps queued and processing", async () => {
    fetchMock.mockResolvedValue(res(200, { status: "queued" }));
    expect((await fetchJob("j")).status).toBe("queued");
    fetchMock.mockResolvedValue(res(200, { status: "processing" }));
    expect((await fetchJob("j")).status).toBe("processing");
  });

  it("throws on non-2xx", async () => {
    fetchMock.mockResolvedValue(res(404, { error: "not found" }));
    await expect(fetchJob("j")).rejects.toThrow(/not found/);
  });
});

describe("deleteJob", () => {
  it("returns true on 2xx and on 404", async () => {
    fetchMock.mockResolvedValue(res(200, {}));
    await expect(deleteJob("j")).resolves.toBe(true);
    fetchMock.mockResolvedValue(res(404, { error: "gone" }));
    await expect(deleteJob("j")).resolves.toBe(true);
  });

  it("resolves and warns on 500", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue(res(500, { error: "boom" }));
    await expect(deleteJob("j")).resolves.toBe(false);
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    expect(warn).toHaveBeenCalled();
  });

  it("resolves when fetch rejects", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error("net"));
    await expect(deleteJob("j")).resolves.toBe(false);
  });
});

describe("uploadBytes", () => {
  it("posts raw bytes and returns upload_url", async () => {
    fetchMock.mockResolvedValue(res(200, { upload_url: "https://cdn/u1" }));
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await uploadBytes(bytes)).toBe("https://cdn/u1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.assemblyai.com/v2/upload");
    expect(init.headers["content-type"]).toBe("application/octet-stream");
    expect(init.body).toBe(bytes);
  });
});

describe("request timeouts", () => {
  it("passes an abort signal on submit, fetch and delete", async () => {
    fetchMock.mockResolvedValue(res(200, { id: "j", status: "queued" }));
    await submitJob({ audioUrl: "u", webhookUrl: null, webhookSecret: "s" });
    await fetchJob("j");
    await deleteJob("j");
    expect(fetchMock.mock.calls).toHaveLength(3);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });
});
