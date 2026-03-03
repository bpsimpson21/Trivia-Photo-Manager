# Trivia Photo Manager

A web app for live trivia hosts to upload photo sets, organize them into games and rounds, and present them full-screen on a TV via iPad AirPlay. The host controls the slideshow from their phone while the audience sees clean, distraction-free photos on the big screen.

## Tech Stack

- **Next.js** with App Router and TypeScript
- **Supabase** — PostgreSQL database + Storage for images + Realtime subscriptions
- **Tailwind CSS** for styling
- **Vercel** for deployment

## Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) account (free tier works)
- (Optional) A Google API key for Google Drive import

## Setup

1. **Clone the repo**

   ```bash
   git clone <your-repo-url>
   cd trivia-photo-manager
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Create a Supabase project**

   Go to [supabase.com](https://supabase.com) and create a new project.

4. **Run the database schema**

   Open the SQL Editor in your Supabase dashboard and paste the contents of `supabase/schema.sql`. Run it.

5. **Create a storage bucket**

   In your Supabase dashboard, go to **Storage** and create a new bucket called `trivia-photos` with **public** access enabled.

6. **Configure environment variables**

   ```bash
   cp .env.local.example .env.local
   ```

   Edit `.env.local` and fill in your Supabase project URL and anon key (found in Project Settings > API).

7. **Google Drive Import (optional)**

   To enable importing photos from Google Drive folders:
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create a project and enable the **Google Drive API**
   - Create an API key (restrict it to the Drive API)
   - Add `GOOGLE_API_KEY=your_key` to `.env.local`
   - Folders must be shared with "Anyone with the link" access

8. **Start the dev server**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) in your browser.

   To access from your phone (for remote control):
   ```bash
   npm run dev -- -H 0.0.0.0
   ```
   Then open `http://<your-local-ip>:3000` on your phone.

## Deploy to Vercel

1. Push your code to a GitHub repository
2. Go to [vercel.com](https://vercel.com) and import the repository
3. Add the environment variables in the Vercel project settings:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `GOOGLE_API_KEY` (optional)
4. Deploy

## Architecture

```
Browser (TV/iPad)  ──── Presentation page ────┐
                                              │  Supabase Realtime
Browser (Phone)    ──── Remote Control ───────┤  (display_state table)
                                              │
                        Supabase DB ──────────┘
                        Supabase Storage (images)
```

- **Dashboard** → Create/manage trivia sessions
- **Session page** → Add/reorder games (rounds) within a session
- **Game editor** → Upload photos, set answers, reorder, import from Google Drive
- **Presentation** → Full-screen slideshow with crossfade transitions (runs on TV)
- **Remote Control** → Phone-optimized controller that syncs via Realtime

## Keyboard Shortcuts (Presentation Mode)

| Key | Action |
|-----|--------|
| `→` / `Space` | Next slide |
| `←` | Previous slide |
| `R` | Toggle answer reveal |
| `C` | Toggle slide counter |
| `T` | Cycle auto-advance timer (Off → 5s → 10s → 15s → 30s) |
| `G` | Toggle game list overlay |
| `F` | Toggle fullscreen |
| `Escape` | Exit (with confirmation) |

Touch: tap right 2/3 = next, left 1/3 = prev, swipe left/right for navigation.

## Folder Structure

```
src/
  app/
    layout.tsx                         # Root layout with nav header
    page.tsx                           # Dashboard — list all sessions
    api/
      import-drive/
        route.ts                       # Google Drive folder import API
    session/
      [id]/
        page.tsx                       # Session view — manage games
        game/
          [gameId]/
            page.tsx                   # Game editor — upload/manage photos
    present/
      [sessionId]/
        page.tsx                       # Full-screen presentation mode
    remote/
      [sessionId]/
        page.tsx                       # Mobile remote control
  components/
    ConfirmDialog.tsx                   # Reusable confirmation modal
    DragGrid.tsx                       # Drag-and-drop grid layout
    DragList.tsx                       # Drag-and-drop list layout
    InlineEdit.tsx                     # Click-to-edit text with debounce
    Lightbox.tsx                       # Full-screen image preview
    LoadingSkeleton.tsx                # Loading placeholder components
    Toast.tsx                          # Toast notification system
  lib/
    optimize-image.ts                  # Client-side image optimization
    supabase.ts                        # Supabase browser client (singleton)
    supabase-server.ts                 # Supabase server client
    types.ts                           # TypeScript type definitions
supabase/
  schema.sql                           # Database schema
```
