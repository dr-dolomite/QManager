"use client";

import { useCallback, useRef, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type { DiagnosticsCaptureResponse } from "@/types/diagnostics";

// =============================================================================
// useDiagnostics: capture a plain-text debug report and download it.
// =============================================================================
// Backend: POST /cgi-bin/quecmanager/system/diagnostics.sh  body {"action":"capture"}
//   → { success: true, filename, content }
// On success we materialize `content` into a text/plain Blob and trigger a
// browser download via the createObjectURL → <a download> → revoke pattern
// (mirrors use-config-backup). No mount fetch; this is action-only.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/system/diagnostics.sh";

export type DiagnosticsStage = "idle" | "capturing" | "done" | "error";

export interface UseDiagnosticsReturn {
  stage: DiagnosticsStage;
  error: string | null;
  capture: () => Promise<boolean>;
  reset: () => void;
}

export function useDiagnostics(): UseDiagnosticsReturn {
  const { t } = useTranslation("errors");
  const [stage, setStage] = useState<DiagnosticsStage>("idle");
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reset = useCallback(() => {
    setStage("idle");
    setError(null);
  }, []);

  const capture = useCallback(async (): Promise<boolean> => {
    setError(null);
    setStage("capturing");

    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "capture" }),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const json: DiagnosticsCaptureResponse = await resp.json();
      if (!mountedRef.current) return false;

      if (!json.success) {
        setError(
          resolveErrorMessage(
            t,
            json.error,
            json.detail,
            "Failed to capture diagnostics",
          ),
        );
        setStage("error");
        return false;
      }

      // Materialize the plain-text report into a download.
      const blob = new Blob([json.content], { type: "text/plain" });
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = json.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);

      setStage("done");
      return true;
    } catch (err) {
      if (!mountedRef.current) return false;
      setError(
        err instanceof Error ? err.message : "Failed to capture diagnostics",
      );
      setStage("error");
      return false;
    }
  }, [t]);

  return { stage, error, capture, reset };
}
