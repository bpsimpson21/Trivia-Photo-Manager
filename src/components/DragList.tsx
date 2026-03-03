"use client";

import { useState, useRef, useCallback } from "react";

interface DragListProps<T> {
  items: T[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T, index: number, dragHandleProps: DragHandleProps) => React.ReactNode;
  onReorder: (items: T[]) => void;
}

export interface DragHandleProps {
  draggable: true;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  className: string;
}

export default function DragList<T>({
  items,
  keyExtractor,
  renderItem,
  onReorder,
}: DragListProps<T>) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragNode = useRef<HTMLDivElement | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index);
    dragNode.current = e.currentTarget as HTMLDivElement;
    e.dataTransfer.effectAllowed = "move";
    // Make drag image slightly transparent
    requestAnimationFrame(() => {
      if (dragNode.current) {
        dragNode.current.style.opacity = "0.5";
      }
    });
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragNode.current) {
      dragNode.current.style.opacity = "1";
    }
    if (dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
      const newItems = [...items];
      const [removed] = newItems.splice(dragIndex, 1);
      newItems.splice(overIndex, 0, removed);
      onReorder(newItems);
    }
    setDragIndex(null);
    setOverIndex(null);
    dragNode.current = null;
  }, [dragIndex, overIndex, items, onReorder]);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverIndex(index);
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {items.map((item, index) => {
        const dragHandleProps: DragHandleProps = {
          draggable: true,
          onDragStart: (e) => handleDragStart(e, index),
          onDragEnd: handleDragEnd,
          className: "cursor-grab active:cursor-grabbing select-none",
        };

        return (
          <div
            key={keyExtractor(item)}
            onDragOver={(e) => handleDragOver(e, index)}
            className={`transition-all duration-150 ${
              overIndex === index && dragIndex !== null && dragIndex !== index
                ? "border-t-2 border-primary pt-1"
                : ""
            }`}
          >
            {renderItem(item, index, dragHandleProps)}
          </div>
        );
      })}
    </div>
  );
}
