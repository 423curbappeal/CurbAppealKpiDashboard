import type { Muscle, MuscleState, MuscleStatus } from "@/lib/recovery";

/** Stylized front/back body. Each region is one muscle group, colored by recovery status. */

const FILL: Record<MuscleStatus | "untrained", string> = {
  ready: "var(--color-good)",
  recovering: "var(--color-warn)",
  fatigued: "var(--color-bad)",
  untrained: "rgb(255 255 255 / 0.10)",
};

type Shape = { muscle: Muscle | null; d?: string; rect?: [number, number, number, number, number]; ellipse?: [number, number, number, number] };

/** Head, neck, forearms, hands, hips, knees, feet — shared by both views. */
const NEUTRAL: Shape[] = [
  { muscle: null, ellipse: [60, 21, 12, 14] },
  { muscle: null, rect: [54, 33, 12, 12, 4] },
  { muscle: null, rect: [17, 98, 10, 34, 5] },
  { muscle: null, rect: [93, 98, 10, 34, 5] },
  { muscle: null, ellipse: [21, 138, 5, 6] },
  { muscle: null, ellipse: [99, 138, 5, 6] },
  { muscle: null, rect: [43, 124, 34, 12, 6] },
  { muscle: null, ellipse: [49, 197, 6, 4] },
  { muscle: null, ellipse: [71, 197, 6, 4] },
  { muscle: null, rect: [42, 242, 14, 7, 3] },
  { muscle: null, rect: [64, 242, 14, 7, 3] },
];

const FRONT: Shape[] = [
  { muscle: "shoulders", ellipse: [33, 56, 10, 10] },
  { muscle: "shoulders", ellipse: [87, 56, 10, 10] },
  { muscle: "chest", d: "M42 50 Q51 46 59 49 L59 75 Q49 79 42 72 Q39 60 42 50 Z" },
  { muscle: "chest", d: "M78 50 Q69 46 61 49 L61 75 Q71 79 78 72 Q81 60 78 50 Z" },
  { muscle: "biceps", rect: [21, 67, 11, 29, 5.5] },
  { muscle: "biceps", rect: [88, 67, 11, 29, 5.5] },
  { muscle: "core", d: "M46 79 Q60 83 74 79 L72 120 Q60 124 48 120 Z" },
  { muscle: "quads", d: "M41 138 Q49 134 58 138 L57 188 Q50 193 44 188 Q39 162 41 138 Z" },
  { muscle: "quads", d: "M79 138 Q71 134 62 138 L63 188 Q70 193 76 188 Q81 162 79 138 Z" },
  { muscle: "calves", rect: [43, 203, 12, 36, 6] },
  { muscle: "calves", rect: [65, 203, 12, 36, 6] },
];

const BACK: Shape[] = [
  { muscle: "shoulders", ellipse: [33, 56, 10, 10] },
  { muscle: "shoulders", ellipse: [87, 56, 10, 10] },
  { muscle: "back", d: "M44 47 Q60 41 76 47 L80 68 Q78 98 68 110 L52 110 Q42 98 40 68 Z" },
  { muscle: "triceps", rect: [21, 67, 11, 29, 5.5] },
  { muscle: "triceps", rect: [88, 67, 11, 29, 5.5] },
  { muscle: "core", rect: [48, 112, 24, 13, 5] },
  { muscle: "glutes", ellipse: [52, 139, 9, 11] },
  { muscle: "glutes", ellipse: [68, 139, 9, 11] },
  { muscle: "hamstrings", d: "M42 152 Q50 149 58 152 L57 192 Q50 196 44 192 Q40 172 42 152 Z" },
  { muscle: "hamstrings", d: "M78 152 Q70 149 62 152 L63 192 Q70 196 76 192 Q80 172 78 152 Z" },
  { muscle: "calves", ellipse: [49, 218, 7, 18] },
  { muscle: "calves", ellipse: [71, 218, 7, 18] },
];

function Figure({ shapes, muscles, label }: { shapes: Shape[]; muscles: Record<Muscle, MuscleState>; label: string }) {
  return (
    <figure className="flex flex-1 flex-col items-center">
      <svg viewBox="0 0 120 252" className="h-auto w-full max-w-[150px]" role="img" aria-label={`${label} view`}>
        {[...NEUTRAL, ...shapes].map((s, i) => {
          const st = s.muscle ? muscles[s.muscle] : null;
          const fill = !s.muscle ? "rgb(255 255 255 / 0.06)" : st?.lastTrainedAt ? FILL[st.status] : FILL.untrained;
          const opacity = st?.lastTrainedAt ? 0.85 : 1;
          const props = { fill, fillOpacity: opacity, stroke: "rgb(255 255 255 / 0.08)", strokeWidth: 0.6 };
          const title = st ? <title>{`${st.label}: ${st.lastTrainedAt ? st.status : "no recent training"}`}</title> : null;
          if (s.d) return <path key={i} d={s.d} {...props}>{title}</path>;
          if (s.rect) return <rect key={i} x={s.rect[0]} y={s.rect[1]} width={s.rect[2]} height={s.rect[3]} rx={s.rect[4]} {...props}>{title}</rect>;
          if (s.ellipse) return <ellipse key={i} cx={s.ellipse[0]} cy={s.ellipse[1]} rx={s.ellipse[2]} ry={s.ellipse[3]} {...props}>{title}</ellipse>;
          return null;
        })}
      </svg>
      <figcaption className="mt-1 text-[11px] font-medium tracking-wide text-faint uppercase">{label}</figcaption>
    </figure>
  );
}

export function BodyMap({ muscles, compact = false }: { muscles: Record<Muscle, MuscleState>; compact?: boolean }) {
  return (
    <div className={compact ? "flex gap-1" : "flex gap-4"}>
      <Figure shapes={FRONT} muscles={muscles} label="Front" />
      <Figure shapes={BACK} muscles={muscles} label="Back" />
    </div>
  );
}

export function BodyLegend() {
  const item = (color: string, label: string) => (
    <span className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12px] text-muted">
      {item(FILL.ready, "Ready")}
      {item(FILL.recovering, "Recovering")}
      {item(FILL.fatigued, "Fatigued")}
      {item("rgb(255 255 255 / 0.25)", "Not trained recently")}
    </div>
  );
}
