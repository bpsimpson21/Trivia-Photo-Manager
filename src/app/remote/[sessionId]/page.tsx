"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { createBrowserClient } from "@/lib/supabase";
import type { Game, Photo } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GameSlides {
  game: Game;
  photos: Photo[];
}

type TimerOption = 0 | 5 | 10 | 15 | 30;
const TIMER_OPTIONS: TimerOption[] = [0, 5, 10, 15, 30];

type ConnectionStatus = "connected" | "connecting" | "disconnected";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function RemoteControlPage() {
  const params = useParams();
  const sessionId = params.sessionId as string;
  const supabase = useMemo(() => createBrowserClient(), []);

  // --- data ---
  const [allSlides, setAllSlides] = useState<GameSlides[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- navigation state ---
  const [gameIndex, setGameIndex] = useState(0);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState<TimerOption>(0);
  const [showCounter, setShowCounter] = useState(false);

  // --- connection ---
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const isRemoteUpdate = useRef(false);

  // --- settings panel ---
  const [settingsOpen, setSettingsOpen] = useState(false);

  // --- wake lock ---
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // --- game switcher scroll ref ---
  const gameSwitcherRef = useRef<HTMLDivElement>(null);

  // =========================================================================
  // Data loading
  // =========================================================================

  useEffect(() => {
    if (!supabase) return;

    async function load() {
      try {
        const { data: games, error: gErr } = await supabase
          .from("games")
          .select("*")
          .eq("session_id", sessionId)
          .order("position", { ascending: true });

        if (gErr) throw gErr;
        if (!games || games.length === 0) {
          setError("No games found for this session.");
          setLoading(false);
          return;
        }

        const gameIds = games.map((g: Game) => g.id);
        const { data: photos, error: pErr } = await supabase
          .from("photos")
          .select("*")
          .in("game_id", gameIds)
          .order("position", { ascending: true });

        if (pErr) throw pErr;

        const slides: GameSlides[] = games.map((g: Game) => ({
          game: g,
          photos: (photos || []).filter((p: Photo) => p.game_id === g.id),
        }));

        setAllSlides(slides);

        // Read existing display_state to sync initial position
        const { data: ds } = await supabase
          .from("display_state")
          .select("*")
          .eq("session_id", sessionId)
          .maybeSingle();

        if (ds) {
          const gIdx = slides.findIndex((s) => s.game.id === ds.current_game_id);
          if (gIdx >= 0) {
            setGameIndex(gIdx);
            setPhotoIndex(ds.current_photo_index ?? 0);
            setShowAnswer(ds.show_answer ?? false);
            setTimerSeconds((ds.timer_seconds as TimerOption) ?? 0);
          }
        }

        setLoading(false);
      } catch (err) {
        console.error("Remote load error:", err);
        setError("Failed to load session data.");
        setLoading(false);
      }
    }

    load();
  }, [supabase, sessionId]);

  // =========================================================================
  // Wake Lock
  // =========================================================================

  useEffect(() => {
    async function requestWakeLock() {
      try {
        if ("wakeLock" in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request("screen");
        }
      } catch {
        // Wake lock not available or denied
      }
    }

    requestWakeLock();

    // Re-acquire on visibility change
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      wakeLockRef.current?.release();
    };
  }, []);

  // =========================================================================
  // Realtime subscription
  // =========================================================================

  useEffect(() => {
    if (!supabase || allSlides.length === 0) return;

    const channel = supabase
      .channel(`remote_display_${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "display_state",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload: { new: Record<string, unknown> }) => {
          const ns = payload.new;
          if (!ns) return;

          // Skip our own writes
          if (isRemoteUpdate.current) return;

          const gIdx = allSlides.findIndex(
            (s) => s.game.id === ns.current_game_id
          );
          if (gIdx >= 0) {
            setGameIndex(gIdx);
            setPhotoIndex(ns.current_photo_index as number);
            setShowAnswer(ns.show_answer as boolean);
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnectionStatus("connected");
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
          setConnectionStatus("disconnected");
        } else {
          setConnectionStatus("connecting");
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, sessionId, allSlides]);

  // =========================================================================
  // Write display state
  // =========================================================================

  const syncState = useCallback(
    (updates: {
      gameIdx?: number;
      photoIdx?: number;
      answer?: boolean;
      timer?: number;
    }) => {
      if (!supabase || allSlides.length === 0) return;

      const gIdx = updates.gameIdx ?? gameIndex;
      const pIdx = updates.photoIdx ?? photoIndex;
      const ans = updates.answer ?? showAnswer;
      const tmr = updates.timer ?? timerSeconds;
      const game = allSlides[gIdx]?.game;
      if (!game) return;

      isRemoteUpdate.current = true;

      supabase
        .from("display_state")
        .update({
          current_game_id: game.id,
          current_photo_index: pIdx,
          show_answer: ans,
          timer_seconds: tmr,
          updated_at: new Date().toISOString(),
        })
        .eq("session_id", sessionId)
        .then(() => {
          setTimeout(() => {
            isRemoteUpdate.current = false;
          }, 150);
        });
    },
    [supabase, sessionId, allSlides, gameIndex, photoIndex, showAnswer, timerSeconds]
  );

  // =========================================================================
  // Navigation actions
  // =========================================================================

  const goNext = useCallback(() => {
    const currentGame = allSlides[gameIndex];
    if (!currentGame) return;

    let newGI = gameIndex;
    let newPI = photoIndex;

    if (photoIndex < currentGame.photos.length - 1) {
      newPI = photoIndex + 1;
    } else if (gameIndex < allSlides.length - 1) {
      newGI = gameIndex + 1;
      newPI = 0;
    } else {
      return; // End of session
    }

    setGameIndex(newGI);
    setPhotoIndex(newPI);
    setShowAnswer(false);
    syncState({ gameIdx: newGI, photoIdx: newPI, answer: false });
    try { navigator.vibrate?.(10); } catch {}
  }, [gameIndex, photoIndex, allSlides, syncState]);

  const goPrev = useCallback(() => {
    let newGI = gameIndex;
    let newPI = photoIndex;

    if (photoIndex > 0) {
      newPI = photoIndex - 1;
    } else if (gameIndex > 0) {
      newGI = gameIndex - 1;
      newPI = allSlides[newGI].photos.length - 1;
    } else {
      return; // Start of session
    }

    setGameIndex(newGI);
    setPhotoIndex(newPI);
    setShowAnswer(false);
    syncState({ gameIdx: newGI, photoIdx: newPI, answer: false });
    try { navigator.vibrate?.(10); } catch {}
  }, [gameIndex, photoIndex, allSlides, syncState]);

  const toggleAnswer = useCallback(() => {
    const next = !showAnswer;
    setShowAnswer(next);
    syncState({ answer: next });
    try { navigator.vibrate?.(25); } catch {}
  }, [showAnswer, syncState]);

  const jumpToGame = useCallback(
    (gIdx: number) => {
      setGameIndex(gIdx);
      setPhotoIndex(0);
      setShowAnswer(false);
      syncState({ gameIdx: gIdx, photoIdx: 0, answer: false });
      try { navigator.vibrate?.(10); } catch {}
    },
    [syncState]
  );

  const setTimer = useCallback(
    (val: TimerOption) => {
      setTimerSeconds(val);
      syncState({ timer: val });
    },
    [syncState]
  );

  const toggleCounter = useCallback(() => {
    setShowCounter((prev) => !prev);
    // Counter is local to remote — no sync needed
  }, []);

  const requestTVFullscreen = useCallback(() => {
    // Write a special flag the presentation can read
    // For now just sync display state to trigger a re-read
    syncState({});
  }, [syncState]);

  // =========================================================================
  // Scroll active game pill into view
  // =========================================================================

  useEffect(() => {
    if (!gameSwitcherRef.current) return;
    const activeBtn = gameSwitcherRef.current.querySelector(
      "[data-active='true']"
    );
    if (activeBtn) {
      activeBtn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [gameIndex]);

  // =========================================================================
  // Derived
  // =========================================================================

  const currentGame = allSlides[gameIndex];
  const totalPhotosInGame = currentGame?.photos.length ?? 0;
  const currentPhoto = currentGame?.photos[photoIndex];
  const answerText = currentPhoto?.answer_text;

  const isFirst =
    gameIndex === 0 && photoIndex === 0;
  const isLast =
    gameIndex === allSlides.length - 1 &&
    photoIndex === (allSlides[allSlides.length - 1]?.photos.length ?? 1) - 1;

  // =========================================================================
  // Render
  // =========================================================================

  if (loading) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#111]">
        <div className="text-white/60 text-lg">Loading remote...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#111] gap-4 px-6">
        <div className="text-white text-lg text-center">{error}</div>
        <button
          onClick={() => window.history.back()}
          className="rounded-lg bg-blue-600 px-6 py-2 text-white"
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col bg-[#111] text-white select-none overflow-hidden"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {/* ================================================================= */}
      {/* Connection banner */}
      {/* ================================================================= */}
      {connectionStatus === "disconnected" && (
        <div className="bg-red-600 text-white text-center text-xs py-1.5 font-medium">
          Disconnected — reconnecting...
        </div>
      )}

      {/* ================================================================= */}
      {/* 1. Now Showing — compact top bar */}
      {/* ================================================================= */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-b border-white/10">
        {/* Thumbnail */}
        <div className="flex-shrink-0 w-12 h-[27px] rounded bg-white/10 overflow-hidden">
          {currentPhoto ? (
            <Image
              src={currentPhoto.public_url}
              alt=""
              width={48}
              height={27}
              className="w-full h-full object-cover"
              unoptimized
            />
          ) : (
            <div className="w-full h-full" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {currentGame?.game.name ?? "—"}
            </span>
            {/* Connection dot */}
            <span
              className={`flex-shrink-0 w-2 h-2 rounded-full ${
                connectionStatus === "connected"
                  ? "bg-green-500"
                  : connectionStatus === "connecting"
                  ? "bg-yellow-500"
                  : "bg-red-500"
              }`}
            />
          </div>
          <div className="text-xs text-gray-400">
            Photo {photoIndex + 1} of {totalPhotosInGame}
            {answerText && (
              <span className="ml-2 text-gray-500 truncate">
                — {answerText}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 2. Main Controls — fills most of screen */}
      {/* ================================================================= */}
      <div className="flex-1 flex flex-col justify-center px-4 gap-4 min-h-0">
        {/* PREV / NEXT buttons */}
        <div className="flex gap-3">
          <button
            onClick={goPrev}
            disabled={isFirst}
            className="flex-1 flex items-center justify-center rounded-xl bg-white/10 text-white font-bold text-xl transition-all duration-150 active:scale-95 disabled:opacity-30 disabled:active:scale-100"
            style={{ minHeight: 120 }}
          >
            <svg
              className="w-8 h-8 mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            PREV
          </button>
          <button
            onClick={goNext}
            disabled={isLast}
            className="flex-1 flex items-center justify-center rounded-xl bg-white/10 text-white font-bold text-xl transition-all duration-150 active:scale-95 disabled:opacity-30 disabled:active:scale-100"
            style={{ minHeight: 120 }}
          >
            NEXT
            <svg
              className="w-8 h-8 ml-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>

        {/* Reveal Answer */}
        <button
          onClick={toggleAnswer}
          className={`w-full rounded-xl py-4 font-bold text-lg transition-all duration-150 active:scale-[0.98] ${
            showAnswer
              ? "bg-green-600 text-white"
              : "bg-white/10 text-white"
          }`}
          style={{ minHeight: 56 }}
        >
          {showAnswer ? (
            <span>
              HIDE ANSWER
              {answerText && (
                <span className="block text-sm font-normal mt-0.5 opacity-80">
                  {answerText}
                </span>
              )}
            </span>
          ) : (
            "REVEAL ANSWER"
          )}
        </button>
      </div>

      {/* ================================================================= */}
      {/* 3. Game Switcher + Settings — bottom */}
      {/* ================================================================= */}
      <div className="flex-shrink-0 border-t border-white/10">
        {/* Game pills — horizontal scroll */}
        <div
          ref={gameSwitcherRef}
          className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-hide"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {allSlides.map((slide, idx) => (
            <button
              key={slide.game.id}
              data-active={idx === gameIndex}
              onClick={() => jumpToGame(idx)}
              className={`flex-shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all duration-150 active:scale-95 ${
                idx === gameIndex
                  ? "bg-blue-600 text-white"
                  : "bg-white/10 text-gray-300"
              }`}
            >
              {slide.game.name}
              <span className="ml-1.5 text-xs opacity-60">
                {slide.photos.length}
              </span>
            </button>
          ))}
        </div>

        {/* Settings toggle */}
        <div className="px-4 pb-2">
          <button
            onClick={() => setSettingsOpen((p) => !p)}
            className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-500 py-1.5"
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                settingsOpen ? "rotate-180" : ""
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 15l7-7 7 7"
              />
            </svg>
            Settings
          </button>
        </div>

        {/* Collapsible settings */}
        {settingsOpen && (
          <div className="px-4 pb-4 space-y-4">
            {/* Timer segmented control */}
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">
                Auto-advance timer
              </label>
              <div className="flex rounded-lg overflow-hidden border border-white/10">
                {TIMER_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setTimer(opt)}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${
                      timerSeconds === opt
                        ? "bg-blue-600 text-white"
                        : "bg-white/5 text-gray-400"
                    }`}
                  >
                    {opt === 0 ? "Off" : `${opt}s`}
                  </button>
                ))}
              </div>
            </div>

            {/* Counter toggle */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Slide counter</span>
              <button
                onClick={toggleCounter}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  showCounter ? "bg-blue-600" : "bg-white/20"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    showCounter ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>

            {/* Black screen / Fullscreen TV */}
            <div className="flex gap-3">
              <button
                onClick={requestTVFullscreen}
                className="flex-1 rounded-lg bg-white/5 border border-white/10 py-2.5 text-sm text-gray-400 active:scale-95 transition-all"
              >
                Fullscreen TV
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
