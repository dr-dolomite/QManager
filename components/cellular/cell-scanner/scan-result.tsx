"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { motion } from "motion/react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  type Row,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  ChevronDown,
  Info,
  LockIcon,
  MoreVertical,
} from "lucide-react";

import { formatCellBandwidth } from "@/lib/earfcn";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const MotionTableRow = motion.create(TableRow);
import { SignalBadge, NetworkTypeBadge } from "./signal-badges";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * RAT token as emitted by the scanner daemon. Sourced verbatim from field 1 of
 * the `+QSCAN:` line; `qmanager_cell_scanner` skips any other type, so these
 * two values are exhaustive. Keep this a union, not `string` — it is what makes
 * a mistyped comparison (e.g. "NR5G-SA") a compile error instead of a silent
 * fall-through.
 */
export type CellNetworkType = "LTE" | "NR5G";

export interface CellScanResult {
  id: string;
  networkType: CellNetworkType;
  earfcn: number;
  pci: number;
  band: number;
  bandwidth: number;
  cellID: number;
  tac: number;
  signalStrength: number;
  mcc: number;
  mnc: number;
  provider: string;
  scs?: number | null;
}

interface ScanResultViewProps {
  data: CellScanResult[];
  onLockCell?: (cell: CellScanResult) => void;
}


const createColumns = (
  t: TFunction,
  onLockCell?: (cell: CellScanResult) => void,
): ColumnDef<CellScanResult>[] => [
  {
    accessorKey: "networkType",
    header: () => <div>{t("cell_scanner.result_table.column_headers.network")}</div>,
    cell: ({ row }) => (
      <div><NetworkTypeBadge type={row.getValue("networkType")} /></div>
    ),
  },
  {
    accessorKey: "provider",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        {t("cell_scanner.result_table.column_headers.provider")}
        <ArrowUpDown className="size-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const cell = row.original;
      return (
        <div className="flex items-center gap-1">
          <span className="font-semibold">{cell.provider}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="inline-flex p-2 -m-2" aria-label={t("cell_scanner.result_table.mcc_mnc_aria")}>
                <Info className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {cell.mcc} {cell.mnc}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      );
    },
  },
  {
    accessorKey: "band",
    header: t("cell_scanner.result_table.column_headers.band"),
    cell: ({ row }) => {
      const networkType = row.original.networkType;
      const band = row.getValue("band") as number;
      // 3GPP labels NR bands N<n> and everything else (LTE) B<n>.
      const prefix = networkType === "NR5G" ? "N" : "B";
      return (
        <div className="font-semibold">
          {prefix}
          {band}
        </div>
      );
    },
  },
  {
    accessorKey: "earfcn",
    header: t("cell_scanner.result_table.column_headers.earfcn"),
    cell: ({ row }) => (
      <div className="font-semibold">{row.getValue("earfcn")}</div>
    ),
  },
  {
    accessorKey: "pci",
    header: t("cell_scanner.result_table.column_headers.pci"),
    cell: ({ row }) => (
      <div className="font-semibold">{row.getValue("pci")}</div>
    ),
  },
  {
    accessorKey: "cellID",
    header: t("cell_scanner.result_table.column_headers.cell_id"),
    cell: ({ row }) => (
      <div className="font-medium">{row.getValue("cellID")}</div>
    ),
  },
  {
    accessorKey: "tac",
    header: t("cell_scanner.result_table.column_headers.tac"),
    cell: ({ row }) => <div className="font-medium">{row.getValue("tac")}</div>,
  },
  {
    accessorKey: "bandwidth",
    header: t("cell_scanner.result_table.column_headers.bandwidth"),
    cell: ({ row }) => (
      <div className="font-medium">
        {formatCellBandwidth(
          row.original.networkType,
          row.original.bandwidth,
          row.original.scs,
        )}
      </div>
    ),
  },
  {
    accessorKey: "signalStrength",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        {t("cell_scanner.result_table.column_headers.signal")}
        <ArrowUpDown className="size-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const strength = row.getValue("signalStrength") as number;
      return (
        <div className="flex items-center gap-2">
          <SignalBadge strength={strength} />
          <span className="font-semibold">{strength} dBm</span>
        </div>
      );
    },
  },
  {
    id: "actions",
    header: () => null,
    enableHiding: false,
    cell: ({ row }: { row: Row<CellScanResult> }) => {
      const cellData = row.original;
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="data-[state=open]:bg-muted text-muted-foreground flex size-8"
              size="icon"
            >
              <MoreVertical className="size-4" />
              <span className="sr-only">{t("cell_scanner.result_table.open_menu")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => onLockCell?.(cellData)}>
              <LockIcon className="size-4" />
              {t("cell_scanner.result_table.lock_cell")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];

// Columns hidden on narrow containers (<640px) — users can toggle them back
const NARROW_HIDDEN: VisibilityState = {
  cellID: false,
  tac: false,
  bandwidth: false,
  earfcn: false,
};
const NARROW_BREAKPOINT = 640;

const ScanResultView = ({ data, onLockCell }: ScanResultViewProps) => {
  const { t } = useTranslation("cellular");
  const containerRef = React.useRef<HTMLDivElement>(null);
  // Only animate rows on initial mount — skip on sort/filter/page changes
  const hasAnimated = React.useRef(false);
  React.useEffect(() => { hasAnimated.current = true; }, []);
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const columns = React.useMemo(() => createColumns(t, onLockCell), [t, onLockCell]);

  const columnLabels = React.useMemo<Record<string, string>>(() => ({
    networkType: t("cell_scanner.result_table.column_headers.network"),
    provider: t("cell_scanner.result_table.column_headers.provider"),
    band: t("cell_scanner.result_table.column_headers.band"),
    earfcn: t("cell_scanner.result_table.column_headers.earfcn"),
    pci: t("cell_scanner.result_table.column_headers.pci"),
    cellID: t("cell_scanner.result_table.column_headers.cell_id"),
    tac: t("cell_scanner.result_table.column_headers.tac"),
    bandwidth: t("cell_scanner.result_table.column_headers.bandwidth_full"),
    signalStrength: t("cell_scanner.result_table.column_headers.signal"),
  }), [t]);

  // Auto-hide secondary columns on narrow containers
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(([entry]) => {
      const wide = entry.contentRect.width >= NARROW_BREAKPOINT;
      setColumnVisibility((prev) => {
        // Only auto-set if user hasn't manually toggled (all keys default)
        const isDefault = Object.keys(prev).length === 0 ||
          Object.keys(prev).every((k) => k in NARROW_HIDDEN);
        if (!isDefault) return prev;
        return wide ? {} : NARROW_HIDDEN;
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
    },
  });

  return (
    <div ref={containerRef} className="relative flex flex-col gap-4 overflow-hidden">
      <div className="flex flex-col @sm/card:flex-row items-start @sm/card:items-center gap-2">
        <Input
          placeholder={t("cell_scanner.result_table.filter_placeholder")}
          value={
            (table.getColumn("provider")?.getFilterValue() as string) ?? ""
          }
          onChange={(event) =>
            table.getColumn("provider")?.setFilterValue(event.target.value)
          }
          className="w-full @sm/card:max-w-sm"
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="@sm/card:ml-auto">
              {t("cell_scanner.result_table.columns_button")} <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => {
                return (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) =>
                      column.toggleVisibility(!!value)
                    }
                  >
                    {columnLabels[column.id] ?? column.id}
                  </DropdownMenuCheckboxItem>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table className="min-w-[480px]">
          <TableHeader className="bg-muted sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row, index) => (
                <MotionTableRow
                  key={row.id}
                  initial={hasAnimated.current ? false : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={hasAnimated.current ? undefined : { duration: 0.2, delay: Math.min(index * 0.04, 0.4), ease: "easeOut" }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </MotionTableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  {t("cell_scanner.result_table.empty_row")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col @sm/card:flex-row @sm/card:items-center gap-2 py-4">
        <div className="text-muted-foreground @sm/card:flex-1 text-sm">
          {(() => {
            const filtered = table.getFilteredRowModel().rows.length;
            const total = data.length;
            if (filtered < total) {
              return t("cell_scanner.result_table.footer_of_total", { filtered, total, count: filtered });
            }
            return t("cell_scanner.result_table.footer_total", { count: total });
          })()}
        </div>
        <div className="flex gap-2 @sm/card:ml-auto">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 @sm/card:flex-none @max-sm/card:min-h-11"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            {t("cell_scanner.result_table.previous")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 @sm/card:flex-none @max-sm/card:min-h-11"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            {t("cell_scanner.result_table.next")}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ScanResultView;
