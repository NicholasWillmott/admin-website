import MarkdownIt from 'markdown-it';
import { Index, Show, createMemo, createSignal } from 'solid-js';
import type { WhatsNewPage } from '../../types.ts';

// Mirrors the platform's markdown-it configuration exactly
// (platform/panther/_105_markdown/parser.ts createMarkdownIt): html stays
// false so raw HTML is escaped, making the innerHTML render below safe.
const md = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: false,
  typographer: true,
});
md.disable('replacements', true);

interface WhatsNewPreviewProps {
  postTitle: string;
  page: WhatsNewPage;
  pageIndex: number;
  pageCount: number;
  onImageWidthChange?: (width: number) => void;
}

// Faithful mock of the platform's What's New modal (panther ModalContainer,
// light theme) at the platform's actual dimensions. The image can be resized
// by dragging its corner handle; the resulting width % is written back to the
// draft, so the slider and the real platform render stay in sync.
export function WhatsNewPreview(props: WhatsNewPreviewProps) {
  const rendered = createMemo(() => md.render(props.page.body || ''));
  const pos = () => props.page.imagePosition ?? 'top';
  const sideBySide = () => !!props.page.imageUrl && (pos() === 'left' || pos() === 'right');
  const isLast = () => props.pageIndex === props.pageCount - 1;
  const multiPage = () => props.pageCount > 1;
  const imageWidth = () => props.page.imageWidth ?? (sideBySide() ? 40 : 100);
  const [dragging, setDragging] = createSignal(false);

  let bodyRef: HTMLDivElement | undefined;

  function startDrag(e: PointerEvent, wrapper: HTMLElement, invert: boolean) {
    if (!props.onImageWidthChange || !bodyRef) return;
    e.preventDefault();
    const containerWidth = bodyRef.clientWidth;
    const startWidth = wrapper.getBoundingClientRect().width;
    const startX = e.clientX;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const delta = (ev.clientX - startX) * (invert ? -1 : 1);
      const pct = Math.round(((startWidth + delta) / containerWidth) * 100);
      props.onImageWidthChange!(Math.min(100, Math.max(10, pct)));
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const img = (side: boolean) => {
    // For a right-positioned image the handle sits bottom-left, so dragging
    // toward the text still means "bigger"
    const invert = side && pos() === 'right';
    let wrapper: HTMLDivElement | undefined;
    return (
      <div
        ref={wrapper}
        class={side ? 'wn-img-wrap side' : 'wn-img-wrap full'}
        classList={{ dragging: dragging(), resizable: !!props.onImageWidthChange }}
        style={{ width: `${imageWidth()}%` }}
      >
        <img class="wn-modal-img" src={props.page.imageUrl} alt="" />
        <Show when={props.onImageWidthChange}>
          <div
            class={`wn-img-handle ${invert ? 'left' : 'right'}`}
            title="Drag to resize"
            onPointerDown={(e) => startDrag(e, wrapper!, invert)}
          />
          <div class="wn-img-size-badge">{imageWidth()}%</div>
        </Show>
      </div>
    );
  };

  return (
    <div class="wn-modal">
      <div class="wn-modal-header">{props.postTitle || 'Post title'}</div>
      <div class="wn-modal-content">
        <Show when={props.page.title}>
          <div class="wn-modal-page-title">{props.page.title}</div>
        </Show>
        <div ref={bodyRef} class={sideBySide() ? 'wn-modal-body row' : 'wn-modal-body'}>
          <Show when={props.page.imageUrl && (pos() === 'top' || pos() === 'left')}>
            {img(pos() === 'left')}
          </Show>
          <div class="wn-md" innerHTML={rendered()} />
          <Show when={props.page.imageUrl && (pos() === 'bottom' || pos() === 'right')}>
            {img(pos() === 'right')}
          </Show>
        </div>
      </div>
      <div class="wn-modal-footer">
        <Show when={multiPage()}>
          <span class="wn-modal-btn neutral" classList={{ disabled: props.pageIndex === 0 }}>Back</span>
        </Show>
        <div class="wn-modal-footer-right">
          <Show when={multiPage()}>
            <div class="wn-modal-dots">
              <Index each={Array.from({ length: props.pageCount })}>
                {(_, i) => <div class="wn-modal-dot" classList={{ active: i === props.pageIndex }} />}
              </Index>
            </div>
          </Show>
          <span class="wn-modal-btn primary">{isLast() ? 'Done' : 'Next'}</span>
        </div>
      </div>
    </div>
  );
}
