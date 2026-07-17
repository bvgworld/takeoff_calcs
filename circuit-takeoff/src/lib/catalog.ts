/**
 * Static device catalog — subtypes, assemblies, LV origin flags.
 * No NM/Romex. Power checks use yokes × 180 VA, not device count.
 */

export type CatalogCategory =
  | "receptacle"
  | "fixture"
  | "switch"
  | "panel"
  | "thermostat"
  | "headend"
  | "fire";

export type CatalogSymbol =
  | "circle"
  | "rect"
  | "square"
  | "triangle"
  | "hex";

export type LvSystem = "dimming" | "stat" | "fire" | "data";

export type AssemblyLine = {
  item: string;
  qty: number;
  uom: "EA";
};

export type CatalogEntry = {
  id: string;
  category: CatalogCategory;
  label: string;
  symbol: CatalogSymbol;
  /** Fixtures only — true size in feet. */
  trueSize?: { w: number; h: number };
  attrs: {
    yokes?: number;
    amps?: number;
    watts?: number;
    lvSystem?: LvSystem;
  };
  assembly: AssemblyLine[];
};

const box1g: AssemblyLine = {
  item: '4" sq box + 1G mud ring',
  qty: 1,
  uom: "EA",
};

export const CATALOG: CatalogEntry[] = [
  // —— Receptacles ——
  {
    id: "recep-duplex-15",
    category: "receptacle",
    label: "Duplex 15A",
    symbol: "circle",
    attrs: { yokes: 1, amps: 15 },
    assembly: [
      box1g,
      { item: "Duplex receptacle 15A + plate", qty: 1, uom: "EA" },
    ],
  },
  {
    id: "recep-duplex-20",
    category: "receptacle",
    label: "Duplex 20A",
    symbol: "circle",
    attrs: { yokes: 1, amps: 20 },
    assembly: [
      box1g,
      { item: "Duplex receptacle 20A + plate", qty: 1, uom: "EA" },
    ],
  },
  {
    id: "recep-quad-20",
    category: "receptacle",
    label: "Quad 20A",
    symbol: "circle",
    attrs: { yokes: 2, amps: 20 },
    assembly: [
      {
        item: '4" sq box + 2G mud ring',
        qty: 1,
        uom: "EA",
      },
      { item: "Quad receptacle 20A + plate", qty: 1, uom: "EA" },
    ],
  },
  {
    id: "recep-gfi-duplex-20",
    category: "receptacle",
    label: "GFI Duplex 20A",
    symbol: "circle",
    attrs: { yokes: 1, amps: 20 },
    assembly: [
      box1g,
      { item: "GFI duplex receptacle 20A + plate", qty: 1, uom: "EA" },
    ],
  },
  {
    id: "recep-wp-gfi-duplex-20",
    category: "receptacle",
    label: "WP GFI Duplex 20A",
    symbol: "circle",
    attrs: { yokes: 1, amps: 20 },
    assembly: [
      box1g,
      { item: "WP GFI duplex receptacle 20A", qty: 1, uom: "EA" },
      { item: "In-use weatherproof cover", qty: 1, uom: "EA" },
    ],
  },
  {
    id: "recep-simplex-20",
    category: "receptacle",
    label: "Dedicated / simplex 20A",
    symbol: "circle",
    attrs: { yokes: 1, amps: 20 },
    assembly: [
      box1g,
      { item: "Simplex receptacle 20A + plate", qty: 1, uom: "EA" },
    ],
  },
  {
    id: "recep-208v-30a",
    category: "receptacle",
    label: "208V / 30A receptacle",
    symbol: "circle",
    attrs: { yokes: 1, amps: 30 },
    assembly: [
      box1g,
      { item: "208V 30A receptacle + plate", qty: 1, uom: "EA" },
    ],
  },
  {
    id: "recep-data",
    category: "receptacle",
    label: "Data outlet",
    symbol: "square",
    attrs: { lvSystem: "data" },
    assembly: [
      { item: "Low-voltage ring", qty: 1, uom: "EA" },
      { item: "Data jack", qty: 1, uom: "EA" },
      { item: "Data plate", qty: 1, uom: "EA" },
    ],
  },
  {
    id: "recep-combo-power-data",
    category: "receptacle",
    label: "Combo power + data",
    symbol: "circle",
    attrs: { yokes: 1, amps: 20, lvSystem: "data" },
    assembly: [
      {
        item: '4" sq box + 2G mud ring',
        qty: 1,
        uom: "EA",
      },
      { item: "Duplex receptacle 20A", qty: 1, uom: "EA" },
      { item: "Data jack", qty: 1, uom: "EA" },
      { item: "Combo power/data plate", qty: 1, uom: "EA" },
    ],
  },

  // —— Fixtures ——
  {
    id: "fix-troffer-2x4",
    category: "fixture",
    label: "2×4 troffer 36W",
    symbol: "rect",
    trueSize: { w: 2, h: 4 },
    attrs: { watts: 36 },
    assembly: [{ item: "Fixture connection / whip", qty: 1, uom: "EA" }],
  },
  {
    id: "fix-troffer-2x2",
    category: "fixture",
    label: "2×2 troffer 28W",
    symbol: "rect",
    trueSize: { w: 2, h: 2 },
    attrs: { watts: 28 },
    assembly: [{ item: "Fixture connection / whip", qty: 1, uom: "EA" }],
  },
  {
    id: "fix-can-6",
    category: "fixture",
    label: '6" can 12W',
    symbol: "circle",
    trueSize: { w: 0.5, h: 0.5 },
    attrs: { watts: 12 },
    assembly: [{ item: "Fixture connection / whip", qty: 1, uom: "EA" }],
  },
  {
    id: "fix-strip-4",
    category: "fixture",
    label: "4' strip 40W",
    symbol: "rect",
    trueSize: { w: 0.4, h: 4 },
    attrs: { watts: 40 },
    assembly: [{ item: "Fixture connection / whip", qty: 1, uom: "EA" }],
  },
  {
    id: "fix-strip-8",
    category: "fixture",
    label: "8' strip 80W",
    symbol: "rect",
    trueSize: { w: 0.4, h: 8 },
    attrs: { watts: 80 },
    assembly: [{ item: "Fixture connection / whip", qty: 1, uom: "EA" }],
  },
  {
    id: "fix-highbay-150",
    category: "fixture",
    label: "Highbay 150W",
    symbol: "hex",
    trueSize: { w: 1.5, h: 1.5 },
    attrs: { watts: 150 },
    assembly: [{ item: "Fixture connection / whip", qty: 1, uom: "EA" }],
  },
  {
    id: "fix-wallpack-60",
    category: "fixture",
    label: "Wallpack 60W",
    symbol: "square",
    trueSize: { w: 1, h: 0.75 },
    attrs: { watts: 60 },
    assembly: [{ item: "Fixture connection / whip", qty: 1, uom: "EA" }],
  },
  {
    id: "fix-exit-em",
    category: "fixture",
    label: "Exit / EM 5W",
    symbol: "rect",
    trueSize: { w: 1, h: 0.6 },
    attrs: { watts: 5 },
    assembly: [{ item: "Fixture connection / whip", qty: 1, uom: "EA" }],
  },

  // —— Switches ——
  {
    id: "sw-sp",
    category: "switch",
    label: "Single-pole switch",
    symbol: "square",
    attrs: {},
    assembly: [
      box1g,
      { item: "Single-pole switch + plate", qty: 1, uom: "EA" },
    ],
  },
  {
    id: "sw-3way",
    category: "switch",
    label: "3-way switch",
    symbol: "square",
    attrs: {},
    assembly: [
      box1g,
      { item: "3-way switch + plate", qty: 1, uom: "EA" },
    ],
  },
  {
    id: "sw-dimmer-010",
    category: "switch",
    label: "Dimmer 0-10V",
    symbol: "square",
    attrs: { lvSystem: "dimming" },
    assembly: [
      box1g,
      { item: "0-10V dimmer + plate", qty: 1, uom: "EA" },
    ],
  },
  {
    id: "sw-occ",
    category: "switch",
    label: "Occupancy sensor",
    symbol: "hex",
    attrs: {},
    assembly: [
      box1g,
      { item: "Occupancy sensor + plate", qty: 1, uom: "EA" },
    ],
  },

  // —— Thermostat ——
  {
    id: "stat-wall",
    category: "thermostat",
    label: "Thermostat",
    symbol: "square",
    attrs: { lvSystem: "stat" },
    assembly: [
      { item: "Thermostat backbox / ring", qty: 1, uom: "EA" },
      { item: "Thermostat", qty: 1, uom: "EA" },
    ],
  },

  // —— Head-ends ——
  {
    id: "panel",
    category: "panel",
    label: "Panel",
    symbol: "square",
    attrs: {},
    assembly: [],
  },
  {
    id: "head-facp",
    category: "headend",
    label: "FACP",
    symbol: "square",
    attrs: { lvSystem: "fire" },
    assembly: [{ item: "FACP termination / can", qty: 1, uom: "EA" }],
  },
  {
    id: "head-idf",
    category: "headend",
    label: "IDF / Rack",
    symbol: "square",
    attrs: { lvSystem: "data" },
    assembly: [{ item: "IDF/rack termination", qty: 1, uom: "EA" }],
  },
  {
    id: "head-rtu",
    category: "headend",
    label: "RTU / Mech unit",
    symbol: "square",
    attrs: { lvSystem: "stat" },
    assembly: [{ item: "RTU control termination", qty: 1, uom: "EA" }],
  },

  // —— Fire alarm devices ——
  {
    id: "fire-horn-strobe",
    category: "fire",
    label: "Horn / strobe",
    symbol: "triangle",
    attrs: { lvSystem: "fire" },
    assembly: [
      { item: "Fire device box", qty: 1, uom: "EA" },
      { item: "Horn/strobe", qty: 1, uom: "EA" },
    ],
  },
  {
    id: "fire-smoke",
    category: "fire",
    label: "Smoke detector",
    symbol: "circle",
    attrs: { lvSystem: "fire" },
    assembly: [
      { item: "Fire device box", qty: 1, uom: "EA" },
      { item: "Smoke detector", qty: 1, uom: "EA" },
    ],
  },
  {
    id: "fire-pull",
    category: "fire",
    label: "Pull station",
    symbol: "square",
    attrs: { lvSystem: "fire" },
    assembly: [
      { item: "Fire device box", qty: 1, uom: "EA" },
      { item: "Pull station", qty: 1, uom: "EA" },
    ],
  },
];

const BY_ID = new Map(CATALOG.map((e) => [e.id, e]));

/** Legacy DeviceType → catalog_id backfill map. */
export const BACKFILL_CATALOG_ID: Record<string, string> = {
  fixture: "fix-troffer-2x4",
  receptacle: "recep-duplex-20",
  switch: "sw-sp",
  panel: "panel",
};

export function getCatalogEntry(id: string | null | undefined): CatalogEntry | undefined {
  if (!id) return undefined;
  return BY_ID.get(id);
}

export function requireCatalogEntry(id: string): CatalogEntry {
  const e = BY_ID.get(id);
  if (!e) throw new Error(`Unknown catalog id: ${id}`);
  return e;
}

export function catalogByCategory(category: CatalogCategory): CatalogEntry[] {
  return CATALOG.filter((e) => e.category === category);
}

export function backfillCatalogId(legacyType: string): string {
  return BACKFILL_CATALOG_ID[legacyType] ?? "recep-duplex-20";
}

/** Yokes for power VA planning — data-only outlets contribute 0. */
export function deviceYokes(
  catalogId: string | null | undefined,
  fallbackType?: string
): number {
  const id = catalogId || (fallbackType ? backfillCatalogId(fallbackType) : "");
  const e = getCatalogEntry(id);
  if (!e || e.category !== "receptacle") return 0;
  if (e.attrs.lvSystem === "data" && e.attrs.yokes == null) return 0;
  return e.attrs.yokes ?? 0;
}

export function sumReceptacleYokes(
  devices: { catalog_id?: string | null; type?: string }[]
): number {
  return devices.reduce(
    (s, d) => s + deviceYokes(d.catalog_id, d.type),
    0
  );
}

export function defaultWatts(catalogId: string): number {
  return getCatalogEntry(catalogId)?.attrs.watts ?? 36;
}

export const STAMP_CATEGORIES: {
  id: CatalogCategory;
  label: string;
}[] = [
  { id: "receptacle", label: "Receptacle" },
  { id: "fixture", label: "Fixture" },
  { id: "switch", label: "Switch" },
  { id: "thermostat", label: "Thermostat" },
  { id: "fire", label: "Fire" },
  { id: "headend", label: "Head-end" },
  { id: "panel", label: "Panel" },
];
