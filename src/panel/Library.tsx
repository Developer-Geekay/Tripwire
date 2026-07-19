import { useEffect, useRef, useState } from "react";
import type { ScriptRecord } from "./db";

interface LibraryProps {
  scripts: ScriptRecord[];
  currentId: string | null;
  disabled: boolean;
  onSelect(id: string): void;
  onCreate(): void;
  onRename(name: string): void;
  onDelete(): void;
  onExport(): void;
  onImport(file: File): void;
}

export function Library({
  scripts,
  currentId,
  disabled,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onExport,
  onImport,
}: LibraryProps) {
  const current = scripts.find((s) => s.id === currentId);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!deleteArmed) return;
    const timer = setTimeout(() => setDeleteArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [deleteArmed]);

  const commitRename = () => {
    if (renaming !== null && renaming.trim() && renaming.trim() !== current?.name) {
      onRename(renaming.trim());
    }
    setRenaming(null);
  };

  return (
    <div className="library-bar">
      {renaming === null ? (
        <select
          className="library-select"
          value={currentId ?? ""}
          disabled={disabled}
          onChange={(e) => onSelect(e.target.value)}
        >
          {scripts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="library-rename"
          value={renaming}
          autoFocus
          onChange={(e) => setRenaming(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(null);
          }}
        />
      )}
      <button className="btn btn-small" disabled={disabled} onClick={onCreate} title="New script">
        new
      </button>
      <button
        className="btn btn-small"
        disabled={disabled || !current}
        onClick={() => setRenaming(current?.name ?? "")}
        title="Rename script"
      >
        rename
      </button>
      <button
        className={`btn btn-small ${deleteArmed ? "btn-danger" : ""}`}
        disabled={disabled || !current}
        onClick={() => {
          if (deleteArmed) {
            setDeleteArmed(false);
            onDelete();
          } else {
            setDeleteArmed(true);
          }
        }}
        title="Delete script"
      >
        {deleteArmed ? "sure?" : "delete"}
      </button>
      <span className="header-spacer" />
      <button
        className="btn btn-small"
        disabled={scripts.length === 0}
        onClick={onExport}
        title="Export all scripts as JSON"
      >
        export
      </button>
      <button
        className="btn btn-small"
        disabled={disabled}
        onClick={() => fileRef.current?.click()}
        title="Import scripts from JSON"
      >
        import
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImport(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
