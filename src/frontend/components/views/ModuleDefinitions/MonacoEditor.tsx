import * as monaco from "monaco-editor";
import { type Accessor, createEffect, onCleanup, onMount } from "solid-js";

interface MonacoEditorProps {
    language: string;
    value: Accessor<string>;
    onChange: (value: string) => void;
    theme: Accessor<string>;
}

monaco.editor.defineTheme("monokai-light", {
    base: "vs",
    inherit: true,
    rules: [
        { token: "", foreground: "272822" },
        { token: "comment", foreground: "75715E", fontStyle: "italic" },
        { token: "string", foreground: "9C6B20" },
        { token: "number", foreground: "7A3DB8" },
        { token: "keyword", foreground: "D6336C" },
        { token: "type", foreground: "1A8A8A", fontStyle: "italic" },
        { token: "type.identifier", foreground: "5B8C2A" },
        { token: "identifier", foreground: "272822" },
        { token: "delimiter", foreground: "272822" },
        { token: "tag", foreground: "D6336C" },
        { token: "attribute.name", foreground: "5B8C2A" },
        { token: "attribute.value", foreground: "9C6B20" },
        { token: "regexp", foreground: "9C6B20" },
        { token: "constant", foreground: "7A3DB8" },
    ],
    colors: {
        "editor.background": "#FAFAFA",
        "editor.foreground": "#272822",
        "editor.lineHighlightBackground": "#F0F0F0",
        "editor.selectionBackground": "#D6EDFF",
        "editorCursor.foreground": "#272822",
        "editorWhitespace.foreground": "#D0D0D0",
        "editorLineNumber.foreground": "#B0B0B0",
        "editorLineNumber.activeForeground": "#272822",
    },
});

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
            theme: props.theme(),
            cursorStyle: "line",
            automaticLayout: true,
            minimap: { enabled: true },
            smoothScrolling: true,
            wordWrap: "on",
            formatOnPaste: true,
            cursorSmoothCaretAnimation: "on",
            cursorBlinking: "smooth",
            stickyScroll: { enabled: true },
            foldingHighlight: true,
            renderWhitespace: "selection",
            guides: { bracketPairs: true },
            bracketPairColorization: { enabled: true },
            fontSize: 14
        });

        editor.onDidChangeModelContent(() => {
            if (ignoreChange) return;
            props.onChange(editor!.getValue());
        });
    });

    createEffect(() => {
        const theme = props.theme();
        if (editor) monaco.editor.setTheme(theme);
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

interface MonacoDiffEditorProps {
    language: string;
    original: Accessor<string>;
    modified: Accessor<string>;
    theme: Accessor<string>;
}

export function MonacoDiffEditor(props: MonacoDiffEditorProps) {
    let containerRef!: HTMLDivElement;
    let diffEditor: monaco.editor.IStandaloneDiffEditor | undefined;

    onMount(() => {
        diffEditor = monaco.editor.createDiffEditor(containerRef, {
            theme: props.theme(),
            automaticLayout: true,
            readOnly: true,
            renderSideBySide: true,
            minimap: { enabled: false },
            smoothScrolling: true,
            fontSize: 14,
        });

        diffEditor.setModel({
            original: monaco.editor.createModel(props.original(), props.language),
            modified: monaco.editor.createModel(props.modified(), props.language),
        });
    });

    createEffect(() => {
        const theme = props.theme();
        if (diffEditor) monaco.editor.setTheme(theme);
    });

    createEffect(() => {
        const model = diffEditor?.getModel();
        if (!model) return;
        const orig = props.original();
        const mod = props.modified();
        if (model.original.getValue() !== orig) model.original.setValue(orig);
        if (model.modified.getValue() !== mod) model.modified.setValue(mod);
    });

    onCleanup(() => {
        const model = diffEditor?.getModel();
        model?.original.dispose();
        model?.modified.dispose();
        diffEditor?.dispose();
    });

    return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
