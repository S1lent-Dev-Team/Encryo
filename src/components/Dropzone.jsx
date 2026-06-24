import { useRef, useState } from "react";
import { Icon } from "./ui.jsx";

export default function Dropzone({ onFiles, disabled }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);

  function handleDrop(e) {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      className={
        "cursor-pointer rounded-xl border border-dashed p-8 text-center transition-colors " +
        (over
          ? "border-brand bg-brand/5"
          : "border-line-2 hover:border-faint hover:bg-panel-2/40") +
        (disabled ? " pointer-events-none opacity-50" : "")
      }
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-panel-2 text-muted">
        <Icon.upload />
      </div>
      <p className="text-sm font-medium text-text">
        Dateien hierher ziehen oder auswählen
      </p>
      <p className="mt-1 text-xs text-muted">
        Mehrere Dateien werden als Collection unter einem Link gebündelt
      </p>
    </div>
  );
}
