"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase";
import { Session } from "@/lib/types";
import { GridSkeleton } from "@/components/LoadingSkeleton";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";

export default function Dashboard() {
  const [sessions, setSessions] = useState<(Session & { game_count: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialDismissed, setTutorialDismissed] = useState(false);
  const router = useRouter();
  const supabase = useMemo(() => createBrowserClient(), []);
  const { showToast } = useToast();
  const toastRef = useRef(showToast);
  toastRef.current = showToast;

  const fetchSessions = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data, error } = await supabase
        .from("sessions")
        .select("*, games(count)")
        .order("date", { ascending: false });

      if (error) {
        console.error("Supabase fetchSessions error:", error.message, error.code, error.details);
        throw error;
      }

      const mapped = (data || []).map((s) => ({
        ...s,
        game_count: (s.games as unknown as { count: number }[])?.[0]?.count ?? 0,
      }));
      setSessions(mapped);
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
      toastRef.current("Failed to load sessions", "error");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const createSession = async () => {
    setCreating(true);
    try {
      const today = new Date();
      const formatted = today.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const name = `Trivia Night — ${formatted}`;

      const { data, error } = await supabase
        .from("sessions")
        .insert({ name, date: today.toISOString().split("T")[0] })
        .select()
        .single();

      if (error) throw error;
      router.push(`/session/${data.id}`);
    } catch (err) {
      console.error("Failed to create session:", err);
      showToast("Failed to create session", "error");
    } finally {
      setCreating(false);
    }
  };

  const deleteSession = async () => {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase
        .from("sessions")
        .delete()
        .eq("id", deleteTarget);

      if (error) throw error;
      setSessions((prev) => prev.filter((s) => s.id !== deleteTarget));
      showToast("Session deleted");
    } catch (err) {
      console.error("Failed to delete session:", err);
      showToast("Failed to delete session", "error");
    } finally {
      setDeleteTarget(null);
    }
  };

  if (loading) {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Your Sessions</h1>
        </div>
        <GridSkeleton count={3} />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Your Sessions</h1>
        <button
          onClick={createSession}
          disabled={creating}
          className="rounded-lg bg-primary px-4 py-2 font-medium text-white hover:bg-primary-hover transition-colors disabled:opacity-50"
        >
          {creating ? "Creating..." : "New Session"}
        </button>
      </div>

      {/* Getting Started */}
      {!tutorialDismissed && (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 overflow-hidden">
          <button
            onClick={() => setShowTutorial((prev) => !prev)}
            className="w-full flex items-center justify-between px-5 py-3 text-left focus:outline-none focus:ring-2 focus:ring-primary rounded-xl"
          >
            <span className="text-sm font-semibold text-blue-900">
              Getting Started
            </span>
            <svg
              className={`w-4 h-4 text-blue-600 transition-transform duration-200 ${
                showTutorial ? "rotate-180" : ""
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {showTutorial && (
            <div className="px-5 pb-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {[
                  {
                    step: 1,
                    icon: "\ud83d\udcc5",
                    title: "Create a Session",
                    desc: "Start a new trivia night. Each session holds all your games/rounds for one event.",
                  },
                  {
                    step: 2,
                    icon: "\ud83d\uddbc\ufe0f",
                    title: "Add Games & Photos",
                    desc: "Add rounds, then upload photos via drag-and-drop or import a Google Drive folder. Set the answer for each photo.",
                  },
                  {
                    step: 3,
                    icon: "\ud83d\udcfa",
                    title: "Present on TV",
                    desc: "Open \u2018Present Session\u2019 on your TV or iPad. Full-screen slideshow with smooth crossfade transitions.",
                  },
                  {
                    step: 4,
                    icon: "\ud83d\udcf1",
                    title: "Control from Phone",
                    desc: "Open \u2018Remote Control\u2019 on your phone. Navigate slides, reveal answers, and switch games in real-time.",
                  },
                  {
                    step: 5,
                    icon: "\ud83d\udcf2",
                    title: "Install as App",
                    desc: "On your phone or iPad, tap Share \u2192 \u2018Add to Home Screen\u2019 for a full-screen app experience with no browser UI.",
                  },
                ].map((step) => (
                  <div
                    key={step.title}
                    className="rounded-lg bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold">
                        {step.step}
                      </span>
                      <span className="text-xl">{step.icon}</span>
                    </div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-1">
                      {step.title}
                    </h4>
                    <p className="text-xs text-gray-600 leading-relaxed">
                      {step.desc}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-blue-700">
                  <span className="font-medium">Presentation shortcuts:</span>{" "}
                  <span className="text-blue-600">
                    &larr; &rarr; navigate, R reveal, T timer, G game list, C
                    counter, F fullscreen
                  </span>
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setTutorialDismissed(true);
                  }}
                  className="text-xs text-blue-500 hover:text-blue-700 font-medium ml-4 whitespace-nowrap transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-gray-400 text-5xl mb-4">📋</div>
          <h2 className="text-lg font-semibold text-gray-700 mb-2">No sessions yet</h2>
          <p className="text-gray-500 mb-6">
            Create your first trivia night to get started.
          </p>
          <button
            onClick={createSession}
            disabled={creating}
            className="rounded-lg bg-primary px-6 py-2.5 font-medium text-white hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create Session"}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
            >
              <h3 className="font-semibold text-gray-900 truncate">{session.name}</h3>
              <p className="mt-1 text-sm text-gray-500">
                {new Date(session.date + "T00:00:00").toLocaleDateString("en-US", {
                  weekday: "short",
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </p>
              <p className="mt-2 text-sm text-gray-600">
                {session.game_count} {session.game_count === 1 ? "game" : "games"}
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => router.push(`/session/${session.id}`)}
                  className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover transition-colors"
                >
                  Open
                </button>
                <button
                  onClick={() => setDeleteTarget(session.id)}
                  className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-destructive hover:bg-red-50 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Session"
        message="Are you sure you want to delete this session? All games and photos within it will be permanently deleted."
        onConfirm={deleteSession}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
