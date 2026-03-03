"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { v4 as uuidv4 } from "uuid";
import { createBrowserClient } from "@/lib/supabase";
import { Game, Photo } from "@/lib/types";
import { optimizeImage } from "@/lib/optimize-image";
import InlineEdit from "@/components/InlineEdit";
import DragGrid from "@/components/DragGrid";
import ConfirmDialog from "@/components/ConfirmDialog";
import Lightbox from "@/components/Lightbox";
import { useToast } from "@/components/Toast";
import { PhotoGridSkeleton } from "@/components/LoadingSkeleton";

interface UploadItem {
  id: string;
  file: File;
  previewUrl: string;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

export default function GameEditorPage() {
  const params = useParams();
  const sessionId = params.id as string;
  const gameId = params.gameId as string;
  const supabase = useMemo(() => createBrowserClient(), []);
  const { showToast } = useToast();
  const toastRef = useRef(showToast);
  toastRef.current = showToast;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [game, setGame] = useState<Game | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Google Drive import state
  const [driveUrl, setDriveUrl] = useState("");
  const [driveImporting, setDriveImporting] = useState(false);
  const [driveProgress, setDriveProgress] = useState<string | null>(null);

  // Debounce refs
  const reorderDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchGame = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data, error } = await supabase
        .from("games")
        .select("*")
        .eq("id", gameId)
        .single();

      if (error) {
        console.error("Supabase fetchGame error:", error.message, error.code, error.details);
        throw error;
      }
      setGame(data);
    } catch (err) {
      console.error("Failed to fetch game:", err);
      toastRef.current("Failed to load game", "error");
    }
  }, [supabase, gameId]);

  const fetchPhotos = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data, error } = await supabase
        .from("photos")
        .select("*")
        .eq("game_id", gameId)
        .order("position", { ascending: true });

      if (error) {
        console.error("Supabase fetchPhotos error:", error.message, error.code, error.details);
        throw error;
      }
      setPhotos(data || []);
    } catch (err) {
      console.error("Failed to fetch photos:", err);
      toastRef.current("Failed to load photos", "error");
    } finally {
      setLoading(false);
    }
  }, [supabase, gameId]);

  useEffect(() => {
    fetchGame();
    fetchPhotos();
  }, [fetchGame, fetchPhotos]);

  const updateGameName = async (name: string) => {
    try {
      const { error } = await supabase
        .from("games")
        .update({ name })
        .eq("id", gameId);

      if (error) throw error;
      setGame((prev) => (prev ? { ...prev, name } : prev));
      showToast("Game name updated");
    } catch (err) {
      console.error("Failed to update game name:", err);
      showToast("Failed to update name", "error");
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files).slice(0, 50);
    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    const validFiles = fileArray.filter((f) => validTypes.includes(f.type));

    if (validFiles.length < fileArray.length) {
      showToast(
        `${fileArray.length - validFiles.length} file(s) skipped (unsupported format)`,
        "error"
      );
    }

    if (validFiles.length === 0) return;

    const items: UploadItem[] = validFiles.map((file) => ({
      id: uuidv4(),
      file,
      previewUrl: URL.createObjectURL(file),
      status: "pending" as const,
    }));

    setUploadQueue((prev) => [...prev, ...items]);

    // Upload each file
    let currentPosition = photos.length;
    for (const item of items) {
      setUploadQueue((prev) =>
        prev.map((u) => (u.id === item.id ? { ...u, status: "uploading" } : u))
      );

      try {
        const optimized = await optimizeImage(item.file);
        const fileName = `${uuidv4()}.jpg`;
        const storagePath = `${sessionId}/${gameId}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from("trivia-photos")
          .upload(storagePath, optimized, {
            contentType: "image/jpeg",
            cacheControl: "3600",
          });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from("trivia-photos")
          .getPublicUrl(storagePath);

        const publicUrl = urlData.publicUrl;

        const { data: photoData, error: insertError } = await supabase
          .from("photos")
          .insert({
            game_id: gameId,
            storage_path: storagePath,
            public_url: publicUrl,
            position: currentPosition,
          })
          .select()
          .single();

        if (insertError) throw insertError;

        setPhotos((prev) => [...prev, photoData]);
        currentPosition++;

        setUploadQueue((prev) =>
          prev.map((u) => (u.id === item.id ? { ...u, status: "done" } : u))
        );
      } catch (err) {
        console.error("Upload failed:", err);
        setUploadQueue((prev) =>
          prev.map((u) =>
            u.id === item.id
              ? { ...u, status: "error", error: "Upload failed" }
              : u
          )
        );
      }
    }

    // Clean up completed uploads after a delay
    setTimeout(() => {
      setUploadQueue((prev) => prev.filter((u) => u.status !== "done"));
    }, 2000);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleDragOverEvent = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDriveImport = async () => {
    if (!driveUrl.trim()) return;
    setDriveImporting(true);
    setDriveProgress("Connecting to Google Drive...");
    try {
      const res = await fetch("/api/import-drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderUrl: driveUrl, gameId, sessionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Import failed", "error");
        return;
      }
      setDriveProgress(null);
      setDriveUrl("");
      showToast(
        `Imported ${data.imported} photo${data.imported !== 1 ? "s" : ""}${
          data.failed > 0 ? ` (${data.failed} failed)` : ""
        }`
      );
      fetchPhotos();
    } catch {
      showToast("Failed to import from Google Drive", "error");
    } finally {
      setDriveImporting(false);
      setDriveProgress(null);
    }
  };

  const updateAnswerText = async (photoId: string, answerText: string) => {
    try {
      const { error } = await supabase
        .from("photos")
        .update({ answer_text: answerText || null })
        .eq("id", photoId);

      if (error) throw error;
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photoId ? { ...p, answer_text: answerText || null } : p
        )
      );
    } catch (err) {
      console.error("Failed to update answer:", err);
      showToast("Failed to save answer", "error");
    }
  };

  const deletePhoto = async () => {
    if (!deleteTarget) return;
    const photo = photos.find((p) => p.id === deleteTarget);
    if (!photo) return;

    try {
      // Delete from storage
      await supabase.storage.from("trivia-photos").remove([photo.storage_path]);

      // Delete from database
      const { error } = await supabase
        .from("photos")
        .delete()
        .eq("id", deleteTarget);

      if (error) throw error;

      setPhotos((prev) => prev.filter((p) => p.id !== deleteTarget));
      showToast("Photo deleted");
    } catch (err) {
      console.error("Failed to delete photo:", err);
      showToast("Failed to delete photo", "error");
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleReorder = (newPhotos: Photo[]) => {
    const updated = newPhotos.map((p, i) => ({ ...p, position: i }));
    setPhotos(updated);

    if (reorderDebounce.current) clearTimeout(reorderDebounce.current);
    reorderDebounce.current = setTimeout(async () => {
      try {
        for (const photo of updated) {
          await supabase
            .from("photos")
            .update({ position: photo.position })
            .eq("id", photo.id);
        }
      } catch (err) {
        console.error("Failed to update positions:", err);
        showToast("Failed to save order", "error");
        fetchPhotos();
      }
    }, 300);
  };

  if (loading) {
    return (
      <div>
        <div className="mb-6">
          <div className="animate-pulse h-4 w-32 bg-gray-200 rounded mb-4" />
          <div className="animate-pulse h-8 w-48 bg-gray-200 rounded mb-2" />
        </div>
        <PhotoGridSkeleton count={6} />
      </div>
    );
  }

  if (!game) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500">Game not found.</p>
        <Link
          href={`/session/${sessionId}`}
          className="text-primary hover:underline mt-2 inline-block"
        >
          Back to session
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link
          href={`/session/${sessionId}`}
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-3 transition-colors"
        >
          <svg
            className="w-4 h-4 mr-1"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to session
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <InlineEdit
              value={game.name}
              onSave={updateGameName}
              className="text-2xl font-bold text-gray-900"
              inputClassName="text-2xl font-bold"
            />
            <p className="mt-1 text-sm text-gray-500">
              {photos.length} {photos.length === 1 ? "photo" : "photos"}
            </p>
          </div>
          <Link
            href={`/present/${sessionId}`}
            target="_blank"
            className="rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Present Game
          </Link>
        </div>
      </div>

      {/* Upload Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOverEvent}
        onDragLeave={() => setDragOver(false)}
        onClick={() => fileInputRef.current?.click()}
        className={`mb-6 cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          dragOver
            ? "border-primary bg-blue-50"
            : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <svg
          className="mx-auto h-10 w-10 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <p className="mt-3 text-sm font-medium text-gray-700">
          Drag & drop photos here
        </p>
        <p className="mt-1 text-xs text-gray-500">or click to browse</p>
        <p className="mt-1 text-xs text-gray-400">
          JPEG, PNG, WebP — up to 50 at once
        </p>
      </div>

      {/* Google Drive Import */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Import from Google Drive
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={driveUrl}
            onChange={(e) => setDriveUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleDriveImport();
            }}
            placeholder="Paste Google Drive folder link..."
            disabled={driveImporting}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
          />
          <button
            onClick={handleDriveImport}
            disabled={driveImporting || !driveUrl.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
            {driveImporting ? "Importing..." : "Import"}
          </button>
        </div>
        {driveProgress && (
          <div className="mt-2 flex items-center gap-2 text-sm text-gray-500">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            {driveProgress}
          </div>
        )}
        <p className="mt-2 text-xs text-gray-400">
          Folder must be publicly shared (Anyone with the link).
        </p>
      </div>

      {/* Upload Queue */}
      {uploadQueue.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {uploadQueue.map((item) => (
            <div
              key={item.id}
              className="relative rounded-lg border border-gray-200 overflow-hidden"
            >
              <div className="aspect-video">
                <Image
                  src={item.previewUrl}
                  alt=""
                  width={200}
                  height={112}
                  className="w-full h-full object-cover"
                  unoptimized
                />
              </div>
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                {item.status === "pending" && (
                  <span className="text-white text-xs font-medium">Waiting...</span>
                )}
                {item.status === "uploading" && (
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
                )}
                {item.status === "done" && (
                  <span className="text-green-400 text-2xl">✓</span>
                )}
                {item.status === "error" && (
                  <span className="text-red-400 text-2xl">✕</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Photo Grid */}
      {photos.length === 0 && uploadQueue.length === 0 ? (
        <div className="text-center py-16 rounded-xl border border-gray-200 bg-white">
          <div className="text-gray-400 text-4xl mb-3">📷</div>
          <p className="text-gray-500">No photos yet. Upload some to get started.</p>
        </div>
      ) : photos.length > 0 ? (
        <DragGrid
          items={photos}
          keyExtractor={(p) => p.id}
          onReorder={handleReorder}
          renderItem={(photo, index) => (
            <PhotoCard
              photo={photo}
              index={index}
              onClickPhoto={() => setLightboxSrc(photo.public_url)}
              onUpdateAnswer={(answer) => updateAnswerText(photo.id, answer)}
              onDelete={() => setDeleteTarget(photo.id)}
            />
          )}
        />
      ) : null}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Photo"
        message="Are you sure you want to delete this photo? This cannot be undone."
        onConfirm={deletePhoto}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Lightbox */}
      <Lightbox
        open={lightboxSrc !== null}
        src={lightboxSrc || ""}
        alt="Photo preview"
        onClose={() => setLightboxSrc(null)}
      />
    </div>
  );
}

function PhotoCard({
  photo,
  index,
  onClickPhoto,
  onUpdateAnswer,
  onDelete,
}: {
  photo: Photo;
  index: number;
  onClickPhoto: () => void;
  onUpdateAnswer: (answer: string) => void;
  onDelete: () => void;
}) {
  const [answer, setAnswer] = useState(photo.answer_text || "");
  const [showDelete, setShowDelete] = useState(false);

  return (
    <div
      className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden group"
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
    >
      {/* Image */}
      <div className="relative aspect-video cursor-pointer" onClick={onClickPhoto}>
        <Image
          src={photo.public_url}
          alt={`Photo ${index + 1}`}
          fill
          loading="lazy"
          className="object-cover"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          unoptimized
        />
        {/* Position badge */}
        <span className="absolute top-2 left-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-xs font-bold text-white">
          {index + 1}
        </span>
        {/* Delete button */}
        {showDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-red-600 text-white text-sm hover:bg-red-700 transition-colors"
            aria-label="Delete photo"
          >
            ✕
          </button>
        )}
      </div>

      {/* Answer input */}
      <div className="p-3">
        <input
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onBlur={() => onUpdateAnswer(answer)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Answer (optional)"
          className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
        />
      </div>
    </div>
  );
}
