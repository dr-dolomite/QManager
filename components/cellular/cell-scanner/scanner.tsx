"use client";

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { formatCellBandwidth, NR_BANDS, suggestNRSCS } from "@/lib/earfcn";

import { Card, CardContent } from "@/components/ui/card";
import ScannerEmptyView from "./empty-view";
import ScanResultView from "./scan-result";
import type { CellScanResult } from "./scan-result";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  DownloadIcon,
  LoaderCircleIcon,
  RefreshCcwIcon,
} from "lucide-react";
import { useCellScanner } from "@/hooks/use-cell-scanner";
import { toast } from "sonner";
import { downloadCSV } from "@/lib/download-csv";
import { ScanningView } from "./scanning-view";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// --- CSV row builder for cell scan results -----------------------------------
function buildCsvRows(results: CellScanResult[]): string[] {
  return results.map((r) =>
    [
      r.networkType,
      `"${(r.provider || "").replace(/"/g, '""')}"`,
      r.mcc,
      r.mnc,
      r.band,
      r.earfcn,
      r.pci,
      r.cellID,
      r.tac,
      `"${formatCellBandwidth(r.networkType, r.bandwidth, r.scs)}"`,
      r.signalStrength,
    ].join(","),
  );
}

const CELL_SCAN_CSV_HEADER =
  "Network,Provider,MCC,MNC,Band,EARFCN,PCI,Cell ID,TAC,Bandwidth,Signal (dBm)";

const FullScannerComponent = () => {
  const { t } = useTranslation("cellular");
  const { status, results, error, elapsedSeconds, startScan } = useCellScanner();
  const [lockTarget, setLockTarget] = useState<CellScanResult | null>(null);
  const [isLocking, setIsLocking] = useState(false);

  const hasScanResults = status === "complete" && results.length > 0;
  const isScanning = status === "running";

  // --- Lock Cell Handler ---------------------------------------------------
  // Routes through the existing tower/lock.sh for full UCI config + failover
  const handleLockCell = useCallback((cell: CellScanResult) => {
    setLockTarget(cell);
  }, []);

  const confirmLockCell = useCallback(async () => {
    if (!lockTarget) return;
    setIsLocking(true);

    try {
      // Build payload matching existing tower/lock.sh format
      let body: Record<string, unknown>;

      if (lockTarget.networkType === "NR5G") {
        // AT+QNWLOCK requires a concrete SCS, so we can't defer here the way the
        // BW display can. Prefer the SCS the modem actually reported for this
        // cell; when it's missing, infer from the band's duplex mode (FDD→15,
        // TDD→30, FR2→60) rather than blindly assuming 30 kHz — a wrong SCS gets
        // baked into the radio lock (e.g. FDD n71/n25 are 15 kHz, not 30).
        const nrBand = NR_BANDS.find((b) => b.band === lockTarget.band);
        const scs =
          lockTarget.scs ?? (nrBand ? suggestNRSCS(nrBand) : 30);
        body = {
          type: "nr_sa",
          action: "lock",
          pci: lockTarget.pci,
          arfcn: lockTarget.earfcn,
          scs,
          band: lockTarget.band,
        };
      } else {
        // LTE (default)
        body = {
          type: "lte",
          action: "lock",
          cells: [{ earfcn: lockTarget.earfcn, pci: lockTarget.pci }],
        };
      }

      const res = await authFetch("/cgi-bin/quecmanager/tower/lock.sh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.success) {
        toast.success(t("cell_scanner.toast.lock_success_title"), {
          description: t("cell_scanner.toast.lock_success_description", {
            network_type: lockTarget.networkType,
            pci: lockTarget.pci,
            earfcn: lockTarget.earfcn,
          }),
        });
      } else {
        toast.error(t("cell_scanner.toast.lock_error_title"), {
          description: resolveErrorMessage(t, data.error, data.detail, t("cell_scanner.toast.lock_error_unknown")),
        });
      }
    } catch {
      toast.error(t("cell_scanner.toast.lock_error_title"), {
        description: t("cell_scanner.toast.lock_error_connection"),
      });
    } finally {
      setIsLocking(false);
      setLockTarget(null);
    }
  }, [lockTarget, t]);

  return (
    <>
      <Card className="@container/card">
        <CardContent className="pt-6">
          <div className="grid gap-4">
            {hasScanResults ? (
              <ScanResultView data={results} onLockCell={handleLockCell} />
            ) : isScanning ? (
              <ScanningView elapsedSeconds={elapsedSeconds} />
            ) : status === "error" ? (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
                <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
                  <AlertCircle className="size-5 text-destructive" />
                </div>
                <div className="max-w-xs space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {error || t("cell_scanner.scanner.error_fallback")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("cell_scanner.scanner.error_description")}
                  </p>
                </div>
                <Button onClick={startScan} variant="outline" size="sm">
                  <RefreshCcwIcon className="size-4" />
                  {t("cell_scanner.scanner.retry_scan")}
                </Button>
              </div>
            ) : (
              <ScannerEmptyView onStartScan={startScan} />
            )}
          </div>
          {(hasScanResults || isScanning) && (
            <div className="mt-4 flex items-center gap-x-2">
              <Button onClick={startScan} disabled={isScanning}>
                {isScanning ? t("cell_scanner.scanner.scanning") : t("cell_scanner.scanner.start_new_scan")}
              </Button>
              {hasScanResults && (
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadCSV(
                      CELL_SCAN_CSV_HEADER,
                      buildCsvRows(results),
                      `cell_scan_${new Date().toISOString().slice(0, 10)}.csv`,
                    )
                  }
                  aria-label={t("cell_scanner.scanner.download_csv_aria")}
                >
                  <DownloadIcon />
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lock confirmation dialog */}
      <AlertDialog
        open={!!lockTarget}
        onOpenChange={(open) => !open && !isLocking && setLockTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cell_scanner.lock_dialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("cell_scanner.lock_dialog.description")}
            </AlertDialogDescription>
            {lockTarget && (
              <p className="font-mono text-xs text-muted-foreground">
                {lockTarget.networkType} — PCI {lockTarget.pci}, EARFCN{" "}
                {lockTarget.earfcn}, Band {lockTarget.band}
                {lockTarget.provider && ` (${lockTarget.provider})`}
              </p>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLocking}>
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmLockCell(); }} disabled={isLocking}>
              {isLocking ? (
                <>
                  <LoaderCircleIcon className="size-4 animate-spin" />
                  {t("cell_scanner.lock_dialog.locking")}
                </>
              ) : (
                t("cell_scanner.lock_dialog.confirm")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default FullScannerComponent;
