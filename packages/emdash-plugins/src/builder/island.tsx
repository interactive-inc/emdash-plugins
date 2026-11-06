import components from 'virtual:emdash-plugins/builder/extensions';
import { MotionSite } from './motion-site.tsx';
import type { ResolvedView } from './resolve-page.ts';

/** Hydrated by PageShell. Host components come from the integration, never through island props. */
export default function SiteIsland({ view }: { view: ResolvedView }) {
  return <MotionSite view={view} components={components} />;
}
