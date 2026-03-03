import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Server-side Supabase client (uses service role or anon key)
function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

/**
 * Extract a Google Drive folder ID from various URL formats:
 *  - https://drive.google.com/drive/folders/FOLDER_ID
 *  - https://drive.google.com/drive/folders/FOLDER_ID?usp=sharing
 *  - https://drive.google.com/drive/u/0/folders/FOLDER_ID
 *  - raw folder ID
 */
function parseFolderId(input: string): string | null {
  const trimmed = input.trim();

  // Direct ID (no slashes)
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/");
    const fIdx = parts.lastIndexOf("folders");
    if (fIdx >= 0 && parts[fIdx + 1]) return parts[fIdx + 1];
  } catch {
    // Not a URL — ignore
  }
  return null;
}

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { folderUrl, gameId, sessionId } = body as {
      folderUrl: string;
      gameId: string;
      sessionId: string;
    };

    if (!folderUrl || !gameId || !sessionId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Google API key not configured on the server" },
        { status: 500 }
      );
    }

    const folderId = parseFolderId(folderUrl);
    if (!folderId) {
      return NextResponse.json(
        { error: "Could not parse a valid folder ID from the URL" },
        { status: 400 }
      );
    }

    // ---- List files in folder via Google Drive API v3 ----
    const listUrl = new URL("https://www.googleapis.com/drive/v3/files");
    listUrl.searchParams.set(
      "q",
      `'${folderId}' in parents and trashed = false`
    );
    listUrl.searchParams.set("fields", "files(id,name,mimeType)");
    listUrl.searchParams.set("pageSize", "100");
    listUrl.searchParams.set("orderBy", "name");
    listUrl.searchParams.set("key", apiKey);

    const listRes = await fetch(listUrl.toString());
    if (!listRes.ok) {
      const errText = await listRes.text();
      console.error("Google Drive list error:", errText);
      return NextResponse.json(
        {
          error:
            "Failed to list Google Drive folder. Make sure the folder is publicly shared.",
        },
        { status: 400 }
      );
    }

    const listData = (await listRes.json()) as {
      files: { id: string; name: string; mimeType: string }[];
    };

    const imageFiles = (listData.files || []).filter((f) =>
      IMAGE_MIME_TYPES.has(f.mimeType)
    );

    if (imageFiles.length === 0) {
      return NextResponse.json(
        { error: "No image files found in the folder" },
        { status: 400 }
      );
    }

    // ---- Determine starting position ----
    const supabase = getSupabase();
    const { data: existingPhotos } = await supabase
      .from("photos")
      .select("id")
      .eq("game_id", gameId);

    let position = existingPhotos?.length ?? 0;

    // ---- Download & upload each image ----
    const results: { name: string; success: boolean; error?: string }[] = [];

    for (const file of imageFiles) {
      try {
        // Download via Drive API
        const dlUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${apiKey}`;
        const dlRes = await fetch(dlUrl);
        if (!dlRes.ok) {
          results.push({
            name: file.name,
            success: false,
            error: `Download failed (${dlRes.status})`,
          });
          continue;
        }

        const blob = await dlRes.blob();
        const buffer = Buffer.from(await blob.arrayBuffer());

        // Determine extension
        const ext =
          file.mimeType === "image/png"
            ? "png"
            : file.mimeType === "image/webp"
            ? "webp"
            : "jpg";

        const fileName = `${crypto.randomUUID()}.${ext}`;
        const storagePath = `${sessionId}/${gameId}/${fileName}`;

        // Upload to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from("trivia-photos")
          .upload(storagePath, buffer, {
            contentType: file.mimeType,
            cacheControl: "3600",
          });

        if (uploadError) {
          results.push({
            name: file.name,
            success: false,
            error: uploadError.message,
          });
          continue;
        }

        // Get public URL
        const { data: urlData } = supabase.storage
          .from("trivia-photos")
          .getPublicUrl(storagePath);

        // Insert photo row
        const { error: insertError } = await supabase.from("photos").insert({
          game_id: gameId,
          storage_path: storagePath,
          public_url: urlData.publicUrl,
          position,
        });

        if (insertError) {
          results.push({
            name: file.name,
            success: false,
            error: insertError.message,
          });
          continue;
        }

        position++;
        results.push({ name: file.name, success: true });
      } catch (err) {
        results.push({
          name: file.name,
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return NextResponse.json({
      imported: successCount,
      failed: failCount,
      total: imageFiles.length,
      results,
    });
  } catch (err) {
    console.error("Import Drive error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
