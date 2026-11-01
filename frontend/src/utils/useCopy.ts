import { useState } from "react";

/** Copies text and remembers which key was copied for 1.5 s, to swap the icon to a check. */
export function useCopy(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  function copy(key: string, text: string) {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(key);
        window.setTimeout(() => setCopied((k) => (k === key ? null : k)), 1500);
      },
      () => setCopied(null)
    );
  }
  return [copied, copy];
}
