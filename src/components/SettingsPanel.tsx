"use client";

import { PREF_CONFIRM_DISCARD, useBoolPref } from "@/lib/client/prefs";
import { Card, Toggle } from "./ui";

const VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

/** Per-device settings, collapsed by default, shown on every room screen. */
export function SettingsPanel() {
  const [confirmDiscard, setConfirmDiscard] = useBoolPref(PREF_CONFIRM_DISCARD, false);

  return (
    <Card className="py-2">
      <details className="group">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-bold">
            <span className="text-xs transition-transform group-open:rotate-90">▶</span>
            Setări
          </span>
          <span className="font-mono text-xs text-zinc-500">v{VERSION}</span>
        </summary>
        <div className="pb-1 pt-1">
          <Toggle
            label="Confirmare la aruncare"
            hint={confirmDiscard ? "Te întreb înainte să arunci piesa și să închei tura." : "Piesa se aruncă imediat ce apeși „Aruncă”."}
            checked={confirmDiscard}
            onChange={setConfirmDiscard}
          />
        </div>
      </details>
    </Card>
  );
}
