import { useEffect, useRef, useState } from "react";

import { formatDateTime } from "../../../shared/formatters";
import type { SetupLink } from "../api/usersApi";

interface SetupLinkNoticeProps {
  link: SetupLink;
  personName: string;
  onDismiss: () => void;
}

/*
 * A setup link, shown once: the server keeps only its hash, so it cannot
 * be shown again later.
 */
export function SetupLinkNotice({
  link,
  personName,
  onDismiss,
}: SetupLinkNoticeProps) {
  const fieldRef = useRef<HTMLInputElement>(null);
  const [copyMessage, setCopyMessage] = useState("");

  useEffect(() => {
    fieldRef.current?.focus();
    fieldRef.current?.select();
  }, [link.url]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopyMessage("Copied.");
    } catch {
      fieldRef.current?.select();
      setCopyMessage("Press Ctrl+C (or Cmd+C) to copy the selected link.");
    }
  }

  return (
    <section className="setup-link-notice" aria-labelledby="setup-link-heading">
      <h2 id="setup-link-heading">Setup link for {personName}</h2>
      <p>
        Send this link to {personName} privately. It is shown only now, works
        once, and expires {formatDateTime(link.expiresAt)}.
      </p>

      <div className="setup-link-notice__row">
        <label htmlFor="setup-link-url" className="visually-hidden">
          Setup link
        </label>
        <input
          id="setup-link-url"
          ref={fieldRef}
          readOnly
          value={link.url}
          onFocus={(event) => event.target.select()}
        />
        <button type="button" onClick={() => void handleCopy()}>
          Copy link
        </button>
      </div>

      <p role="status" aria-live="polite" className="setup-link-notice__status">
        {copyMessage}
      </p>

      <button type="button" onClick={onDismiss}>
        Done
      </button>
    </section>
  );
}
