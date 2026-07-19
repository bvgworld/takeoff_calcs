import Link from "next/link";
import { SignOutButton } from "@/components/auth/SignOutButton";

export function AppNav({ email }: { email?: string | null }) {
  return (
    <header className="flex items-center justify-between gap-4 bg-perry-industrial px-6 py-3 text-perry-white">
      <div className="min-w-0">
        <p className="font-display text-lg tracking-wide truncate">
          PERRY <span className="text-perry-blue">ELECTRICAL</span> · CIRCUIT
          TAKEOFF
        </p>
        {email ? (
          <p className="truncate text-xs text-perry-silver">{email}</p>
        ) : null}
      </div>
      <nav className="flex items-center gap-4">
        <Link
          href="/projects"
          className="text-xs font-semibold text-perry-silver hover:text-white"
        >
          Projects
        </Link>
        <Link
          href="/labor"
          className="text-xs font-semibold text-perry-silver hover:text-white"
        >
          Labor
        </Link>
        <SignOutButton />
      </nav>
    </header>
  );
}
