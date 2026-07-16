"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (err) {
      setError(err.message);
      setStatus("error");
      return;
    }
    setStatus("sent");
  }

  return (
    <div className="min-h-screen bg-perry-white">
      <header className="bg-perry-industrial px-6 py-3 text-perry-white">
        <p className="font-display text-lg tracking-wide">
          PERRY <span className="text-perry-blue">ELECTRICAL</span> · CIRCUIT
          TAKEOFF
        </p>
      </header>
      <main className="mx-auto mt-16 max-w-md px-6">
        <h1 className="font-display text-xl text-perry-industrial">Sign in</h1>
        <p className="mt-2 text-sm text-gray-600">
          Enter your email and we&apos;ll send a magic link.
        </p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-perry-silver bg-white px-3 py-2 text-sm font-normal normal-case text-perry-industrial outline-none focus:outline focus:outline-2 focus:outline-perry-blue"
            />
          </label>
          <button
            type="submit"
            disabled={status === "sending"}
            className="w-full rounded-md bg-perry-blue px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {status === "sending" ? "Sending…" : "Send magic link"}
          </button>
        </form>
        {status === "sent" && (
          <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
            Check your email for the sign-in link.
          </p>
        )}
        {status === "error" && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-perry-signal">
            {error}
          </p>
        )}
      </main>
    </div>
  );
}
