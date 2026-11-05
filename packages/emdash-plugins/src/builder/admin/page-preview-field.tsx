import { useEffect, useState } from 'react';
import { getEditorPageId } from './get-editor-page-id.ts';
import { getPagePreview, getPreviewConfiguration } from './get-page-preview.ts';
import { PagePreviewFrame } from './page-preview-frame.tsx';

type Props = { value: unknown };
type Configuration = Awaited<ReturnType<typeof getPreviewConfiguration>>;
type Load<T> = { status: 'pending' } | { status: 'success'; data: T } | { status: 'error'; message: string };

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'プレビューを読み込めませんでした。';

/**
 * Replace the internal document field with a saved-draft preview.
 * Uses only React and the browser so the plugin does not share EmDash's internal TanStack instances.
 */
export function PagePreviewField(props: Props) {
  const [configuration, setConfiguration] = useState<Load<Configuration>>({ status: 'pending' });
  const [preview, setPreview] = useState<Load<string>>({ status: 'pending' });
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname;
  const pageId = configuration.status === 'success' ? getEditorPageId(pathname, configuration.data.collection) : null;
  const previewPath = configuration.status === 'success' ? configuration.data.previewPath : undefined;
  const valueKey = JSON.stringify(props.value ?? null);

  useEffect(() => {
    const controller = new AbortController();
    getPreviewConfiguration(controller.signal).then(
      data => setConfiguration({ status: 'success', data }),
      error => { if (!controller.signal.aborted) setConfiguration({ status: 'error', message: errorMessage(error) }); },
    );
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (pageId === null) return;
    const controller = new AbortController();
    setPreview({ status: 'pending' });
    getPagePreview(pageId, controller.signal, previewPath).then(
      data => setPreview({ status: 'success', data }),
      error => { if (!controller.signal.aborted) setPreview({ status: 'error', message: errorMessage(error) }); },
    );
    return () => controller.abort();
  }, [pageId, previewPath, valueKey]);

  if (configuration.status === 'error') return <p role="alert">{configuration.message}</p>;
  if (configuration.status === 'pending') return <p role="status">プレビューを読み込んでいます…</p>;
  if (pageId === null) return <p>ページの作成・変更はチャットで行ってください。保存したページを開くと、ここで確認して公開できます。</p>;

  return <section aria-label="ページプレビュー">
    {preview.status === 'pending' && <p role="status">プレビューを読み込んでいます…</p>}
    {preview.status === 'error' && <p role="alert">{preview.message}</p>}
    {preview.status === 'success' && <PagePreviewFrame url={preview.data} />}
  </section>;
}
