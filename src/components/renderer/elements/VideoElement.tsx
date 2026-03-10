import { useRef, useEffect } from "react";
import type { VideoElement as VideoElementType, VideoStyle } from "@/types/deck";
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
      video.currentTime = element.trimStart ?? 0;
    }
  }, [videoStep, element.trimStart]);

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

  const { w, h } = element.size;
  const crop = style.crop;
  const hasCrop = crop && (crop.top || crop.right || crop.bottom || crop.left);

  const clipPath = hasCrop
    ? `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)`
    : undefined;

  const commonStyle: React.CSSProperties = {
    width: w,
    height: h,
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
  const shouldAutoPlay = editorMode ? false : (hasPlayVideoEffect ? false : (element.autoplay ?? true));

  const handleClick = () => {
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
        src={embedUrl}
        autoPlay={false}
        loop={element.loop ?? true}
        muted={element.muted ?? true}
        preload="metadata"
        style={commonStyle}
      />
    );
  }

  return (
    <video
      ref={videoRef}
      src={embedUrl}
      autoPlay={shouldAutoPlay}
      loop={element.loop ?? true}
      muted={element.muted ?? true}
      controls={!editorMode && element.controls}
      preload={editorMode ? "metadata" : undefined}
      style={{ ...commonStyle, cursor: "pointer" }}
      onClick={handleClick}
    />
  );
}
