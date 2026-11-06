/**
 * Renders a resolved view the way the server does, in a process without browser globals.
 * Reads the view as JSON on stdin and prints both markups as JSON.
 */
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { MotionSite } from '../../../src/builder/motion-site.tsx';
import { ResolvedSite } from '../../../src/builder/site-view.tsx';
import { hostComponents } from './host-components.tsx';

const view = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify({
  browser: typeof window !== 'undefined',
  motion: renderToString(<MotionSite view={view} components={hostComponents} />),
  static: renderToString(<ResolvedSite view={view} components={hostComponents} />),
}));
