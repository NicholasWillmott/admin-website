import MarkdownIt from 'markdown-it';
import { Index, Show, createMemo } from 'solid-js';
import { WHATS_NEW_LAYOUTS } from '../../types.ts';
import type { WhatsNewLanguage, WhatsNewPage, WhatsNewText } from '../../types.ts';

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
  postTitle: WhatsNewText;
  page: WhatsNewPage;
  pageIndex: number;
  pageCount: number;
  lang: WhatsNewLanguage;
}

// Faithful mock of the platform's What's New modal (panther ModalContainer,
// light theme) at the platform's actual dimensions, laid out from the same
// locked preset table the platform renders with.
export function WhatsNewPreview(props: WhatsNewPreviewProps) {
  // Same resolution the platform applies: selected language, English fallback
  const txt = (t: WhatsNewText | undefined): string => {
    const v = t?.[props.lang];
    return v?.trim() ? v : (t?.en ?? '');
  };
  const rendered = createMemo(() => md.render(txt(props.page.body)));
  const layout = () => WHATS_NEW_LAYOUTS[props.page.layoutPreset] ?? WHATS_NEW_LAYOUTS.textOnly;
  const showImage = () => layout().hasImage && !!props.page.imageUrl;
  const isLast = () => props.pageIndex === props.pageCount - 1;
  const multiPage = () => props.pageCount > 1;

  const img = () => (
    <div
      class={layout().row ? 'wn-img-wrap side' : 'wn-img-wrap full'}
      style={{ width: `${layout().widthPct}%` }}
    >
      <img class="wn-modal-img" src={props.page.imageUrl} alt="" />
    </div>
  );

  return (
    <div class="wn-modal">
      <div class="wn-modal-header">{txt(props.postTitle) || 'Post title'}</div>
      <div class="wn-modal-content">
        {/* Mirrors the platform's fixed-height page region: the modal stays
            the same size on every page; long pages scroll inside */}
        <Show
          when={layout().cover && showImage()}
          fallback={
            <div class="wn-modal-page-region">
              <Show when={txt(props.page.title)}>
                <div class="wn-modal-page-title">{txt(props.page.title)}</div>
              </Show>
              <div class={layout().row ? 'wn-modal-body row' : 'wn-modal-body'}>
                <Show when={showImage() && layout().imageFirst}>{img()}</Show>
                <div class="wn-md" innerHTML={rendered()} />
                <Show when={showImage() && !layout().imageFirst}>{img()}</Show>
              </div>
            </div>
          }
        >
          <div class="wn-modal-page-region cover">
            <img class="wn-cover-img" src={props.page.imageUrl} alt="" />
            <div class="wn-cover-overlay">
              <Show when={txt(props.page.title)}>
                <div class="wn-cover-title">{txt(props.page.title)}</div>
              </Show>
              <div class="wn-md wn-cover-md" innerHTML={rendered()} />
            </div>
          </div>
        </Show>
      </div>
      <div class="wn-modal-footer">
        <Show when={multiPage() && !isLast()}>
          <span class="wn-modal-btn neutral">Skip</span>
        </Show>
        <div class="wn-modal-footer-right">
          <Show when={multiPage()}>
            <div class="wn-modal-dots">
              <Index each={Array.from({ length: props.pageCount })}>
                {(_, i) => <div class="wn-modal-dot" classList={{ active: i === props.pageIndex }} />}
              </Index>
            </div>
            <span class="wn-modal-btn neutral" classList={{ disabled: props.pageIndex === 0 }}>
              {/* panther chevronLeft (Phosphor, MIT) */}
              <svg viewBox="0 0 256 256" fill="currentColor">
                <path d="M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z" />
              </svg>
            </span>
          </Show>
          <Show when={multiPage() && !isLast()} fallback={<span class="wn-modal-btn primary">Done</span>}>
            <span class="wn-modal-btn primary">
              {/* panther chevronRight (Phosphor, MIT) */}
              <svg viewBox="0 0 256 256" fill="currentColor">
                <path d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z" />
              </svg>
            </span>
          </Show>
        </div>
      </div>
    </div>
  );
}
