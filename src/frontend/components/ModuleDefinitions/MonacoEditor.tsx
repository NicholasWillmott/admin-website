import * as monaco from "monaco-editor";
import { type Accessor, createEffect, onCleanup, onMount } from "solid-js";

interface MonacoEditorProps {
    language: string;
    value: Accessor<string>;
    onChange: (value: string) => void;
    theme?: string;
}

monaco.editor.defineTheme("monokai", {
    base: "vs-dark",
    inherit: true,
    rules: [
        { token: "", foreground: "F8F8F2" },
        { token: "comment", foreground: "75715E", fontStyle: "italic" },
        { token: "string", foreground: "E6DB74" },
        { token: "number", foreground: "AE81FF" },
        { token: "keyword", foreground: "F92672" },
        { token: "type", foreground: "66D9EF", fontStyle: "italic" },
        { token: "type.identifier", foreground: "A6E22E" },
        { token: "identifier", foreground: "F8F8F2" },
        { token: "delimiter", foreground: "F8F8F2" },
        { token: "tag", foreground: "F92672" },
        { token: "attribute.name", foreground: "A6E22E" },
        { token: "attribute.value", foreground: "E6DB74" },
        { token: "regexp", foreground: "E6DB74" },
        { token: "constant", foreground: "AE81FF" },
    ],
    colors: {
        "editor.background": "#272822",
        "editor.foreground": "#F8F8F2",
        "editor.lineHighlightBackground": "#3E3D32",
        "editor.selectionBackground": "#49483E",
        "editorCursor.foreground": "#F8F8F0",
        "editorWhitespace.foreground": "#3B3A32",
        "editorLineNumber.foreground": "#90908A",
        "editorLineNumber.activeForeground": "#F8F8F2",
    },
});

export function MonacoEditor(props: MonacoEditorProps) {
    let containerRef!: HTMLDivElement;
    let editor: monaco.editor.IStandaloneCodeEditor | undefined;
    let ignoreChange = false;

    onMount(() => {
        editor = monaco.editor.create(containerRef, {
            value: props.value(),
            language: props.language,
            theme: "monokai",
            cursorStyle: "line",
            automaticLayout: true,
            minimap: { enabled: true },
            smoothScrolling: true
        });

        editor.onDidChangeModelContent(() => {
            if (ignoreChange) return;
            props.onChange(editor!.getValue());
        });
    });

    // Sync external value changes into the editor
    createEffect(() => {
        const val = props.value();
        if (editor && editor.getValue() !== val) {
            ignoreChange = true;
            editor.setValue(val);
            ignoreChange = false;
        }
    });

    onCleanup(() => {
        editor?.dispose();
    });

    return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
