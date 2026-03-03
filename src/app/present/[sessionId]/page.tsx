"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
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
const TIMER_CYCLE: TimerOption[] = [0, 5, 10, 15, 30];

// ---------------------------------------------------------------------------
// Image preloader
// ---------------------------------------------------------------------------

const preloadCache = new Set<string>();

function preloadImages(urls: string[]) {
  for (const url of urls) {
    if (preloadCache.has(url)) continue;
    preloadCache.add(url);
    const img = new Image();
    img.src = url;
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PresentationPage() {
  const params = useParams();
  const sessionId = params.sessionId as string;
  const router = useRouter();
  const supabase = useMemo(() => createBrowserClient(), []);

  // --- data ---
  const [allSlides, setAllSlides] = useState<GameSlides[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- navigation state ---
  const [gameIndex, setGameIndex] = useState(0);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [showTitleCard, setShowTitleCard] = useState(false);
  const [showEndCard, setShowEndCard] = useState(false);
  const [titleText, setTitleText] = useState("");

  // --- overlays ---
  const [showAnswer, setShowAnswer] = useState(false);
  const [showCounter, setShowCounter] = useState(false);
  const [showGameList, setShowGameList] = useState(false);

  // --- auto-advance ---
  const [timerSeconds, setTimerSeconds] = useState<TimerOption>(0);
  const [timerProgress, setTimerProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- fullscreen ---
  const [hasStarted, setHasStarted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- crossfade (stack-and-swap) ---
  // "back" layer stays visible at opacity 1 the entire time.
  // "front" layer loads the next image at opacity 0, waits for onLoad,
  // then fades to opacity 1. Once the transition ends we promote it to
  // the back layer and clear the front.
  const [backSrc, setBackSrc] = useState<string | null>(null);
  const [frontSrc, setFrontSrc] = useState<string | null>(null);
  const [frontVisible, setFrontVisible] = useState(false);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- toast ---
  const [toast, setToast] = useState<string | null>(null);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- touch ---
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const lastTapTime = useRef(0);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- display state ---
  const displayStateId = useRef<string | null>(null);
  const isRemoteUpdate = useRef(false);

  // --- exit confirmation ---
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // =========================================================================
  // Toast helper
  // =========================================================================

  const flash = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setToast(null), 1500);
  }, []);

  // =========================================================================
  // Data loading
  // =========================================================================

  useEffect(() => {
    if (!supabase) return;

    async function load() {
      try {
        // Fetch games ordered by position
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

        // Fetch all photos for these games
        const gameIds = games.map((g: Game) => g.id);
        const { data: photos, error: pErr } = await supabase
          .from("photos")
          .select("*")
          .in("game_id", gameIds)
          .order("position", { ascending: true });

        if (pErr) throw pErr;

        // Build structure
        const slides: GameSlides[] = games.map((g: Game) => ({
          game: g,
          photos: (photos || []).filter((p: Photo) => p.game_id === g.id),
        }));

        setAllSlides(slides);

        // Preload first game's images
        if (slides[0]?.photos.length) {
          preloadImages(slides[0].photos.map((p) => p.public_url));
          setBackSrc(slides[0].photos[0].public_url);
        }

        // Preload second game too
        if (slides[1]?.photos.length) {
          preloadImages(slides[1].photos.map((p) => p.public_url));
        }

        setLoading(false);
      } catch (err) {
        console.error("Presentation load error:", err);
        setError("Failed to load presentation data.");
        setLoading(false);
      }
    }

    load();
  }, [supabase, sessionId]);

  // =========================================================================
  // Display state sync — upsert + subscribe
  // =========================================================================

  useEffect(() => {
    if (!supabase || allSlides.length === 0) return;

    async function initDisplayState() {
      const firstGame = allSlides[0]?.game;
      if (!firstGame) return;

      // Upsert
      const { data, error: uErr } = await supabase
        .from("display_state")
        .upsert(
          {
            session_id: sessionId,
            current_game_id: firstGame.id,
            current_photo_index: 0,
            show_answer: false,
            is_playing: false,
            timer_seconds: 0,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "session_id" }
        )
        .select()
        .single();

      if (!uErr && data) {
        displayStateId.current = data.id;
      }
    }

    initDisplayState();

    // Subscribe to realtime changes for remote control
    const channel = supabase
      .channel(`display_state_${sessionId}`)
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

          // Check if this is our own update (skip to avoid loops)
          isRemoteUpdate.current = true;

          // Find game index
          const gIdx = allSlides.findIndex(
            (s) => s.game.id === ns.current_game_id
          );
          if (gIdx >= 0) {
            setGameIndex(gIdx);
            setPhotoIndex(ns.current_photo_index as number);
            setShowAnswer(ns.show_answer as boolean);
          }

          setTimeout(() => {
            isRemoteUpdate.current = false;
          }, 100);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, sessionId, allSlides]);

  // Write display state on navigation changes
  const syncDisplayState = useCallback(
    (gIdx: number, pIdx: number, answer: boolean) => {
      if (!supabase || isRemoteUpdate.current || allSlides.length === 0) return;
      const game = allSlides[gIdx]?.game;
      if (!game) return;

      supabase
        .from("display_state")
        .update({
          current_game_id: game.id,
          current_photo_index: pIdx,
          show_answer: answer,
          updated_at: new Date().toISOString(),
        })
        .eq("session_id", sessionId)
        .then(() => {});
    },
    [supabase, sessionId, allSlides]
  );

  // =========================================================================
  // Crossfade logic  (stack-and-swap — no black flash)
  // =========================================================================

  const applyPhoto = useCallback(
    (gIdx: number, pIdx: number) => {
      const photo = allSlides[gIdx]?.photos[pIdx];
      if (!photo) return;
      const url = photo.public_url;

      // Already showing this image — nothing to do
      if (backSrc === url && !frontSrc) return;

      // Cancel any in-progress fade
      if (fadeTimer.current) {
        clearTimeout(fadeTimer.current);
        fadeTimer.current = null;
      }

      // If this is the very first image (nothing on back yet), set it directly
      if (!backSrc) {
        setBackSrc(url);
        return;
      }

      // Stage the new image on the front layer (invisible). The <img>
      // onLoad handler below will trigger the actual fade-in.
      setFrontVisible(false);
      setFrontSrc(url);
    },
    [allSlides, backSrc, frontSrc]
  );

  /** Called by the front <img> when it has decoded / loaded */
  const onFrontLoaded = useCallback(() => {
    // Kick off the opacity transition
    requestAnimationFrame(() => setFrontVisible(true));

    // After the CSS transition finishes, promote front → back
    fadeTimer.current = setTimeout(() => {
      setBackSrc(frontSrc);
      setFrontSrc(null);
      setFrontVisible(false);
      fadeTimer.current = null;
    }, 320); // slightly longer than 300ms transition to be safe
  }, [frontSrc]);

  // Apply photo whenever navigation state changes (but not from title/end cards)
  useEffect(() => {
    if (!showTitleCard && !showEndCard && allSlides.length > 0) {
      applyPhoto(gameIndex, photoIndex);
    }
  }, [gameIndex, photoIndex, showTitleCard, showEndCard]); // eslint-disable-line react-hooks/exhaustive-deps

  // =========================================================================
  // Navigation
  // =========================================================================

  const goNext = useCallback(() => {
    if (showExitConfirm || showGameList) return;

    // If on title card, advance to first photo of that game
    if (showTitleCard) {
      setShowTitleCard(false);
      return;
    }

    // If showing end card, do nothing
    if (showEndCard) return;

    setShowAnswer(false);

    const currentGame = allSlides[gameIndex];
    if (!currentGame) return;

    if (photoIndex < currentGame.photos.length - 1) {
      // Next photo in current game
      const newPI = photoIndex + 1;
      setPhotoIndex(newPI);
      syncDisplayState(gameIndex, newPI, false);
    } else if (gameIndex < allSlides.length - 1) {
      // End of game -> show title card for next game
      const newGI = gameIndex + 1;

      // Preload the next+1 game
      if (newGI + 1 < allSlides.length) {
        preloadImages(allSlides[newGI + 1].photos.map((p) => p.public_url));
      }

      setTitleText(allSlides[newGI].game.name);
      setShowTitleCard(true);
      setGameIndex(newGI);
      setPhotoIndex(0);
      syncDisplayState(newGI, 0, false);

      // Auto-advance past title card
      setTimeout(() => {
        setShowTitleCard(false);
      }, 2500);
    } else {
      // Last photo of last game
      setShowEndCard(true);
    }
  }, [
    gameIndex,
    photoIndex,
    allSlides,
    showTitleCard,
    showEndCard,
    showExitConfirm,
    showGameList,
    syncDisplayState,
  ]);

  const goPrev = useCallback(() => {
    if (showExitConfirm || showGameList) return;

    if (showEndCard) {
      setShowEndCard(false);
      return;
    }

    if (showTitleCard) {
      setShowTitleCard(false);
      // Go back to last photo of previous game
      if (gameIndex > 0) {
        const prevGI = gameIndex - 1;
        const prevPI = allSlides[prevGI].photos.length - 1;
        setGameIndex(prevGI);
        setPhotoIndex(Math.max(0, prevPI));
        syncDisplayState(prevGI, Math.max(0, prevPI), false);
      }
      return;
    }

    setShowAnswer(false);

    if (photoIndex > 0) {
      const newPI = photoIndex - 1;
      setPhotoIndex(newPI);
      syncDisplayState(gameIndex, newPI, false);
    } else if (gameIndex > 0) {
      const prevGI = gameIndex - 1;
      const prevPI = allSlides[prevGI].photos.length - 1;
      setGameIndex(prevGI);
      setPhotoIndex(Math.max(0, prevPI));
      syncDisplayState(prevGI, Math.max(0, prevPI), false);
    }
  }, [
    gameIndex,
    photoIndex,
    allSlides,
    showTitleCard,
    showEndCard,
    showExitConfirm,
    showGameList,
    syncDisplayState,
  ]);

  const jumpToGame = useCallback(
    (gIdx: number) => {
      setShowGameList(false);
      setShowTitleCard(false);
      setShowEndCard(false);
      setShowAnswer(false);
      setGameIndex(gIdx);
      setPhotoIndex(0);
      syncDisplayState(gIdx, 0, false);

      // Preload this game + next
      preloadImages(allSlides[gIdx].photos.map((p) => p.public_url));
      if (gIdx + 1 < allSlides.length) {
        preloadImages(allSlides[gIdx + 1].photos.map((p) => p.public_url));
      }
    },
    [allSlides, syncDisplayState]
  );

  // =========================================================================
  // Auto-advance timer
  // =========================================================================

  // Track remaining seconds for countdown display
  const [timerRemaining, setTimerRemaining] = useState(0);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setTimerProgress(0);
    setTimerRemaining(timerSeconds);

    if (timerSeconds === 0 || showTitleCard || showEndCard || showAnswer) return;

    const interval = 50; // ms
    const totalTicks = (timerSeconds * 1000) / interval;
    let ticks = 0;

    timerRef.current = setInterval(() => {
      ticks++;
      setTimerProgress(ticks / totalTicks);
      setTimerRemaining(Math.ceil(((totalTicks - ticks) * interval) / 1000));
      if (ticks >= totalTicks) {
        setTimerProgress(0);
        ticks = 0;
        goNext();
      }
    }, interval);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timerSeconds, gameIndex, photoIndex, showTitleCard, showEndCard, showAnswer, goNext]);

  // =========================================================================
  // Fullscreen
  // =========================================================================

  const requestFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rfs =
      el.requestFullscreen ||
      (el as HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> })
        .webkitRequestFullscreen;
    if (rfs) rfs.call(el);
  }, []);

  const exitFullscreen = useCallback(() => {
    const efs =
      document.exitFullscreen ||
      (document as Document & { webkitExitFullscreen?: () => Promise<void> })
        .webkitExitFullscreen;
    if (efs && document.fullscreenElement) efs.call(document);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (
      document.fullscreenElement ||
      (document as Document & { webkitFullscreenElement?: Element })
        .webkitFullscreenElement
    ) {
      exitFullscreen();
    } else {
      requestFullscreen();
    }
  }, [requestFullscreen, exitFullscreen]);

  const handleStart = useCallback(() => {
    setHasStarted(true);
    requestFullscreen();
  }, [requestFullscreen]);

  // =========================================================================
  // Keyboard
  // =========================================================================

  useEffect(() => {
    if (!hasStarted) return;

    function handleKey(e: KeyboardEvent) {
      // If exit confirm is showing, handle only Escape and Enter
      if (showExitConfirm) {
        if (e.key === "Escape" || e.key === "n" || e.key === "N") {
          setShowExitConfirm(false);
        } else if (e.key === "Enter" || e.key === "y" || e.key === "Y") {
          exitFullscreen();
          router.back();
        }
        return;
      }

      switch (e.key) {
        case "ArrowRight":
        case " ":
          e.preventDefault();
          goNext();
          break;
        case "ArrowLeft":
          e.preventDefault();
          goPrev();
          break;
        case "r":
        case "R":
          setShowAnswer((prev) => {
            const next = !prev;
            syncDisplayState(gameIndex, photoIndex, next);
            return next;
          });
          break;
        case "c":
        case "C":
          setShowCounter((prev) => !prev);
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "t":
        case "T": {
          setTimerSeconds((prev) => {
            const idx = TIMER_CYCLE.indexOf(prev);
            const next = TIMER_CYCLE[(idx + 1) % TIMER_CYCLE.length];
            flash(next === 0 ? "Auto: Off" : `Auto: ${next}s`);
            return next;
          });
          break;
        }
        case "g":
        case "G":
          setShowGameList((prev) => !prev);
          break;
        case "Escape":
          if (showGameList) {
            setShowGameList(false);
          } else {
            setShowExitConfirm(true);
          }
          break;
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    hasStarted,
    goNext,
    goPrev,
    toggleFullscreen,
    showExitConfirm,
    showGameList,
    gameIndex,
    photoIndex,
    syncDisplayState,
    exitFullscreen,
    router,
    flash,
  ]);

  // =========================================================================
  // Touch handlers
  // =========================================================================

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    // Prevent Safari bounce
    e.preventDefault();
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (showExitConfirm || showGameList || !hasStarted) return;

      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const dx = endX - touchStartX.current;
      const dy = endY - touchStartY.current;

      // Swipe detection (threshold 50px, must be more horizontal than vertical)
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        if (singleTapTimer.current) {
          clearTimeout(singleTapTimer.current);
          singleTapTimer.current = null;
        }
        if (dx < 0) goNext();
        else goPrev();
        return;
      }

      // Double-tap detection: toggle answer reveal
      const now = Date.now();
      const timeSinceLast = now - lastTapTime.current;
      lastTapTime.current = now;

      if (timeSinceLast < 300) {
        // Double-tap detected — cancel pending single-tap and toggle answer
        if (singleTapTimer.current) {
          clearTimeout(singleTapTimer.current);
          singleTapTimer.current = null;
        }
        setShowAnswer((prev) => {
          const next = !prev;
          syncDisplayState(gameIndex, photoIndex, next);
          return next;
        });
        return;
      }

      // Delay single-tap to distinguish from double-tap
      singleTapTimer.current = setTimeout(() => {
        singleTapTimer.current = null;
        const width = window.innerWidth;
        if (endX > width / 3) {
          goNext();
        } else {
          goPrev();
        }
      }, 300);
    },
    [goNext, goPrev, showExitConfirm, showGameList, hasStarted, gameIndex, photoIndex, syncDisplayState]
  );

  // =========================================================================
  // Derived values
  // =========================================================================

  const currentGame = allSlides[gameIndex];
  const totalPhotosInGame = currentGame?.photos.length ?? 0;
  const currentPhoto = currentGame?.photos[photoIndex];
  const answerText = currentPhoto?.answer_text;

  // Global photo count
  const globalPhotoIndex = useMemo(() => {
    let count = 0;
    for (let i = 0; i < gameIndex; i++) {
      count += allSlides[i]?.photos.length ?? 0;
    }
    return count + photoIndex + 1;
  }, [gameIndex, photoIndex, allSlides]);

  const totalPhotos = useMemo(
    () => allSlides.reduce((sum, s) => sum + s.photos.length, 0),
    [allSlides]
  );

  // =========================================================================
  // Render
  // =========================================================================

  // Loading state
  if (loading) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black">
        <div className="text-white text-lg opacity-60">Loading presentation...</div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black gap-4">
        <div className="text-white text-lg">{error}</div>
        <button
          onClick={() => router.back()}
          className="rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
        >
          Go Back
        </button>
      </div>
    );
  }

  // Splash screen
  if (!hasStarted) {
    return (
      <div
        className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black cursor-pointer select-none"
        onClick={handleStart}
        onTouchStart={handleStart}
      >
        <div className="text-white text-2xl font-light mb-2 opacity-90">
          Tap anywhere to begin
        </div>
        <div className="text-white/40 text-sm">
          Presentation will enter fullscreen
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9999] bg-black select-none overflow-hidden"
      style={{ touchAction: "none" }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* ---- Auto-advance progress bar + countdown ---- */}
      {timerSeconds > 0 && !showTitleCard && !showEndCard && (
        <>
          <div className="absolute top-0 left-0 right-0 h-1 z-30 bg-white/10">
            <div
              className="h-full bg-blue-500 transition-none"
              style={{ width: `${(1 - timerProgress) * 100}%` }}
            />
          </div>
          {!showAnswer && timerRemaining > 0 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
              <div className="rounded-full bg-black/50 backdrop-blur-sm px-4 py-1.5 min-w-[3rem] text-center">
                <span className="text-white text-lg font-mono font-bold tabular-nums">
                  {timerRemaining}
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {/* ---- Photo display with stack-and-swap crossfade ---- */}
      {!showTitleCard && !showEndCard && (
        <>
          {/* Back layer — always opacity 1, never fades out */}
          {backSrc && (
            <img
              key={backSrc}
              src={backSrc}
              alt=""
              className="absolute inset-0 w-full h-full object-contain"
              style={{ opacity: 1 }}
              draggable={false}
            />
          )}
          {/* Front layer — loads at opacity 0, fades to 1 on load, then gets promoted */}
          {frontSrc && (
            <img
              key={frontSrc}
              src={frontSrc}
              alt=""
              className="absolute inset-0 w-full h-full object-contain transition-opacity duration-300"
              style={{ opacity: frontVisible ? 1 : 0 }}
              onLoad={onFrontLoaded}
              draggable={false}
            />
          )}
        </>
      )}

      {/* ---- Game title card ---- */}
      {showTitleCard && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <h1
            className="text-white font-bold text-center px-8"
            style={{ fontSize: "clamp(2rem, 6vw, 5rem)" }}
          >
            {titleText}
          </h1>
        </div>
      )}

      {/* ---- End of session card ---- */}
      {showEndCard && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 gap-4">
          <h1
            className="text-white font-bold text-center px-8"
            style={{ fontSize: "clamp(2rem, 6vw, 5rem)" }}
          >
            End of Session
          </h1>
          <p className="text-white/50 text-lg">
            Press Escape to exit
          </p>
        </div>
      )}

      {/* ---- Answer overlay ---- */}
      {showAnswer && answerText && !showTitleCard && !showEndCard && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/75">
          <p
            className="text-white font-bold text-center px-8 drop-shadow-lg"
            style={{
              fontSize: "clamp(1.5rem, 4vw, 4rem)",
              textShadow: "0 2px 8px rgba(0,0,0,0.6)",
            }}
          >
            {answerText}
          </p>
        </div>
      )}

      {/* ---- Slide counter ---- */}
      {showCounter && !showTitleCard && !showEndCard && (
        <div className="absolute bottom-4 right-4 z-20 text-right transition-opacity duration-200">
          <div className="text-white/50 text-xs mb-0.5">
            {currentGame?.game.name}
          </div>
          <div className="text-white/60 text-sm font-mono">
            {photoIndex + 1} / {totalPhotosInGame}
          </div>
          <div className="text-white/30 text-xs font-mono">
            {globalPhotoIndex} / {totalPhotos} total
          </div>
        </div>
      )}

      {/* ---- Game list overlay ---- */}
      {showGameList && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/85">
          <div className="w-full max-w-md max-h-[80vh] overflow-y-auto p-6">
            <h2 className="text-white text-xl font-bold mb-4">Games</h2>
            <div className="flex flex-col gap-2">
              {allSlides.map((slide, idx) => (
                <button
                  key={slide.game.id}
                  onClick={() => jumpToGame(idx)}
                  className={`text-left rounded-lg px-4 py-3 transition-colors ${
                    idx === gameIndex
                      ? "bg-blue-600 text-white"
                      : "bg-white/10 text-white/80 hover:bg-white/20"
                  }`}
                >
                  <div className="font-medium">{slide.game.name}</div>
                  <div className="text-sm opacity-60">
                    {slide.photos.length}{" "}
                    {slide.photos.length === 1 ? "photo" : "photos"}
                  </div>
                </button>
              ))}
            </div>
            <p className="text-white/30 text-xs mt-4 text-center">
              Press G to close
            </p>
          </div>
        </div>
      )}

      {/* ---- Exit confirmation ---- */}
      {showExitConfirm && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/85">
          <div className="text-center">
            <h2 className="text-white text-xl font-bold mb-2">
              Exit presentation?
            </h2>
            <p className="text-white/60 mb-6">
              Press <span className="font-mono">Y</span> or{" "}
              <span className="font-mono">Enter</span> to exit,{" "}
              <span className="font-mono">Escape</span> or{" "}
              <span className="font-mono">N</span> to stay
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setShowExitConfirm(false)}
                className="rounded-lg bg-white/10 px-6 py-2 text-white hover:bg-white/20 transition-colors"
              >
                Stay
              </button>
              <button
                onClick={() => {
                  exitFullscreen();
                  router.back();
                }}
                className="rounded-lg bg-red-600 px-6 py-2 text-white hover:bg-red-700 transition-colors"
              >
                Exit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Toast ---- */}
      {toast && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 rounded-lg bg-white/15 px-4 py-2 text-white text-sm font-medium backdrop-blur-sm transition-opacity duration-200">
          {toast}
        </div>
      )}
    </div>
  );
}
