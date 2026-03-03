"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createBrowserClient } from "@/lib/supabase";
import { Session, Game } from "@/lib/types";
import InlineEdit from "@/components/InlineEdit";
import DragList, { DragHandleProps } from "@/components/DragList";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { CardSkeleton } from "@/components/LoadingSkeleton";

export default function SessionPage() {
  const params = useParams();
  const sessionId = params.id as string;
  const router = useRouter();
  // Stable singleton — useMemo ensures we don't recreate on every render
  const supabase = useMemo(() => createBrowserClient(), []);
  const { showToast } = useToast();
  // Ref to avoid showToast in useCallback deps (it's a new fn each render)
  const toastRef = useRef(showToast);
  toastRef.current = showToast;

  const [session, setSession] = useState<Session | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingGame, setAddingGame] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const reorderDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSession = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data, error } = await supabase
        .from("sessions")
        .select("*")
        .eq("id", sessionId)
        .single();

      if (error) {
        console.error("Supabase fetchSession error:", error.message, error.code, error.details);
        throw error;
      }
      setSession(data);
    } catch (err) {
      console.error("Failed to fetch session:", err);
      toastRef.current("Failed to load session", "error");
    }
  }, [supabase, sessionId]);

  const fetchGames = useCallback(async () => {
    if (!supabase) return;
    try {
      // Use photos(id) to count — avoids the broken "photos(count), photos(public_url)"
      // double-subselect that Supabase/PostgREST rejects silently.
      const { data, error } = await supabase
        .from("games")
        .select("*, photos(id)")
        .eq("session_id", sessionId)
        .order("position", { ascending: true });

      if (error) {
        console.error("Supabase fetchGames error:", error.message, error.code, error.details);
        throw error;
      }

      const mapped = (data || []).map((g) => {
        const photosArr = g.photos as unknown as { id: string }[];
        const photoCount = Array.isArray(photosArr) ? photosArr.length : 0;
        return {
          ...g,
          photos: undefined,
          photo_count: photoCount,
          first_photo_url: undefined,
        } as Game;
      });
      setGames(mapped);
    } catch (err) {
      console.error("Failed to fetch games:", err);
      toastRef.current("Failed to load games", "error");
    } finally {
      setLoading(false);
    }
  }, [supabase, sessionId]);

  // Fetch first photo for each game separately
  const fetchFirstPhotos = useCallback(
    async (gameIds: string[]) => {
      if (!supabase || gameIds.length === 0) return;
      const updates: Record<string, string> = {};
      for (const gid of gameIds) {
        const { data } = await supabase
          .from("photos")
          .select("public_url")
          .eq("game_id", gid)
          .order("position", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (data) {
          updates[gid] = data.public_url;
        }
      }
      if (Object.keys(updates).length > 0) {
        setGames((prev) =>
          prev.map((g) =>
            updates[g.id] ? { ...g, first_photo_url: updates[g.id] } : g
          )
        );
      }
    },
    [supabase]
  );

  // Initial data load — runs once
  useEffect(() => {
    fetchSession();
    fetchGames();
  }, [fetchSession, fetchGames]);

  // Fetch thumbnails whenever the game list changes
  const gameIdsKey = games.map((g) => g.id).join(",");
  useEffect(() => {
    if (games.length > 0) {
      fetchFirstPhotos(games.map((g) => g.id));
    }
  }, [gameIdsKey, fetchFirstPhotos]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateSessionName = async (name: string) => {
    try {
      const { error } = await supabase
        .from("sessions")
        .update({ name })
        .eq("id", sessionId);

      if (error) throw error;
      setSession((prev) => (prev ? { ...prev, name } : prev));
      showToast("Session name updated");
    } catch (err) {
      console.error("Failed to update session name:", err);
      showToast("Failed to update name", "error");
    }
  };

  const addGame = async () => {
    setAddingGame(true);
    try {
      const position = games.length;
      const name = `Round ${position + 1}`;

      const { data, error } = await supabase
        .from("games")
        .insert({ session_id: sessionId, name, position })
        .select()
        .single();

      if (error) throw error;
      setGames((prev) => [...prev, { ...data, photo_count: 0 }]);
      showToast("Game added");
    } catch (err) {
      console.error("Failed to add game:", err);
      showToast("Failed to add game", "error");
    } finally {
      setAddingGame(false);
    }
  };

  const updateGameName = async (gameId: string, name: string) => {
    try {
      const { error } = await supabase
        .from("games")
        .update({ name })
        .eq("id", gameId);

      if (error) throw error;
      setGames((prev) =>
        prev.map((g) => (g.id === gameId ? { ...g, name } : g))
      );
    } catch (err) {
      console.error("Failed to update game name:", err);
      showToast("Failed to update name", "error");
    }
  };

  const duplicateGame = async (game: Game) => {
    try {
      const position = games.length;
      const { data: newGame, error: gameError } = await supabase
        .from("games")
        .insert({
          session_id: sessionId,
          name: `${game.name} (Copy)`,
          position,
        })
        .select()
        .single();

      if (gameError) throw gameError;

      // Copy photos
      const { data: photos } = await supabase
        .from("photos")
        .select("*")
        .eq("game_id", game.id)
        .order("position");

      if (photos && photos.length > 0) {
        const newPhotos = photos.map((p) => ({
          game_id: newGame.id,
          storage_path: p.storage_path,
          public_url: p.public_url,
          position: p.position,
          answer_text: p.answer_text,
          answer_image_path: p.answer_image_path,
          answer_image_url: p.answer_image_url,
        }));
        await supabase.from("photos").insert(newPhotos);
      }

      setGames((prev) => [
        ...prev,
        {
          ...newGame,
          photo_count: game.photo_count || 0,
          first_photo_url: game.first_photo_url,
        },
      ]);
      showToast("Game duplicated");
    } catch (err) {
      console.error("Failed to duplicate game:", err);
      showToast("Failed to duplicate game", "error");
    }
  };

  const deleteGame = async () => {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase
        .from("games")
        .delete()
        .eq("id", deleteTarget);

      if (error) throw error;
      setGames((prev) => prev.filter((g) => g.id !== deleteTarget));
      showToast("Game deleted");
    } catch (err) {
      console.error("Failed to delete game:", err);
      showToast("Failed to delete game", "error");
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleReorder = (newGames: Game[]) => {
    const updated = newGames.map((g, i) => ({ ...g, position: i }));
    setGames(updated);

    if (reorderDebounce.current) clearTimeout(reorderDebounce.current);
    reorderDebounce.current = setTimeout(async () => {
      try {
        for (const game of updated) {
          await supabase
            .from("games")
            .update({ position: game.position })
            .eq("id", game.id);
        }
      } catch (err) {
        console.error("Failed to update positions:", err);
        showToast("Failed to save order", "error");
        fetchGames();
      }
    }, 300);
  };

  if (loading) {
    return (
      <div>
        <div className="mb-6">
          <div className="animate-pulse h-8 w-64 bg-gray-200 rounded mb-2" />
          <div className="animate-pulse h-4 w-32 bg-gray-200 rounded" />
        </div>
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500">Session not found.</p>
        <Link
          href="/"
          className="text-primary hover:underline mt-2 inline-block"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/"
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
          Back to dashboard
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <InlineEdit
              value={session.name}
              onSave={updateSessionName}
              className="text-2xl font-bold text-gray-900"
              inputClassName="text-2xl font-bold"
            />
            <p className="mt-1 text-sm text-gray-500">
              {new Date(session.date + "T00:00:00").toLocaleDateString(
                "en-US",
                {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                }
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex flex-wrap gap-3 mb-6">
        <button
          onClick={addGame}
          disabled={addingGame}
          className="rounded-lg bg-primary px-4 py-2 font-medium text-white hover:bg-primary-hover transition-colors disabled:opacity-50"
        >
          {addingGame ? "Adding..." : "Add Game"}
        </button>
        <Link
          href={`/present/${sessionId}`}
          target="_blank"
          className="rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Present Session
        </Link>
        <Link
          href={`/remote/${sessionId}`}
          target="_blank"
          className="rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Remote Control
        </Link>
      </div>

      {/* Game list */}
      {games.length === 0 ? (
        <div className="text-center py-16 rounded-xl border border-gray-200 bg-white">
          <div className="text-gray-400 text-4xl mb-3">🎮</div>
          <p className="text-gray-500">
            No games yet. Add your first round.
          </p>
        </div>
      ) : (
        <DragList
          items={games}
          keyExtractor={(g) => g.id}
          onReorder={handleReorder}
          renderItem={(game, _index, dragHandleProps: DragHandleProps) => (
            <GameCard
              game={game}
              sessionId={sessionId}
              dragHandleProps={dragHandleProps}
              onUpdateName={(name) => updateGameName(game.id, name)}
              onDuplicate={() => duplicateGame(game)}
              onDelete={() => setDeleteTarget(game.id)}
              onNavigate={() =>
                router.push(`/session/${sessionId}/game/${game.id}`)
              }
            />
          )}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Game"
        message="Are you sure you want to delete this game? All photos in it will be permanently deleted."
        onConfirm={deleteGame}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function GameCard({
  game,
  dragHandleProps,
  onUpdateName,
  onDuplicate,
  onDelete,
  onNavigate,
}: {
  game: Game;
  sessionId: string;
  dragHandleProps: DragHandleProps;
  onUpdateName: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onNavigate: () => void;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
      {/* Drag handle */}
      <div
        {...dragHandleProps}
        className={`flex-shrink-0 text-gray-400 hover:text-gray-600 ${dragHandleProps.className}`}
      >
        <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
          <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
        </svg>
      </div>

      {/* Thumbnail */}
      <div className="flex-shrink-0 w-16 h-12 rounded-lg bg-gray-100 overflow-hidden">
        {game.first_photo_url ? (
          <Image
            src={game.first_photo_url}
            alt=""
            width={64}
            height={48}
            loading="lazy"
            className="w-full h-full object-cover"
            unoptimized
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300">
            <svg
              className="w-6 h-6"
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
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <InlineEdit
          value={game.name}
          onSave={onUpdateName}
          className="font-semibold text-gray-900"
        />
        <p className="text-sm text-gray-500">
          {game.photo_count || 0}{" "}
          {(game.photo_count || 0) === 1 ? "photo" : "photos"}
        </p>
      </div>

      {/* Actions */}
      <div className="flex-shrink-0 flex gap-2">
        <button
          onClick={onNavigate}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover transition-colors"
        >
          Edit
        </button>
        <button
          onClick={onDuplicate}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
        >
          Duplicate
        </button>
        <button
          onClick={onDelete}
          className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-red-50 transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
