"use client";
import React, { useState, useEffect, useMemo } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { RotateCcwIcon, SaveIcon } from "lucide-react";
import { IconGripVertical } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AiFillSignal } from "react-icons/ai";
import { Spinner } from "@/components/ui/spinner";

interface NetworkItem {
  id: string;
  name: string;
}

function DraggableNetworkItem({
  network,
  index,
  getNetworkColor,
}: {
  network: NetworkItem;
  index: number;
  getNetworkColor: (networkId: string) => string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: network.id,
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-3 px-4 py-2 border bg-background rounded-lg transition-all duration-200 ${
        isDragging ? "opacity-50 scale-95 z-10" : ""
      }`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition,
      }}
    >
      <Button
        {...attributes}
        {...listeners}
        variant="ghost"
        size="icon"
        className="text-muted-foreground size-7 hover:bg-accent cursor-grab active:cursor-grabbing"
      >
        <IconGripVertical className="text-muted-foreground size-4" />
        <span className="sr-only">Drag to reorder</span>
      </Button>
      <div className="flex items-center gap-x-3">
        <div
          className={`rounded-lg size-7 p-1 ${getNetworkColor(
            network.id,
          )} flex justify-center items-center`}
        >
          <AiFillSignal className="h-4 w-4 text-white" />
        </div>
        <span className="font-medium text-sm">{network.name}</span>
      </div>
      <span className="text-xs text-muted-foreground ml-auto">
        Priority {index + 1}
      </span>
    </div>
  );
}

const NetworkPriorityCard = () => {
  const [fetching, setFetching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // const [ratPriorityArray, setRatPriorityArray] = useState<string[]>([]);
  const [networks, setNetworks] = useState<NetworkItem[]>([
    { id: "nr5g", name: "NR5G" },
    { id: "lte", name: "LTE" },
    { id: "wcdma", name: "WCDMA" },
  ]);

  const sensors = useSensors(
    useSensor(MouseSensor, {}),
    useSensor(TouchSensor, {}),
    useSensor(KeyboardSensor, {}),
  );

  const networkIds = useMemo<UniqueIdentifier[]>(
    () => networks?.map(({ id }) => id) || [],
    [networks],
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      setNetworks((networks) => {
        const oldIndex = networkIds.indexOf(active.id);
        const newIndex = networkIds.indexOf(over.id);
        return arrayMove(networks, oldIndex, newIndex);
      });
    }
  }

  const getNetworkColor = (networkId: string) => {
    switch (networkId) {
      case "nr5g":
        return "bg-[#1E86FF]";
      case "lte":
        return "bg-[#00C9A7]";
      case "wcdma":
        return "bg-[#FF3D71]";
      default:
        return "bg-gray-600";
    }
  };

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Network Priority</CardTitle>
        <CardDescription>
          Set the priority order of your network connections.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {fetching ? (
          <div className="grid space-y-2 w-full">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <DndContext
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
            sensors={sensors}
          >
            <div className="space-y-2">
              <SortableContext
                items={networkIds}
                strategy={verticalListSortingStrategy}
              >
                {networks.map((network, index) => (
                  <DraggableNetworkItem
                    key={network.id}
                    network={network}
                    index={index}
                    getNetworkColor={getNetworkColor}
                  />
                ))}
              </SortableContext>
            </div>
          </DndContext>
        )}
        <div className="mt-4 flex items-center gap-x-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={fetching || isSaving || networks.length === 0}>
                {isSaving ? "Saving..." : "Save Settings"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Do you want to continue?</AlertDialogTitle>
                <AlertDialogDescription>
                  Changes to network priority will take effect after the device
                  reboots. Do you want to reboot now?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={fetching || isSaving}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction disabled={fetching || isSaving}>
                  <RotateCcwIcon className="h-4 w-4" />
                  Reboot Now
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Button>
            <RotateCcwIcon />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default NetworkPriorityCard;
