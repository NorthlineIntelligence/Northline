"use client";

import { useMemo, useRef, useState } from "react";

type Props = {
  name: string;
  disabled?: boolean;
};

export default function IntakeDocumentDropInput({ name, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selected, setSelected] = useState<File[]>([]);

  const helperText = useMemo(() => {
    if (!selected.length) return "Optional. Upload up to 10 files (2MB each).";
    return `${selected.length} file(s) selected`;
  }, [selected]);

  function syncFilesToInput(files: File[]) {
    const input = inputRef.current;
    if (!input) return;
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    input.files = dt.files;
    setSelected(files);
  }

  function appendFiles(nextFiles: File[]) {
    const merged = [...selected];
    for (const f of nextFiles) {
      if (!merged.some((x) => x.name === f.name && x.size === f.size && x.type === f.type)) {
        merged.push(f);
      }
    }
    syncFilesToInput(merged.slice(0, 10));
  }

  return (
    <div
      className="rounded-lg border border-dashed px-3 py-3 text-sm transition-colors"
      style={{
        borderColor: dragActive ? "#173464" : "#cdd8df",
        background: dragActive ? "#f4f7fc" : "#fff",
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        if (!disabled) setDragActive(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragActive(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        if (disabled) return;
        const files = Array.from(e.dataTransfer.files ?? []);
        if (!files.length) return;
        appendFiles(files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        name={name}
        multiple
        disabled={disabled}
        className="w-full rounded-lg border border-[#cdd8df] px-3 py-2 text-sm"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          appendFiles(files);
        }}
      />
      <p className="mt-2 text-xs text-[#66819e]">
        Drag and drop files here, or use the picker above. {helperText}
      </p>
      {selected.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {selected.map((f, idx) => (
            <button
              key={`${f.name}-${f.size}-${idx}`}
              type="button"
              className="rounded-full border border-[#cdd8df] bg-white px-2 py-0.5 text-xs text-[#173464]"
              onClick={() => {
                const next = selected.filter((_, i) => i !== idx);
                syncFilesToInput(next);
              }}
            >
              {f.name} ×
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

