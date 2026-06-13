// types/diagnostics.ts
//
// Response shapes for the diagnostics capture endpoint.
// Backend: POST /cgi-bin/quecmanager/system/diagnostics.sh  body {"action":"capture"}
//   success → { success: true, filename, content }
//   error   → { success: false, error: CODE, detail: MSG }

export interface DiagnosticsCaptureSuccess {
  success: true;
  filename: string;
  content: string;
}

export interface DiagnosticsCaptureError {
  success: false;
  error: string;
  detail?: string;
}

export type DiagnosticsCaptureResponse =
  | DiagnosticsCaptureSuccess
  | DiagnosticsCaptureError;
