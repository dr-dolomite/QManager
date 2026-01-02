"use client";

import * as React from "react";
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
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  ChevronDown,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
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
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";

export interface NeighbourCellResult {
  id: string;
  networkType: string;
  cellType: string;
  frequency: number;
  pci: number;
  signalStrength: number;
}

interface NeighbourScanResultViewProps {
  data: NeighbourCellResult[];
}

const getSignalBadge = (strength: number) => {
  if (strength >= -85)
    return (
      <Badge className="bg-green-500/20 text-green-500 hover:bg-green-500/30 border border-green-300/50 backdrop-blur-sm">
        Good
      </Badge>
    );
  if (strength >= -100)
    return (
      <Badge className="bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30 border border-yellow-300/50 backdrop-blur-sm">
        Fair
      </Badge>
    );
  return (
    <Badge className="bg-red-500/20 text-red-500 hover:bg-red-500/30 border border-red-300/50 backdrop-blur-sm">
      Bad
    </Badge>
  );
};

const getNetworkTypeBadge = (type: string) => {
  return <Badge variant="default">{type}</Badge>;
};

const columns: ColumnDef<NeighbourCellResult>[] = [
  {
    accessorKey: "networkType",
    header: () => <div className="pl-4">Network</div>,
    cell: ({ row }) => (
      <div className="pl-4">{getNetworkTypeBadge(row.getValue("networkType"))}</div>
    ),
  },
  {
    accessorKey: "cellType",
    header: "Cell Type",
    cell: ({ row }) => <div className="font-medium">{row.getValue("cellType")}</div>,
  },
  {
    accessorKey: "frequency",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Frequency
        <ArrowUpDown className="h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => <div className="font-semibold">{row.getValue("frequency")}</div>,
  },
  {
    accessorKey: "pci",
    header: "PCI",
    cell: ({ row }) => <div className="font-semibold">{row.getValue("pci")}</div>,
  },
  {
    accessorKey: "signalStrength",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Signal
        <ArrowUpDown className="h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const strength = row.getValue("signalStrength") as number;
      return (
        <div className="flex items-center gap-2">
          {getSignalBadge(strength)}
          <span className="font-semibold">{strength} dBm</span>
        </div>
      );
    },
  },
];

const NeighbourScanResultView = ({ data }: NeighbourScanResultViewProps) => {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const isMobile = useIsMobile();

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
    <div className="relative flex flex-col gap-4 overflow-hidden">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
        <Input
          placeholder="Filter by cell type..."
          value={
            (table.getColumn("cellType")?.getFilterValue() as string) ?? ""
          }
          onChange={(event) =>
            table.getColumn("cellType")?.setFilterValue(event.target.value)
          }
          className="max-w-sm"
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="sm:ml-auto">
              Columns <ChevronDown className="h-4 w-4" />
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
                    className="capitalize"
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) =>
                      column.toggleVisibility(!!value)
                    }
                  >
                    {column.id}
                  </DropdownMenuCheckboxItem>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table className={isMobile ? "min-w-[600px]" : ""}>
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
                            header.getContext()
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end space-x-2 py-4">
        <div className="text-muted-foreground flex-1 text-sm">
          {table.getFilteredRowModel().rows.length} cell(s) found.
        </div>
        <div className="space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NeighbourScanResultView;