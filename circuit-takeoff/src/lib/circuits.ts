/**
 * Circuit insert helpers — unique (sheet_id, panel_device_id, number).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Circuit, CircuitType } from "./types";

export type NewCircuitInput = {
  sheet_id: string;
  panel_device_id: string;
  number: number;
  ctype: CircuitType;
  voltage: number;
  breaker_amps?: number;
};

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "23505" ||
    /duplicate key|unique constraint/i.test(error.message || "")
  );
}

async function nextCircuitNumber(
  supabase: SupabaseClient,
  sheetId: string,
  panelDeviceId: string
): Promise<number> {
  const { data } = await supabase
    .from("circuits")
    .select("number")
    .eq("sheet_id", sheetId)
    .eq("panel_device_id", panelDeviceId)
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data as { number?: number } | null)?.number ?? 0) + 1;
}

/**
 * Insert a circuit; on unique conflict retry with next number (max 3 attempts).
 */
export async function insertCircuitWithRetry(
  supabase: SupabaseClient,
  input: NewCircuitInput,
  maxAttempts = 3
): Promise<Circuit> {
  let number = input.number;
  let lastError: { message?: string; code?: string } | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data, error } = await supabase
      .from("circuits")
      .insert({
        sheet_id: input.sheet_id,
        panel_device_id: input.panel_device_id,
        number,
        ctype: input.ctype,
        voltage: input.voltage,
        breaker_amps: input.breaker_amps ?? 20,
      })
      .select("*")
      .single();

    if (!error && data) return data as Circuit;

    lastError = error;
    if (error && isUniqueViolation(error)) {
      number = await nextCircuitNumber(
        supabase,
        input.sheet_id,
        input.panel_device_id
      );
      continue;
    }
    throw new Error(error?.message || "Failed to create circuit");
  }

  throw new Error(
    lastError?.message ||
      "Could not allocate a unique circuit number after retries"
  );
}
