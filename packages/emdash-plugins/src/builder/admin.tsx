import { PagePreviewField } from './admin/page-preview-field.tsx';
import { ManagedPageField } from './admin/managed-page-field.tsx';

/** EmDash's native field widgets keep storage and publication in the host editor. */
export const fields = { 'page-preview': PagePreviewField, managed: ManagedPageField };
