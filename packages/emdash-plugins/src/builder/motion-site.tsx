import { useState } from 'react';
import { LazyMotion, domAnimation } from 'motion/react';
import { MotionStage, StageContext } from './reveal.tsx';
import { ResolvedSite } from './site-view.tsx';
import type { ComponentExtensions } from './extensions.ts';
import type { ResolvedView } from './resolve-page.ts';

type Props = { view: ResolvedView; components: ComponentExtensions };
/** The page island: the server renders each moving element transparent where it ends up, and the browser plays its entrance. */
export function MotionSite({ view, components }: Props) {
  const [stage] = useState(() => new MotionStage());
  return <StageContext value={stage}>
    <LazyMotion features={domAnimation}><ResolvedSite view={view} components={components} /></LazyMotion>
  </StageContext>;
}
