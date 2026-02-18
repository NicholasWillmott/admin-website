import { For } from "solid-js";
import { toasts, removeToast } from "../../stores/toastStore.ts";

export function ToastContainer() {
  return (
    <div class="toast-container">
      <For each={toasts()}>
        {(toast) => (
          <div class={`toast toast-${toast.type}`}>
            <span>{toast.message}</span>
            <button type="button" onClick={() => removeToast(toast.id)}>×</button>
          </div>
        )}
      </For>
    </div>
  );
}
