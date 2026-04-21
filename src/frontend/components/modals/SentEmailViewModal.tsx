interface SentEmailViewModalProps {
  html: string;
  onClose: () => void;
}

export function SentEmailViewModal(props: SentEmailViewModalProps) {
  return (
    <div class="sent-email-modal-overlay" onClick={props.onClose}>
      <div class="sent-email-modal" onClick={(e) => e.stopPropagation()}>
        <div class="sent-email-modal-header">
          <span class="sent-email-modal-title">Email Preview</span>
          <button type="button" class="sent-email-modal-close" onClick={props.onClose}>✕</button>
        </div>
        <iframe
          class="sent-email-modal-iframe"
          srcdoc={props.html}
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  );
}
