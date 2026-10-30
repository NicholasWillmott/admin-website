import { Show, splitProps, type JSX } from 'solid-js';
import { Icon, type IconName } from './Icon.tsx';

// The app's one button. Variants are tinted by intent (STYLE_GUIDE.md › Buttons):
//   primary — the main or confirming action (teal)
//   neutral — everything else (default)
//   caution — disruptive but recoverable: restart, stop (amber)
//   danger  — destructive: delete, remove (red)
export type ButtonVariant = 'primary' | 'neutral' | 'caution' | 'danger';

interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: IconName;
  // Swaps the icon for a spinner. Doesn't disable the button on its own: pass `disabled` too
  loading?: boolean;
  // Grow to fill a flex row, e.g. the two buttons of a modal footer
  block?: boolean;
}

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ['variant', 'size', 'icon', 'loading', 'block', 'class', 'children']);
  const classes = () =>
    ['btn', `btn-${local.variant ?? 'neutral'}`, local.size === 'sm' && 'btn-sm', local.block && 'btn-block', local.class]
      .filter(Boolean)
      .join(' ');

  return (
    <button class={classes()} {...rest}>
      <Show when={local.loading} fallback={local.icon && <Icon name={local.icon} />}>
        <span class="btn-spinner" aria-hidden="true" />
      </Show>
      {local.children}
    </button>
  );
}
