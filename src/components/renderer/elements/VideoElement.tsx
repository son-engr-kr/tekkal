import { useRef, useEffect, useState, useCallback } from "react";
import type { VideoElement as VideoElementType, VideoStyle, CropRect } from "@/types/deck";
import { useElementStyle } from "@/contexts/ThemeContext";
import { useAssetUrl } from "@/contexts/AdapterContext";
import { parseVideoUrl } from "@/utils/videoParser";

interface Props {
  element: VideoElementType;
  thumbnail?: boolean;
  videoStep?: number;
  /** When true, suppress autoplay — video stays paused until user clicks */
  editorMode?: boolean;
}

export function VideoElementRenderer({ element, thumbnail, videoStep, editorMode }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || videoStep === undefined) return;

    if (videoStep >= 1) {
      video.play().catch(() => {});
    } else {
      video.pause();
      video.currentTime = 0;
    }
  }, [videoStep]);
  const style = useElementStyle<VideoStyle>("video", element.style);
  const resolvedSrc = useAssetUrl(element.src);

  const crop = style.crop;
  const clipPath = crop
    ? `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)`
    : undefined;

  const commonStyle: React.CSSProperties = {
    width: element.size.w,
    height: element.size.h,
    objectFit: (style.objectFit ?? "contain") as React.CSSProperties["objectFit"],
    borderRadius: style.borderRadius ?? 0,
    clipPath,
  };

  // Thumbnail mode: static placeholder, no video loading
  if (thumbnail) {
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

  const { type, embedUrl } = parseVideoUrl(resolvedSrc ?? element.src);

  if (type === "youtube" || type === "vimeo") {
    // Editor mode: show static placeholder instead of loading iframe
    if (editorMode) {
      return (
        <div
          style={{ ...commonStyle, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#18181b", flexDirection: "column", gap: 8 }}
        >
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="1.5">
            <polygon points="5,3 19,12 5,21" />
          </svg>
          <span style={{ color: "#71717a", fontSize: 11 }}>{type === "youtube" ? "YouTube" : "Vimeo"}</span>
        </div>
      );
    }

    const params = new URLSearchParams();
    if (element.autoplay) params.set("autoplay", "1");
    if (element.loop) params.set("loop", "1");
    if (element.muted) params.set("mute", "1");
    const paramStr = params.toString();
    const url = paramStr ? `${embedUrl}?${paramStr}` : embedUrl;

    return (
      <iframe
        src={url}
        style={{ ...commonStyle, border: "none" }}
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
      />
    );
  }

  const hasPlayVideoEffect = videoStep !== undefined;
  // Editor mode: never autoplay; presentation: respect element setting
  const shouldAutoPlay = editorMode ? false : (hasPlayVideoEffect ? false : (element.autoplay ?? true));
  // Editor mode with crop: use custom controls instead of native (native controls get clipped)
  const useNativeControls = editorMode ? !crop : element.controls;

  const handleClick = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  // No crop or not editor mode: render plain video
  if (!editorMode || !crop) {
    return (
      <video
        ref={videoRef}
        src={embedUrl}
        autoPlay={shouldAutoPlay}
        loop={element.loop ?? true}
        muted={element.muted ?? true}
        controls={useNativeControls}
        preload={editorMode ? "metadata" : undefined}
        style={{ ...commonStyle, cursor: "pointer" }}
        onClick={handleClick}
      />
    );
  }

  // Editor mode with crop: video + custom controls overlay
  return (
    <div style={{ position: "relative", width: element.size.w, height: element.size.h }}>
      <video
        ref={videoRef}
        src={embedUrl}
        autoPlay={false}
        loop={element.loop ?? true}
        muted={element.muted ?? true}
        controls={false}
        preload="metadata"
        style={{ ...commonStyle, cursor: "pointer" }}
        onClick={handleClick}
      />
      <EditorVideoControls
        videoRef={videoRef}
        crop={crop}
        w={element.size.w}
        h={element.size.h}
      />
    </div>
  );
}

// ── Custom controls for cropped video in editor ───────────────────

function EditorVideoControls({
  videoRef,
  crop,
  w,
  h,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  crop: CropRect;
  w: number;
  h: number;
}) {
  const [paused, setPaused] = useState(true);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef(0);

  // Visible crop region
  const visLeft = crop.left * w;
  const visTop = crop.top * h;
  const visW = w * (1 - crop.left - crop.right);
  const visH = h * (1 - crop.top - crop.bottom);

  const updateState = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setPaused(v.paused);
    setProgress(v.duration ? v.currentTime / v.duration : 0);
    rafRef.current = requestAnimationFrame(updateState);
  }, [videoRef]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(updateState);
    return () => cancelAnimationFrame(rafRef.current);
  }, [updateState]);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const seek = (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = ratio * v.duration;
  };

  const barH = 20;
  const barPad = 4;

  return (
    <div
      style={{
        position: "absolute",
        left: visLeft,
        top: visTop + visH - barH - barPad,
        width: visW,
        height: barH,
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "0 4px",
        background: "rgba(0,0,0,0.55)",
        borderRadius: 4,
        pointerEvents: "auto",
        zIndex: 1,
      }}
    >
      {/* Play / Pause */}
      <button
        onClick={togglePlay}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          display: "flex",
          alignItems: "center",
        }}
      >
        {paused ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
            <rect x="5" y="3" width="4" height="18" />
            <rect x="15" y="3" width="4" height="18" />
          </svg>
        )}
      </button>

      {/* Progress bar */}
      <div
        onClick={seek}
        style={{
          flex: 1,
          height: 4,
          background: "rgba(255,255,255,0.25)",
          borderRadius: 2,
          cursor: "pointer",
          position: "relative",
        }}
      >
        <div
          style={{
            width: `${progress * 100}%`,
            height: "100%",
            background: "white",
            borderRadius: 2,
          }}
        />
      </div>
    </div>
  );
}
