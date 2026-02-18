import { createSignal } from "solid-js";

type ToastType = "success" | "error" | "info";

interface Toast {
    id: number;
    message: string;
    type: ToastType;
}

const [toasts, setToasts] = createSignal<Toast[]>([]);

let nextId = 0;

function addToast(message: string, type: ToastType = "info", timeout = 4000) {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => removeToast(id), timeout);
}

function removeToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
}

export { toasts, addToast, removeToast };