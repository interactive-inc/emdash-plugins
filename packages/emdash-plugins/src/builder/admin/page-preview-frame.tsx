import { useEffect, useRef, useState } from 'react';

type Props = { url: string };

const initialHeight = 480;
// Upper bound guards against content that grows with the frame (for example 100vh sections).
const maxHeight = 20000;

/**
 * Allow same-origin styles while leaving scripts and forms disabled.
 * The admin page measures the same-origin document and sizes the frame to fit it.
 */
export function PagePreviewFrame(props: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    let observer: ResizeObserver | null = null;
    let frameHeight = 0;
    let lastGrowth = 0;
    let repeatedGrowth = 0;

    const measure = () => {
      const document = element.contentDocument;
      if (!document?.documentElement) return;
      const next = Math.min(maxHeight, Math.ceil(document.documentElement.scrollHeight));
      const growth = next - frameHeight;
      // Content tied to the viewport (vh units) grows by the same amount after every resize; stop following it.
      repeatedGrowth = growth > 0 && growth === lastGrowth ? repeatedGrowth + 1 : 0;
      lastGrowth = growth;
      if (repeatedGrowth >= 3) { observer?.disconnect(); return; }
      if (next === frameHeight) return;
      frameHeight = next;
      setHeight(next);
    };
    const attach = () => {
      observer?.disconnect();
      frameHeight = 0; lastGrowth = 0; repeatedGrowth = 0;
      setHeight(null);
      try {
        const body = element.contentDocument?.body;
        if (!body) return;
        measure();
        observer = new ResizeObserver(measure);
        observer.observe(body);
      } catch {
        // A cross-origin preview cannot be measured; keep the fixed fallback height.
      }
    };

    element.addEventListener('load', attach);
    if (element.contentDocument?.readyState === 'complete') attach();
    return () => { element.removeEventListener('load', attach); observer?.disconnect(); };
  }, [props.url]);

  return <iframe
    ref={frame}
    title="ページの下書きプレビュー"
    src={props.url}
    sandbox="allow-same-origin"
    referrerPolicy="no-referrer"
    scrolling={height === null ? 'auto' : 'no'}
    style={{ display: 'block', width: '100%', height: height ?? initialHeight, border: '1px solid var(--color-kumo-line, #d1d5db)', borderRadius: 8, background: '#fff' }}
  />;
}
