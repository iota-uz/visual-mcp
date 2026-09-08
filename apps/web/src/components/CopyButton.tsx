import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { writeClipboard } from "../lib/clipboard";
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
    const failure = await writeClipboard(value);
    if (failure) {
      notify({ tone: "error", message: `Couldn't copy to the clipboard: ${failure}` });
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
