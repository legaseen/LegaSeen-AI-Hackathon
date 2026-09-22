export const FEELINGS = [
  "FeelingAlone", "Misunderstood", "FutureAnxiety", "PressureToSucceed",
  "GriefNavigation", "LackOfDirection", "ImposterSyndrome", "RomanticHeartbreak",
] as const;

/**
 * How each feeling is spoken to the viewer. The keys are the stored tag values
 * (taxonomy.json); only the labels change, so search and the pipeline are unaffected.
 */
export const FEELING_LABELS: Record<string, string> = {
  FeelingAlone: "Alone",
  Misunderstood: "Misunderstood",
  FutureAnxiety: "Anxious about the future",
  PressureToSucceed: "Under pressure to succeed",
  GriefNavigation: "Grieving someone",
  LackOfDirection: "Unsure which way to go",
  ImposterSyndrome: "Like an impostor",
  RomanticHeartbreak: "Heartbroken",
};

export const feelingLabel = (tag: string) => FEELING_LABELS[tag] ?? humanTag(tag);

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

export function humanDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  if (h === 0) return `${m} minute${m === 1 ? "" : "s"}`;
  return `${h} hour${h === 1 ? "" : "s"} ${m} minute${m === 1 ? "" : "s"}`;
}

export const uniq = (xs: string[]) => [...new Set(xs)];

/** "FeelingAlone" -> "Feeling Alone". Display only; stored values stay PascalCase. */
export const humanTag = (tag: string) =>
  tag.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
