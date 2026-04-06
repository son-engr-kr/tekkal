import { useRef, useEffect, useState } from "react";
import type { VideoElement as VideoElementType, VideoStyle } from "@/types/deck";
import { useElementStyle } from "@/contexts/ThemeContext";
import { useAssetUrl } from "@/contexts/AdapterContext";
import { useDeckStore } from "@/stores/deckStore";
import { parseVideoUrl } from "@/utils/videoParser";

// ── First-frame cache ──
// Captures the first frame of local videos as blob URLs for thumbnails.
const frameCache = new Map<string, string>();
const framePending = new Set<string>();

function captureFirstFrame(src: string): Promise<string> {
  const cached = frameCache.get(src);
  if (cached) return Promise.resolve(cached);
  if (framePending.has(src)) return Promise.resolve("");

  framePending.add(src);
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "metadata";
    video.src = src;

    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
      framePending.delete(src);
    };

    video.addEventListener("loadeddata", () => {
      // Seek to a tiny offset to ensure a frame is available
      video.currentTime = 0.1;
    }, { once: true });

    video.addEventListener("seeked", () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 180;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (blob) {
              const url = URL.createObjectURL(blob);
              frameCache.set(src, url);
              resolve(url);
            } else {
              resolve("");
            }
            cleanup();
          }, "image/jpeg", 0.7);
          return;
        }
      } catch { /* CORS or tainted canvas */ }
      resolve("");
      cleanup();
    }, { once: true });

    video.addEventListener("error", () => {
      resolve("");
      cleanup();
    }, { once: true });
  });
}

function useFirstFrame(src: string | undefined): string | undefined {
  const [frame, setFrame] = useState<string | undefined>(() => src ? frameCache.get(src) : undefined);

  useEffect(() => {
    if (!src) return;
    const cached = frameCache.get(src);
    if (cached) { setFrame(cached); return; }
    captureFirstFrame(src).then((url) => { if (url) setFrame(url); });
  }, [src]);

  return frame;
}

interface Props {
  element: VideoElementType;
  thumbnail?: boolean;
  videoStep?: number;
  /** When true, suppress autoplay — video stays paused until user clicks */
  editorMode?: boolean;
}

export function VideoElementRenderer({ element, thumbnail, videoStep, editorMode }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Cleanup: pause and release video resources on unmount to stop decoding
  useEffect(() => {
    return () => {
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || videoStep === undefined) return;

    if (videoStep >= 1) {
      const tryPlay = () => { video.play().catch(() => {}); };
      tryPlay();
      // Retry when video becomes playable (handles race with src loading)
      video.addEventListener("canplay", tryPlay, { once: true });
      return () => video.removeEventListener("canplay", tryPlay);
    } else {
      video.pause();
      video.currentTime = element.trimStart ?? 0;
    }
  }, [videoStep, element.trimStart]);

  // Fallback: ensure autoplay videos start playing
  // (browser may not honor autoPlay attribute in pop-out windows)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || videoStep !== undefined || editorMode) return;
    if (element.autoplay === false) return;

    const tryPlay = () => { if (video.paused) video.play().catch(() => {}); };
    video.addEventListener("canplay", tryPlay, { once: true });
    if (video.readyState >= 3) tryPlay();
    return () => video.removeEventListener("canplay", tryPlay);
  }, [videoStep, editorMode, element.autoplay]);

  // Enforce trim boundaries during playback
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const trimStart = element.trimStart;
    const trimEnd = element.trimEnd;
    if (trimStart === undefined && trimEnd === undefined) return;

    const onLoaded = () => {
      if (trimStart !== undefined && video.currentTime < trimStart) {
        video.currentTime = trimStart;
      }
    };

    const onTimeUpdate = () => {
      const end = trimEnd ?? video.duration;
      const start = trimStart ?? 0;
      if (video.currentTime >= end) {
        if (element.loop) {
          video.currentTime = start;
        } else {
          video.pause();
          video.currentTime = end;
        }
      }
    };

    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("timeupdate", onTimeUpdate);

    // Apply immediately if metadata already loaded
    if (video.readyState >= 1) onLoaded();

    return () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [element.trimStart, element.trimEnd, element.loop]);

  const style = useElementStyle<VideoStyle>("video", element.style);
  const resolvedSrc = useAssetUrl(element.src);

  const isCropping = useDeckStore((s) => s.cropElementId === element.id);

  const { w, h } = element.size;
  const crop = style.crop;
  const hasCrop = !isCropping && crop && (crop.top || crop.right || crop.bottom || crop.left);

  const clipPath = hasCrop
    ? `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)`
    : undefined;

  const commonStyle: React.CSSProperties = {
    width: w,
    height: h,
    objectFit: (style.objectFit ?? "contain") as React.CSSProperties["objectFit"],
    borderRadius: style.borderRadius ?? 0,
    clipPath,
    willChange: "transform",
  };

  // Wait for asset resolution to avoid 404s from relative paths in deployed environments
  const effectiveSrc = resolvedSrc ?? (element.src?.startsWith("./") ? undefined : element.src);
  const { type, embedUrl } = parseVideoUrl(effectiveSrc || "");
  const hasSrc = !!effectiveSrc;
  const isLocal = type === "native";
  const firstFrame = useFirstFrame(thumbnail && isLocal ? embedUrl : undefined);

  // Thumbnail mode: show cached first frame or play icon placeholder
  if (thumbnail) {
    if (firstFrame) {
      return (
        <img
          src={firstFrame}
          alt=""
          style={{ ...commonStyle, objectFit: commonStyle.objectFit ?? "cover", backgroundColor: "#18181b" }}
        />
      );
    }
    return (
      <div
        style={{ ...commonStyle, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#18181b" }}
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="2">
          <polygon points="5,3 19,12 5,21" />
        </svg>
      </div>
    );
  }

  if (type === "youtube" || type === "vimeo") {
    const params = new URLSearchParams();
    if (element.autoplay) params.set("autoplay", "1");
    if (element.loop) params.set("loop", "1");
    if (element.muted) params.set("mute", "1");
    const paramStr = params.toString();
    const url = paramStr ? `${embedUrl}?${paramStr}` : embedUrl;

    return (
      <div
        style={{ ...commonStyle, position: "relative" }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <iframe
          src={url}
          style={{ width: "100%", height: "100%", border: "none", borderRadius: commonStyle.borderRadius }}
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
        />
      </div>
    );
  }

  const hasPlayVideoEffect = videoStep !== undefined;
  const shouldAutoPlay = editorMode ? false : (hasPlayVideoEffect ? false : (element.autoplay ?? true));

  // Broadcast play/pause/seek for pop-out sync (listened by PresentationMode)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || editorMode) return;
    const emit = (action: "play" | "pause") => {
      window.dispatchEvent(new CustomEvent("deckode:video-control", {
        detail: { elementId: element.id, action, currentTime: video.currentTime },
      }));
    };
    const onPlay = () => emit("play");
    const onPause = () => emit("pause");
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [element.id, editorMode]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  // Editor with crop: clip-path for visual crop, no native controls (they'd be clipped).
  // Play/pause is provided by VideoPlayButton in SelectionOverlay.
  if (editorMode && hasCrop) {
    return (
      <video
        ref={videoRef}
        src={hasSrc ? embedUrl : undefined}
        autoPlay={false}
        loop={element.loop ?? true}
        muted={element.muted ?? true}
        preload="metadata"
        style={commonStyle}

      />
    );
  }

  // Crop + controls: render custom controls bar outside clip-path (like editor)
  if (hasCrop && !editorMode && element.controls) {
    return (
      <div className="group/video" style={{ position: "relative", width: w, height: h }}>
        <video
          ref={videoRef}
          src={hasSrc ? embedUrl : undefined}
          autoPlay={shouldAutoPlay}
          loop={element.loop ?? true}
          muted={element.muted ?? true}
          preload="auto"
          style={{ ...commonStyle, cursor: "pointer" }}
          onClick={handleClick}
        />
        <CropVideoControls
          videoRef={videoRef}
          crop={crop}
          trimStart={element.trimStart}
          trimEnd={element.trimEnd}
        />
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      src={hasSrc ? embedUrl : undefined}
      autoPlay={shouldAutoPlay}
      loop={element.loop ?? true}
      muted={element.muted ?? true}
      controls={!editorMode && !hasCrop && element.controls}
      preload={editorMode ? "metadata" : "auto"}
      style={{ ...commonStyle, cursor: "pointer" }}
      onClick={handleClick}
    />
  );
}

// ── Custom controls for cropped videos (rendered outside clip-path) ──

function CropVideoControls({
  videoRef,
  crop,
  trimStart: trimStartProp,
  trimEnd: trimEndProp,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  crop: { top: number; right: number; bottom: number; left: number };
  trimStart?: number;
  trimEnd?: number;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const progressRef = useRef<HTMLDivElement>(null);

  const trimStart = trimStartProp ?? 0;

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTime = () => setCurrentTime(vid.currentTime);
    const onDur = () => setDuration(vid.duration || 0);

    vid.addEventListener("play", onPlay);
    vid.addEventListener("pause", onPause);
    vid.addEventListener("timeupdate", onTime);
    vid.addEventListener("loadedmetadata", onDur);
    vid.addEventListener("durationchange", onDur);

    setIsPlaying(!vid.paused);
    setCurrentTime(vid.currentTime);
    if (vid.duration) setDuration(vid.duration);

    return () => {
      vid.removeEventListener("play", onPlay);
      vid.removeEventListener("pause", onPause);
      vid.removeEventListener("timeupdate", onTime);
      vid.removeEventListener("loadedmetadata", onDur);
      vid.removeEventListener("durationchange", onDur);
    };
  }, [videoRef]);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) vid.play().catch(() => {});
    else vid.pause();
  };

  const effectiveTrimEnd = trimEndProp ?? duration;

  const handleSeekDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    const bar = progressRef.current;
    const vid = videoRef.current;
    if (!bar || !vid || !duration) return;

    const seek = (clientX: number) => {
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const time = ratio * duration;
      vid.currentTime = Math.max(trimStart, Math.min(effectiveTrimEnd, time));
    };
    seek(e.clientX);

    const onMove = (me: MouseEvent) => seek(me.clientX);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const fmt = (s: number) => {
    if (!isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    return `${m}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
  };

  const hasTrim = trimStartProp !== undefined || trimEndProp !== undefined;
  const trimStartPct = duration > 0 ? trimStart / duration : 0;
  const trimEndPct = duration > 0 ? effectiveTrimEnd / duration : 1;
  const pct = duration > 0 ? currentTime / duration : 0;
  const barH = 28;

  return (
    <div
      className="opacity-0 group-hover/video:opacity-100 transition-opacity duration-200"
      style={{
        position: "absolute",
        left: `${(crop.left) * 100}%`,
        bottom: `${(crop.bottom) * 100}%`,
        width: `${(1 - crop.left - crop.right) * 100}%`,
        height: barH,
        backgroundColor: "rgba(0,0,0,0.65)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 8px",
        pointerEvents: "auto",
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={togglePlay}
        style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex" }}
      >
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
            <polygon points="8,5 19,12 8,19" />
          </svg>
        )}
      </button>
      <div
        ref={progressRef}
        onMouseDown={handleSeekDown}
        style={{ flex: 1, height: 4, backgroundColor: "rgba(255,255,255,0.25)", borderRadius: 2, cursor: "pointer", position: "relative" }}
      >
        {hasTrim && trimStartPct > 0 && (
          <div style={{ position: "absolute", left: 0, top: 0, width: `${trimStartPct * 100}%`, height: "100%", backgroundColor: "rgba(0,0,0,0.5)", borderRadius: "2px 0 0 2px" }} />
        )}
        {hasTrim && trimEndPct < 1 && (
          <div style={{ position: "absolute", right: 0, top: 0, width: `${(1 - trimEndPct) * 100}%`, height: "100%", backgroundColor: "rgba(0,0,0,0.5)", borderRadius: "0 2px 2px 0" }} />
        )}
        <div style={{ width: `${pct * 100}%`, height: "100%", backgroundColor: "#3b82f6", borderRadius: 2 }} />
      </div>
      <span style={{ color: "rgba(255,255,255,0.8)", fontSize: 10, fontFamily: "monospace", whiteSpace: "nowrap" }}>
        {fmt(currentTime)}/{fmt(duration)}
      </span>
    </div>
  );
}
