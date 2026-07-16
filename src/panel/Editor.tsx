import { useEffect, useRef } from "react";
import { monaco } from "./monaco";

interface EditorProps {
  value: string;
  onChange(value: string): void;
  readOnly?: boolean;
}

export function Editor({ value, onChange, readOnly = false }: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const editor = monaco.editor.create(hostRef.current!, {
      value,
      language: "javascript",
      theme: "vs-dark",
      minimap: { enabled: false },
      fontSize: 12,
      lineNumbersMinChars: 3,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      fixedOverflowWidgets: true,
      tabSize: 2,
    });
    editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()));
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
      editor.dispose();
    };
    // The editor owns its buffer after mount; `value` changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) editor.setValue(value);
  }, [value]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  return <div className="editor-host" ref={hostRef} />;
}
