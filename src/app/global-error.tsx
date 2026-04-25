/**
 * Global Error Boundary
 *
 * Last-resort catch for errors thrown inside the root layout itself
 * (the dashboard error boundary handles errors inside the app shell).
 * Must render its own <html> + <body> because the root layout has
 * crashed.
 */

"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Root error boundary caught:", error);
  }, [error]);

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
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
          Application error
        </h1>
        <p style={{ fontSize: 14, color: "#475569", marginBottom: 16 }}>
          The app failed to start. Try reloading; if the problem persists,
          this is the message to share with support:
        </p>
        {error.message && (
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
            {error.message}
            {error.digest ? `\n\ndigest: ${error.digest}` : ""}
          </pre>
        )}
        <button
          type="button"
          onClick={reset}
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
