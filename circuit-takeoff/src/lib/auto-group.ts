import { manhattan } from "./routing";
import type { Device, ProjectSettings } from "./types";

export type AutoGroupCluster = {
  deviceIds: string[];
  ctype: "lighting" | "receptacle";
};

/**
 * Greedy nearest-neighbor clustering of unassigned devices.
 * Lighting: sum watts ≤ 0.8 × 20A × V, soft-capped at 70% of that.
 * Receptacles: max 8 per circuit.
 */
export function autoGroupDevices(opts: {
  devices: Device[];
  ctype: "lighting" | "receptacle";
  settings: ProjectSettings;
  breakerAmps?: number;
}): AutoGroupCluster[] {
  const { devices, ctype, settings, breakerAmps = 20 } = opts;
  const V =
    ctype === "lighting"
      ? settings.lighting_voltage
      : settings.receptacle_voltage;

  const pool =
    ctype === "lighting"
      ? devices.filter(
          (d) =>
            !d.circuit_id && (d.type === "fixture" || d.type === "switch")
        )
      : devices.filter((d) => !d.circuit_id && d.type === "receptacle");

  if (!pool.length) return [];

  const hardCapVa = 0.8 * breakerAmps * V;
  const softCapVa = hardCapVa * 0.7;
  const maxRecept = 8;

  const remaining = [...pool];
  const clusters: AutoGroupCluster[] = [];

  while (remaining.length) {
    // Seed with farthest from origin-ish (or first)
    let seedIdx = 0;
    let seedScore = -1;
    for (let i = 0; i < remaining.length; i++) {
      const score = remaining[i].x + remaining[i].y;
      if (score > seedScore) {
        seedScore = score;
        seedIdx = i;
      }
    }
    const cluster: Device[] = [remaining.splice(seedIdx, 1)[0]];

    const canAdd = (d: Device): boolean => {
      if (ctype === "receptacle") {
        const recepts = cluster.filter((x) => x.type === "receptacle").length;
        return (
          d.type === "receptacle" && recepts < maxRecept
        );
      }
      // lighting — switches always fit; fixtures by watt budget
      if (d.type === "switch") return !cluster.some((x) => x.type === "switch");
      const watts =
        cluster
          .filter((x) => x.type === "fixture")
          .reduce((s, x) => s + (x.attrs.watts ?? 36), 0) +
        (d.attrs.watts ?? 36);
      return watts <= softCapVa;
    };

    let grew = true;
    while (grew) {
      grew = false;
      let bestI = -1;
      let bestD = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = remaining[i];
        if (!canAdd(d)) continue;
        // nearest to any in cluster
        let min = Infinity;
        for (const c of cluster) {
          min = Math.min(
            min,
            manhattan({ x: d.x, y: d.y }, { x: c.x, y: c.y })
          );
        }
        if (min < bestD) {
          bestD = min;
          bestI = i;
        }
      }
      if (bestI >= 0) {
        cluster.push(remaining.splice(bestI, 1)[0]);
        grew = true;
      }
    }

    // If a lighting cluster has only a switch, absorb a nearby fixture if any left
    if (
      ctype === "lighting" &&
      cluster.every((d) => d.type === "switch") &&
      remaining.some((d) => d.type === "fixture")
    ) {
      // leave switch for next round with fixtures — put back
      remaining.push(...cluster);
      // force take one fixture seed next: remove pure-switch attempt by skipping
      const fi = remaining.findIndex((d) => d.type === "fixture");
      if (fi >= 0) {
        const f = remaining.splice(fi, 1)[0];
        clusters.push({ deviceIds: [f.id], ctype });
      }
      continue;
    }

    clusters.push({
      deviceIds: cluster.map((d) => d.id),
      ctype,
    });
  }

  return clusters;
}
