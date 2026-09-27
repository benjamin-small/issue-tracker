/**
 * Grows a textarea to fit its content (for browsers without CSS `field-sizing: content`).
 * Pass the bound value as the parameter so programmatic changes resize it too.
 */
export function autosize(node: HTMLTextAreaElement, _value?: unknown) {
  const fit = () => {
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  };
  const observer = new ResizeObserver(() => fit());
  observer.observe(node);
  node.addEventListener('input', fit);
  queueMicrotask(fit);
  return {
    update: () => queueMicrotask(fit),
    destroy() {
      observer.disconnect();
      node.removeEventListener('input', fit);
    },
  };
}
