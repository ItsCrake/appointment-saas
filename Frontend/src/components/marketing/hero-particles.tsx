"use client";

import { useEffect, useRef } from "react";

/**
 * Floating dust behind the wordmark. Canvas rather than a swarm of animated
 * DOM nodes: fifty absolutely-positioned divs each running their own keyframe
 * is fifty composited layers, and it is what makes a "subtle" effect drop a
 * phone to 30fps.
 *
 * Nothing here touches React state. Position lives in a plain array mutated
 * inside the rAF loop, so the component renders exactly once and the animation
 * never re-enters the React tree.
 */

type Particle = {
  x: number;
  y: number;
  radius: number;
  /** Upward drift, px per second. Negative y is up. */
  speed: number;
  alpha: number;
  /** Phase offset so the horizontal sway is not synchronised across dots. */
  phase: number;
  sway: number;
};

/** Sparse on a phone, denser on a wide desktop panel. */
function particleCount(width: number) {
  return Math.round(Math.min(60, Math.max(18, width / 22)));
}

function createParticles(width: number, height: number): Particle[] {
  return Array.from({ length: particleCount(width) }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    radius: 0.4 + Math.random() * 1.1,
    speed: 4 + Math.random() * 12,
    // Kept low: at full opacity this reads as snow, not as dust.
    alpha: 0.12 + Math.random() * 0.38,
    phase: Math.random() * Math.PI * 2,
    sway: 2 + Math.random() * 7,
  }));
}

export function HeroParticles({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let particles: Particle[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = 0;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const draw = (elapsed: number) => {
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        const x = p.x + Math.sin(elapsed / 2400 + p.phase) * p.sway;
        ctx.globalAlpha = p.alpha;
        ctx.beginPath();
        ctx.arc(x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const step = (now: number) => {
      const delta = last === 0 ? 0 : Math.min((now - last) / 1000, 0.05);
      last = now;

      for (const p of particles) {
        p.y -= p.speed * delta;
        // Wrap rather than respawn, so density never visibly pulses.
        if (p.y < -p.radius) {
          p.y = height + p.radius;
          p.x = Math.random() * width;
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
      // difference nobody can see on a 1px dot.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#ffffff";

      particles = createParticles(width, height);

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
