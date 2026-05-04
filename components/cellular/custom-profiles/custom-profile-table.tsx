"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { TriangleAlertIcon } from "lucide-react";
import {
  TbCircleCheckFilled,
  TbDotsVertical,
  TbEdit,
  TbPlayerPlay,
  TbPlayerStop,
  TbTrash,
} from "react-icons/tb";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const MotionTableRow = motion.create(TableRow);
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

import type { ProfileSummary } from "@/types/sim-profile";
import { formatProfileDate } from "@/types/sim-profile";

// =============================================================================
// ProfileTable — Displays saved SIM profiles with actions
// =============================================================================
// No drag-and-drop. Profiles have no inherent ordering.
// Actions: Edit, Activate (future), Delete.
// =============================================================================

interface ProfileTableProps {
  data: ProfileSummary[];
  activeProfileId: string | null;
  onEdit: (id: string) => void;
  onDelete: (id: string) => Promise<boolean>;
  onActivate?: (id: string) => void;
  onDeactivate?: () => void;
  currentIccid?: string | null;
}

export function ProfileTable({
  data,
  activeProfileId,
  onEdit,
  onDelete,
  onActivate,
  onDeactivate,
  currentIccid,
}: ProfileTableProps) {
  const { t } = useTranslation("cellular");
  const [deleteTarget, setDeleteTarget] = React.useState<ProfileSummary | null>(
    null
  );
  const [isDeleting, setIsDeleting] = React.useState(false);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    await onDelete(deleteTarget.id);
    setIsDeleting(false);
    setDeleteTarget(null);
  };

  const columns: ColumnDef<ProfileSummary>[] = React.useMemo(
    () => [
      {
        accessorKey: "name",
        header: t("custom_profiles.table.headers.profile"),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <div>
              <div className="font-medium">{row.original.name}</div>
              {row.original.mno && (
                <div className="text-muted-foreground text-xs">
                  {row.original.mno}
                </div>
              )}
            </div>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "status",
        header: t("custom_profiles.table.headers.status"),
        cell: ({ row }) => {
          const isActive = row.original.id === activeProfileId;
          if (isActive) {
            const profileIccid = row.original.sim_iccid;
            const isMismatch =
              profileIccid && currentIccid && profileIccid !== currentIccid;

            if (isMismatch) {
              return (
                <Badge
                  variant="outline"
                  className="px-1.5 bg-warning/15 text-warning hover:bg-warning/20 border-warning/30"
                >
                  <TriangleAlertIcon className="size-3" />
                  {t("custom_profiles.table.status_badge.sim_mismatch")}
                </Badge>
              );
            }

            return (
              <Badge
                variant="outline"
                className="px-1.5 text-blue-600 border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800"
              >
                <TbCircleCheckFilled className="fill-blue-500 dark:fill-blue-400" />
                {t("custom_profiles.table.status_badge.active")}
              </Badge>
            );
          }
          return (
            <Badge
              variant="outline"
              className="px-1.5 text-muted-foreground"
            >
              {t("custom_profiles.table.status_badge.inactive")}
            </Badge>
          );
        },
      },
      {
        id: "updated",
        header: t("custom_profiles.table.headers.last_updated"),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {formatProfileDate(row.original.updated_at)}
          </span>
        ),
      },
      {
        id: "actions",
        header: t("custom_profiles.table.headers.actions"),
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="data-[state=open]:bg-muted text-muted-foreground flex size-8"
                size="icon"
              >
                <TbDotsVertical />
                <span className="sr-only">{t("custom_profiles.table.actions_menu.open_menu")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => onEdit(row.original.id)}>
                <TbEdit className="size-4" />
                {t("custom_profiles.table.actions_menu.edit")}
              </DropdownMenuItem>
              {onActivate && row.original.id !== activeProfileId && (
                <DropdownMenuItem
                  onClick={() => onActivate(row.original.id)}
                >
                  <TbPlayerPlay className="size-4" />
                  {t("custom_profiles.table.actions_menu.activate")}
                </DropdownMenuItem>
              )}
              {onDeactivate && row.original.id === activeProfileId && (
                <DropdownMenuItem onClick={onDeactivate}>
                  <TbPlayerStop className="size-4" />
                  {t("custom_profiles.table.actions_menu.deactivate")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteTarget(row.original)}
              >
                <TbTrash className="size-4" />
                {t("custom_profiles.table.actions_menu.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [t, activeProfileId, onEdit, onActivate, onDeactivate, currentIccid]
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageSize: 10 },
    },
  });

  return (
    <>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} colSpan={header.colSpan}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row, index) => (
                <MotionTableRow
                  key={row.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(index * 0.05, 0.4), ease: "easeOut" }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
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
                  {t("custom_profiles.table.empty_row")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {data.length > 0 && (
        <div className="flex items-center justify-between px-2 pt-2">
          <span className="text-muted-foreground text-sm">
            {t("custom_profiles.table.pagination.total", { count: data.length })}
          </span>
          {table.getPageCount() > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                {t("custom_profiles.table.pagination.previous")}
              </Button>
              <span className="text-sm">
                {t("custom_profiles.table.pagination.page_info", {
                  current: table.getState().pagination.pageIndex + 1,
                  total: table.getPageCount(),
                })}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                {t("custom_profiles.table.pagination.next")}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("custom_profiles.table.delete_confirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("custom_profiles.table.delete_confirm.description", {
                name: deleteTarget?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting
                ? t("custom_profiles.table.delete_confirm.deleting")
                : t("custom_profiles.table.delete_confirm.confirm_button")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
