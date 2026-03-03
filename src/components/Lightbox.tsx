"use client";

import { useEffect } from "react";
import Image from "next/image";

interface LightboxProps {
  open: boolean;
  src: string;
  alt: string;
  onClose: () => void;
}

export default function Lightbox({ open, src, alt, onClose }: LightboxProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white text-3xl font-light hover:opacity-75 transition-opacity"
        aria-label="Close"
      >
        ✕
      </button>
      <div
        className="relative max-h-[90vh] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <Image
          src={src}
          alt={alt}
          width={1920}
          height={1080}
          className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
          unoptimized
        />
      </div>
    </div>
  );
}
