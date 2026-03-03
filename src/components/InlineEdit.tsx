"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface InlineEditProps {
  value: string;
  onSave: (value: string) => void;
  className?: string;
  inputClassName?: string;
  debounceMs?: number;
}

export default function InlineEdit({
  value,
  onSave,
  className = "",
  inputClassName = "",
  debounceMs = 500,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setText(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const save = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = text.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    } else {
      setText(value);
    }
    setEditing(false);
  }, [text, value, onSave]);

  const debouncedSave = useCallback(
    (newText: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const trimmed = newText.trim();
      if (trimmed && trimmed !== value) {
        debounceRef.current = setTimeout(() => {
          onSave(trimmed);
        }, debounceMs);
      }
    },
    [value, onSave, debounceMs]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newText = e.target.value;
    setText(newText);
    debouncedSave(newText);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={text}
        onChange={handleChange}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            setText(value);
            setEditing(false);
          }
        }}
        className={`rounded-lg border border-gray-300 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary ${inputClassName}`}
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setEditing(true);
        }
      }}
      tabIndex={0}
      role="button"
      className={`cursor-pointer rounded px-1 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary transition-colors ${className}`}
      title="Click to edit"
    >
      {value}
    </span>
  );
}
