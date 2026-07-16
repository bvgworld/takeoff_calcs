import { create } from "zustand";
import type {
  Circuit,
  Device,
  DeviceType,
  Point,
  Route,
  ToolMode,
} from "@/lib/types";

type CalibrateState = {
  active: boolean;
  p1: Point | null;
  knownFeet: number;
};

type SheetStore = {
  tool: ToolMode;
  setTool: (t: ToolMode) => void;
  stageScale: number;
  stagePos: Point;
  setStageView: (scale: number, pos: Point) => void;
  calibrate: CalibrateState;
  setCalibrate: (c: Partial<CalibrateState>) => void;
  selectedDeviceId: string | null;
  setSelectedDeviceId: (id: string | null) => void;
  selectedCircuitId: string | null;
  setSelectedCircuitId: (id: string | null) => void;
  selectedRouteId: string | null;
  setSelectedRouteId: (id: string | null) => void;
  devices: Device[];
  circuits: Circuit[];
  routes: Route[];
  setDevices: (d: Device[]) => void;
  setCircuits: (c: Circuit[]) => void;
  setRoutes: (r: Route[]) => void;
  stampType: DeviceType | null;
};

export const useSheetStore = create<SheetStore>((set) => ({
  tool: "pan",
  setTool: (tool) =>
    set({
      tool,
      stampType: tool.startsWith("stamp-")
        ? (tool.replace("stamp-", "") as DeviceType)
        : null,
    }),
  stageScale: 1,
  stagePos: { x: 0, y: 0 },
  setStageView: (stageScale, stagePos) => set({ stageScale, stagePos }),
  calibrate: { active: false, p1: null, knownFeet: 10 },
  setCalibrate: (c) =>
    set((s) => ({ calibrate: { ...s.calibrate, ...c } })),
  selectedDeviceId: null,
  setSelectedDeviceId: (selectedDeviceId) => set({ selectedDeviceId }),
  selectedCircuitId: null,
  setSelectedCircuitId: (selectedCircuitId) => set({ selectedCircuitId }),
  selectedRouteId: null,
  setSelectedRouteId: (selectedRouteId) => set({ selectedRouteId }),
  devices: [],
  circuits: [],
  routes: [],
  setDevices: (devices) => set({ devices }),
  setCircuits: (circuits) => set({ circuits }),
  setRoutes: (routes) => set({ routes }),
  stampType: null,
}));
