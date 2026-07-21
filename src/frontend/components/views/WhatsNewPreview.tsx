import MarkdownIt from 'markdown-it';
import { Index, Show, createMemo } from 'solid-js';
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
}

// Faithful mock of the platform's What's New modal (panther ModalContainer,
// light theme): white surface, header/content/footer chrome, the page's
// image layout, markdown body, and the real footer controls (Back, page
// dots, Next/Done). Buttons are decorative.
export function WhatsNewPreview(props: WhatsNewPreviewProps) {
  const rendered = createMemo(() => md.render(props.page.body || ''));
  const pos = () => props.page.imagePosition ?? 'top';
  const sideBySide = () => !!props.page.imageUrl && (pos() === 'left' || pos() === 'right');
  const isLast = () => props.pageIndex === props.pageCount - 1;
  const multiPage = () => props.pageCount > 1;

  const img = (side: boolean) => (
    <img class={side ? 'wn-modal-img side' : 'wn-modal-img full'} src={props.page.imageUrl} alt="" />
  );

  return (
    <div class="wn-modal">
      <div class="wn-modal-header">{props.postTitle || 'Post title'}</div>
      <div class="wn-modal-content">
        <Show when={props.page.title}>
          <div class="wn-modal-page-title">{props.page.title}</div>
        </Show>
        <div class={sideBySide() ? 'wn-modal-body row' : 'wn-modal-body'}>
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
