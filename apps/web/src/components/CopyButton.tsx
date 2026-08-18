import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useToast } from "./Toast";
import { Button } from "./ui/Button";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const { notify } = useToast();
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  async function handleCopy() {
    try {
      // The rejection path is real: a non-secure origin or a denied
      // permission both reject here, and the button used to flip to
      // "Copied" regardless — telling the user their token was on the
      // clipboard when it wasn't.
      await navigator.clipboard.writeText(value);
    } catch (err: unknown) {
      notify({
        tone: "error",
        message: `Couldn't copy to the clipboard: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Button variant="secondary" size="sm" icon={copied ? Check : Copy} onClick={handleCopy}>
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </Button>
  );
}
