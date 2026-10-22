/**
 * Global Error Boundary
 *
 * Last-resort catch for errors thrown inside the root layout itself
 * (`src/app/error.tsx` handles everything below it, and
 * `(dashboard)/error.tsx` handles pages). Must render its own <html>
 * + <body> because the root layout has crashed. "Try again" calls
 * Next 16's `retry()` (re-fetch + re-render); `reset()` would re-render
 * the same cached payload and re-throw.
 */

"use client";

import { useEffect } from "react";
import { errorDetails } from "@/lib/error-details";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error("Root error boundary caught:", error);
  }, [error]);

  const { message, digest } = errorDetails(error);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          padding: "3rem 1.5rem",
          maxWidth: 640,
          margin: "0 auto",
          color: "#0f1b2e",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>Application error</h1>
        <p style={{ fontSize: 14, color: "#475569", marginBottom: 16 }}>
          The app failed to start. Try reloading; if the problem persists, this is the message to
          share with support:
        </p>
        {(message || digest) && (
          <pre
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 12,
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              padding: "10px 12px",
              overflowX: "auto",
              marginBottom: 16,
            }}
          >
            {message}
            {digest ? `${message ? "\n\n" : ""}digest: ${digest}` : ""}
          </pre>
        )}
        <button
          type="button"
          onClick={() => retry()}
          style={{
            background: "#2563a8",
            color: "white",
            border: "none",
            borderRadius: 6,
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
