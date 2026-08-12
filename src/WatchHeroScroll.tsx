/**
 * WatchHeroScroll.tsx
 * ---------------------------------------------------------------------------
 */

import React, { useRef, useState, useEffect } from "react";
import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
  useMotionValueEvent,
  type MotionValue,
} from "framer-motion";

/* -------------------------------------------------------------------------- */
/*  Content                                                                   */
/* -------------------------------------------------------------------------- */

/** Full 80-frame sequence, matching the original HTML's embedded film strip. */
const FRAMES: string[] = Array.from(
  { length: 80 },
  (_, i) => `/frames/s${String(i + 1).padStart(3, "0")}.jpg`
);

type Align = "left" | "right" | "center";

interface Panel {
  eyebrow: string;
  heading: React.ReactNode;
  body: string;
  align: Align;
  cta?: { label: string; href: string };
}

const PANELS: Panel[] = [
  {
    eyebrow: "Haute Horlogerie",
    heading: (
      <>
        Time,
        <br />
        <em>considered.</em>
      </>
    ),
    body: "A watch is not one object. It is dozens, fitted together by hand, so that one glance can tell the truth about a moment.",
    align: "left",
  },
  {
    eyebrow: "Chapter II",
    heading: "Unfastened.",
    body: "Crystal, dial, case — lifted apart, if only for a second, to show what precision actually looks like from the inside.",
    align: "right",
  },
  {
    eyebrow: "Chapter III",
    heading: (
      <>
        Every layer,
        <br />
        <em>deliberate.</em>
      </>
    ),
    body: "An automatic movement, hand-finished, sits at the centre of it all — the part you're never meant to see, made as carefully as the part you are.",
    align: "center",
  },
  {
    eyebrow: "Chapter IV",
    heading: "Reassembled.",
    body: "Every layer returns to its place. Nothing about the stillness that follows hints at what it took to get there.",
    align: "right",
  },
  {
    eyebrow: "Chapter V",
    heading: (
      <>
        Ready
        <br />
        <em>to wear.</em>
      </>
    ),
    body: "18-karat red gold. Hand-stitched alligator strap. A dial built to be read at a glance, for decades at a time.",
    align: "left",
    cta: { label: "Explore the Details", href: "#specs" },
  },
];

const CHAPTER_MARKS = ["I", "II", "III", "IV", "V"];

/**
 * Progress boundaries for each panel/chapter, matching the original's
 * `stageBounds`. IMPORTANT: all values must stay within [0, 1] — Framer
 * Motion's `useTransform` throws when a boundary derived from
 * `scrollYProgress` exceeds 1 (the HTML's `1.001` would crash it here).
 * `useActiveChapter` below treats "reached the final boundary" as staying
 * in the last chapter, so behavior at progress === 1 still matches.
 */
const STAGE_BOUNDS = [0, 0.2, 0.42, 0.6, 0.8, 1];

/* -------------------------------------------------------------------------- */
/*  Small helpers                                                             */
/* -------------------------------------------------------------------------- */

const alignClasses: Record<Align, string> = {
  left: "left-[8%] text-left",
  right: "left-auto right-[8%] text-left",
  center: "left-1/2 -translate-x-1/2 text-center",
};

/**
 * Shared "which chapter is active" tracker, mirroring the HTML's single
 * `updatePanels(progress)` loop that drives both the panels and the chapter
 * marks from the same bounds check.
 */
function useActiveChapter(progress: MotionValue<number>) {
  const [active, setActive] = useState(0);

  useMotionValueEvent(progress, "change", (v) => {
    for (let c = 0; c < STAGE_BOUNDS.length - 1; c++) {
      const inRange = v >= STAGE_BOUNDS[c] && v < STAGE_BOUNDS[c + 1];
      const isFinalCatchAll =
        c === STAGE_BOUNDS.length - 2 && v >= STAGE_BOUNDS[c + 1];
      if (inRange || isFinalCatchAll) {
        setActive((prev) => (prev === c ? prev : c));
        return;
      }
    }
  });

  return active;
}

/* -------------------------------------------------------------------------- */
/*  Vignette + grain overlays (static decoration, ported from the CSS)        */
/* -------------------------------------------------------------------------- */

function Vignette() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        background:
          "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%), linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 70%, rgba(0,0,0,0.65) 100%)",
      }}
    />
  );
}

function Grain() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-overlay"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Hand-dial (small rotating indicator in the HUD, top right)                */
/* -------------------------------------------------------------------------- */

function HandDial({ rotate }: { rotate: MotionValue<number> }) {
  return (
    <div className="h-[34px] w-[34px] flex-none">
      <svg viewBox="0 0 34 34" className="block h-full w-full">
        <circle
          cx="17"
          cy="17"
          r="15.5"
          fill="none"
          stroke="rgba(236,228,211,0.25)"
          strokeWidth="1"
        />
        <motion.line
          x1="17"
          y1="17"
          x2="17"
          y2="4"
          stroke="#c9a66b"
          strokeWidth="1.4"
          strokeLinecap="round"
          style={{ rotate, originX: "17px", originY: "17px" }}
        />
        <circle cx="17" cy="17" r="1.4" fill="#c9a66b" />
      </svg>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Scrubbed image stage — canvas-painted, matching the HTML's draw/scale     */
/*  algorithm exactly (cover-fit, DPR-aware, no CSS crossfade between frames) */
/* -------------------------------------------------------------------------- */

function FrameStage({ progress }: { progress: MotionValue<number> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagesRef = useRef<HTMLImageElement[]>([]);
  const readyRef = useRef(false);
  const currentIndexRef = useRef(0);

  const drawFrame = (i: number) => {
    const canvas = canvasRef.current;
    const img = imagesRef.current[i];
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !img || !img.complete || img.naturalWidth === 0) {
      return;
    }
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const scale = Math.max(cw / iw, ch / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, dx, dy, dw, dh);
  };

  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.parentElement?.clientWidth ?? canvas.clientWidth;
    const h = canvas.parentElement?.clientHeight ?? canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  useEffect(() => {
    resizeCanvas();

    const imgs: HTMLImageElement[] = new Array(FRAMES.length);
    FRAMES.forEach((src, i) => {
      const img = new Image();
      img.onload = () => {
        if (i === 0) {
          readyRef.current = true;
          resizeCanvas();
          drawFrame(0);
        }
      };
      img.src = src;
      imgs[i] = img;
    });
    imagesRef.current = imgs;

    const handleResize = () => {
      resizeCanvas();
      drawFrame(currentIndexRef.current);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useMotionValueEvent(progress, "change", (v) => {
    if (!readyRef.current) return;
    const i = Math.round(v * (FRAMES.length - 1));
    currentIndexRef.current = i;
    drawFrame(i);
  });

  return (
    <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
  );
}

/* -------------------------------------------------------------------------- */
/*  Panels layer — text that fades in while progress sits in its "chapter"    */
/* -------------------------------------------------------------------------- */

function PanelItem({ panel, isOn }: { panel: Panel; isOn: boolean }) {
  return (
    <div
      style={{ opacity: isOn ? 1 : 0, transition: "opacity 0.7s ease" }}
      className={`absolute top-1/2 max-w-[520px] -translate-y-1/2 ${alignClasses[panel.align]} ${
        panel.align !== "center"
          ? "max-[760px]:left-[6%] max-[760px]:right-[6%] max-[760px]:max-w-none"
          : ""
      }`}
    >
      <span className="mb-4 block font-sans text-[11px] font-medium uppercase tracking-[0.28em] text-gold">
        {panel.eyebrow}
      </span>
      <h2 className="m-0 mb-4 font-serif text-[clamp(34px,5vw,58px)] font-normal leading-[1.04] text-cream max-[760px]:text-[clamp(28px,8vw,40px)]">
        {panel.heading}
      </h2>
      <p
        className={`m-0 max-w-[400px] font-sans text-[15px] font-light leading-[1.65] text-dim ${
          panel.align === "center" ? "mx-auto" : ""
        }`}
      >
        {panel.body}
      </p>
      {panel.cta && (
        <a
          href={panel.cta.href}
          className="pointer-events-auto mt-7 inline-flex items-center gap-2.5 border border-gold-soft px-[26px] py-3.5 font-sans text-xs uppercase tracking-[0.16em] text-cream no-underline transition-colors duration-[350ms] hover:border-gold hover:bg-gold hover:text-ink"
        >
          {panel.cta.label}
        </a>
      )}
    </div>
  );
}

function PanelsLayer({ progress }: { progress: MotionValue<number> }) {
  const active = useActiveChapter(progress);
  return (
    <div className="pointer-events-none absolute inset-0 z-[4]">
      {PANELS.map((panel, i) => (
        <PanelItem key={i} panel={panel} isOn={i === active} />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Chapters nav (roman numerals, bottom-left of the pinned stage)            */
/* -------------------------------------------------------------------------- */

function ChaptersNav({ progress }: { progress: MotionValue<number> }) {
  const active = useActiveChapter(progress);

  return (
    <div className="absolute bottom-8 left-7 z-[5] flex gap-3.5">
      {CHAPTER_MARKS.map((mark, i) => (
        <span
          key={mark}
          className="font-serif text-[13px] italic"
          style={{
            color: i === active ? "#c9a66b" : "rgba(236,228,211,0.36)",
            opacity: i === active ? 1 : 0.5,
            transition: "color 0.5s ease, opacity 0.5s ease",
          }}
        >
          {mark}
        </span>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Scroll cue (bottom-right "Scroll" label, fades out once you move)         */
/* -------------------------------------------------------------------------- */

function ScrollCue({ progress }: { progress: MotionValue<number> }) {
  const [visible, setVisible] = useState(true);

  useMotionValueEvent(progress, "change", (v) => {
    setVisible(!(v > 0.03));
  });

  return (
    <div
      style={{ opacity: visible ? 1 : 0, transition: "opacity 0.6s ease" }}
      className="absolute bottom-8 right-8 z-[5] flex flex-col items-center gap-2 font-sans text-[10px] uppercase tracking-[0.22em] text-dim max-[760px]:hidden"
    >
      <span>Scroll</span>
      <span className="h-[34px] w-px animate-scroll-cue bg-gradient-to-b from-gold to-transparent" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Reduced-motion fallback — static, stacked, IntersectionObserver-style     */
/*                                                                             */
/*  NOTE: this reproduces the HTML's fallback copy verbatim, including its   */
/*  apparent bug — it shows only 4 of the 5 chapters (skipping             */
/*  "Reassembled") and relabels the last block "Chapter IV" while showing    */
/*  the "Ready to wear" copy that belongs to chapter V. See file header.     */
/* -------------------------------------------------------------------------- */

function FallbackBlock({
  eyebrow,
  heading,
  body,
  cta,
}: {
  eyebrow: string;
  heading: React.ReactNode;
  body: string;
  cta?: { label: string; href: string };
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
      className="mb-11"
    >
      <span className="font-sans text-[11px] font-medium uppercase tracking-[0.28em] text-gold">
        {eyebrow}
      </span>
      <h2 className="my-3.5 font-serif text-[clamp(28px,4vw,42px)] font-normal text-cream">
        {heading}
      </h2>
      <p className="max-w-[440px] font-sans text-[15px] font-light leading-[1.65] text-dim">
        {body}
      </p>
      {cta && (
        <a
          href={cta.href}
          className="mt-7 inline-flex items-center gap-2.5 border border-gold-soft px-[26px] py-3.5 font-sans text-xs uppercase tracking-[0.16em] text-cream no-underline transition-colors duration-[350ms] hover:border-gold hover:bg-gold hover:text-ink"
        >
          {cta.label}
        </a>
      )}
    </motion.div>
  );
}

function StaticFallback() {
  return (
    <section className="relative bg-ink">
      <div className="relative h-[78vh] min-h-[520px] overflow-hidden bg-ink">
        <img
          src={FRAMES[FRAMES.length - 1]}
          alt="An unfastened watch, reassembled"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <Vignette />
        <Grain />
        <div className="absolute left-7 right-7 top-7 z-[5] flex items-start justify-between">
          <span className="font-serif text-[15px] italic tracking-wide text-cream/85">
            Villeret Ultraplate
          </span>
        </div>
      </div>

      <div className="max-w-[640px] px-[8%] pb-10 pt-16">
        <FallbackBlock
          eyebrow="Haute Horlogerie"
          heading={
            <>
              Time, <em>considered.</em>
            </>
          }
          body="A watch is not one object. It is dozens, fitted together by hand, so that one glance can tell the truth about a moment."
        />
        <FallbackBlock
          eyebrow="Chapter II"
          heading="Unfastened."
          body="Crystal, dial, case — lifted apart, if only for a second, to show what precision actually looks like from the inside."
        />
        <FallbackBlock
          eyebrow="Chapter III"
          heading={
            <>
              Every layer, <em>deliberate.</em>
            </>
          }
          body="An automatic movement, hand-finished, sits at the centre of it all — the part you're never meant to see, made as carefully as the part you are."
        />
        <FallbackBlock
          eyebrow="Chapter IV"
          heading={
            <>
              Ready <em>to wear.</em>
            </>
          }
          body="18-karat red gold. Hand-stitched alligator strap. A dial built to be read at a glance, for decades at a time."
          cta={{ label: "Explore the Details", href: "#specs" }}
        />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  The pinned scroll-driven hero                                             */
/* -------------------------------------------------------------------------- */

function ScrubbingHero() {
  const sectionRef = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  const handRotate = useTransform(scrollYProgress, [0, 1], [0, 360]);

  return (
    <section
      ref={sectionRef}
      className="relative h-[440vh] max-[760px]:h-[360vh]"
    >
      <div className="sticky top-0 flex h-screen items-center justify-center overflow-hidden bg-ink">
        <FrameStage progress={scrollYProgress} />
        <Vignette />
        <Grain />

        {/* HUD */}
        <div className="pointer-events-none absolute inset-x-7 top-7 z-[5] flex items-start justify-between max-[760px]:inset-x-5 max-[760px]:top-5">
          <span className="font-serif text-[15px] italic tracking-wide text-cream/85">
            Villeret Ultraplate
          </span>
          <HandDial rotate={handRotate} />
        </div>

        <ChaptersNav progress={scrollYProgress} />
        <PanelsLayer progress={scrollYProgress} />
        <ScrollCue progress={scrollYProgress} />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Below-fold specs section                                                  */
/* -------------------------------------------------------------------------- */

const SPECS = [
  {
    roman: "I",
    title: "Case",
    body: "18-karat red gold, polished to a mirror finish, sized to sit close and low on the wrist.",
  },
  {
    roman: "II",
    title: "Dial",
    body: "Cream lacquer with applied Roman numerals and a hand-set date aperture.",
  },
  {
    roman: "III",
    title: "Movement",
    body: "Self-winding, hand-finished, and largely invisible — as the best engineering usually is.",
  },
  {
    roman: "IV",
    title: "Strap",
    body: "Hand-stitched alligator leather, aged to a deep umber that only gets better with wear.",
  },
];

function SpecsSection() {
  return (
    <section id="specs" className="border-t border-umber bg-ink-2 px-[8%] py-24">
      <div className="mb-12 flex flex-wrap items-end justify-between gap-6 border-b border-umber pb-9">
        <div>
          <span className="font-sans text-[11px] font-medium uppercase tracking-[0.28em] text-gold">
            The Details
          </span>
          <h2 className="mt-3.5 max-w-[560px] font-serif text-[clamp(28px,3.4vw,44px)] font-normal text-cream">
            Built to disappear
            <br />
            <em className="italic text-gold">under a cuff, not in a drawer.</em>
          </h2>
        </div>
        <a
          href="#"
          className="inline-flex items-center gap-2.5 whitespace-nowrap border border-gold bg-gold px-7 py-4 font-sans text-xs font-medium uppercase tracking-[0.16em] text-ink no-underline transition-colors duration-300 hover:bg-transparent hover:text-cream"
        >
          Reserve a Viewing
        </a>
      </div>

      <div className="grid grid-cols-4 gap-px bg-umber max-[760px]:grid-cols-2">
        {SPECS.map((spec) => (
          <div key={spec.roman} className="bg-ink-2 px-[22px] py-7">
            <span className="mb-3.5 block font-serif text-[13px] italic text-gold">
              {spec.roman}
            </span>
            <h3 className="m-0 mb-2 font-serif text-[19px] font-normal text-cream">
              {spec.title}
            </h3>
            <p className="m-0 font-sans text-[13px] font-light leading-[1.6] text-dim">
              {spec.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Footer                                                                    */
/* -------------------------------------------------------------------------- */

function Footer() {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 bg-ink-2 px-[8%] pb-11 pt-9 font-sans text-[11px] tracking-wide text-dim-2">
      <span>© 2026 — For demonstration purposes.</span>
      <span>Scroll-driven hero built from a single sequence.</span>
    </footer>
  );
}

/* -------------------------------------------------------------------------- */
/*  Root export                                                               */
/* -------------------------------------------------------------------------- */

export default function WatchHeroScroll() {
  const prefersReducedMotion = useReducedMotion();

  // preload frames once, same as the HTML's unconditional preload() call
  useEffect(() => {
    FRAMES.forEach((src) => {
      const img = new Image();
      img.src = src;
    });
  }, []);

  return (
    <main className="bg-ink font-sans text-cream selection:bg-gold selection:text-ink">
      {prefersReducedMotion ? <StaticFallback /> : <ScrubbingHero />}
      <SpecsSection />
      <Footer />
    </main>
  );
}
