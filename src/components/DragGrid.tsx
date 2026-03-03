"use client";

import { useState, useRef, useCallback } from "react";

interface DragGridProps<T> {
  items: T[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  onReorder: (items: T[]) => void;
  className?: string;
}

export default function DragGrid<T>({
  items,
  keyExtractor,
  renderItem,
  onReorder,
  className = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3",
}: DragGridProps<T>) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragNode = useRef<HTMLDivElement | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index);
    dragNode.current = e.currentTarget as HTMLDivElement;
    e.dataTransfer.effectAllowed = "move";
    requestAnimationFrame(() => {
      if (dragNode.current) {
        dragNode.current.style.opacity = "0.4";
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
    <div className={className}>
      {items.map((item, index) => (
        <div
          key={keyExtractor(item)}
          draggable
          onDragStart={(e) => handleDragStart(e, index)}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => handleDragOver(e, index)}
          className={`cursor-grab active:cursor-grabbing transition-all duration-150 ${
            overIndex === index && dragIndex !== null && dragIndex !== index
              ? "ring-2 ring-primary ring-offset-2 scale-[1.02]"
              : ""
          } ${dragIndex === index ? "opacity-50" : ""}`}
        >
          {renderItem(item, index)}
        </div>
      ))}
    </div>
  );
}
