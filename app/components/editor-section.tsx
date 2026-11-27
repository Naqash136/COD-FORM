import { useState, type ReactNode } from "react";

export function EditorSection({
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string;
  summary: string;
  children?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="cod-editor-section"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>{title}</span>
        <s-text>{summary}</s-text>
      </summary>
      <div className="cod-editor-section-body">{children}</div>
    </details>
  );
}
