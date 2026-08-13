"use client";

import { useEffect, useRef } from "react";

/**
 * Floating bubbles behind the wordmark. Canvas rather than a swarm of animated
 * DOM nodes: forty absolutely-positioned divs each running their own keyframe
 * is forty composited layers, and it is what makes a "subtle" effect drop a
 * phone to 30fps.
 *
 * Nothing here touches React state. Position lives in a plain array mutated
 * inside the rAF loop, so the component renders exactly once and the animation
 * never re-enters the React tree.
 */

type Bubble = {
  x: number;
  y: number;
  radius: number;
  /** Upward drift, px per second. Negative y is up. */
  speed: number;
  alpha: number;
  lineWidth: number;
  /** Phase offsets, so no two bubbles sway or breathe in step. */
  swayPhase: number;
  sway: number;
  breathPhase: number;
  breath: number;
};

/**
 * Sparse by design. Hollow circles carry far more visual weight than dots at
 * the same count, so the density that read as "dust" reads as "foam" here.
 */
function bubbleCount(width: number, height: number) {
  const byArea = Math.round((width * height) / 26000);
  return Math.min(34, Math.max(10, byArea));
}

function createBubbles(width: number, height: number): Bubble[] {
  return Array.from({ length: bubbleCount(width, height) }, () => {
    // Weighted toward the small end: a field of uniformly large rings looks
    // like a pattern, a few big ones among many small reads as depth.
    const scale = Math.pow(Math.random(), 1.7);
    const radius = 3 + scale * 30;

    return {
      x: Math.random() * width,
      y: Math.random() * height,
      radius,
      // Big bubbles rise slower. Parallax by size is most of the depth here.
      speed: 10 - scale * 6 + Math.random() * 4,
      // And they sit fainter, so they read as further back.
      alpha: 0.3 - scale * 0.18 + Math.random() * 0.06,
      lineWidth: 1.4 - scale * 0.6,
      swayPhase: Math.random() * Math.PI * 2,
      sway: 6 + Math.random() * 16,
      breathPhase: Math.random() * Math.PI * 2,
      breath: 0.04 + Math.random() * 0.06,
    };
  });
}

export function HeroParticles({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let bubbles: Bubble[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = 0;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const draw = (elapsed: number) => {
      ctx.clearRect(0, 0, width, height);

      for (const b of bubbles) {
        const x = b.x + Math.sin(elapsed / 2600 + b.swayPhase) * b.sway;
        // A slow radius pulse keeps the field from looking like rigid rings
        // sliding upward on rails.
        const r =
          b.radius * (1 + Math.sin(elapsed / 3400 + b.breathPhase) * b.breath);

        ctx.globalAlpha = b.alpha;
        ctx.lineWidth = b.lineWidth;
        ctx.beginPath();
        ctx.arc(x, b.y, Math.max(r, 0.5), 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
    };

    const step = (now: number) => {
      const delta = last === 0 ? 0 : Math.min((now - last) / 1000, 0.05);
      last = now;

      for (const b of bubbles) {
        b.y -= b.speed * delta;
        // Wrap rather than respawn, so density never visibly pulses. The
        // margin is the bubble's own size, so nothing pops at the edge.
        if (b.y < -b.radius * 1.3) {
          b.y = height + b.radius * 1.3;
          b.x = Math.random() * width;
        }
      }

      draw(now);
      frame = requestAnimationFrame(step);
    };

    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
    };

    const start = () => {
      stop();
      if (motionQuery.matches) {
        // Reduced motion keeps the texture and drops the movement. A blank
        // panel would lose the depth the effect exists for.
        draw(0);
        return;
      }
      frame = requestAnimationFrame(step);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      // Cap DPR at 2: a 3x buffer on a phone triples fill cost for a
      // difference nobody can see on a 1px stroke.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      // Setting width/height resets the context, so style goes after, not before.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = "#ffffff";

      bubbles = createBubbles(width, height);

      // Paint one frame synchronously before handing over to the loop.
      // requestAnimationFrame is suspended while a tab is in the background, so
      // a page opened in a background tab would otherwise show an empty black
      // panel until it is focused: the effect would simply be missing on
      // arrival, which is exactly when the hero is doing its job.
      draw(0);
      start();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    motionQuery.addEventListener("change", start);

    return () => {
      stop();
      observer.disconnect();
      motionQuery.removeEventListener("change", start);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      // Decorative and behind the wordmark, so it must never eat a click.
      style={{ pointerEvents: "none" }}
    />
  );
}
