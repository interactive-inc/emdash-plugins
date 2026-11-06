import { z } from 'zod';
import { defineComponent, type ComponentExtensions } from '../../../src/builder/extensions.ts';

/** Host components as a site registers them: a void root, and a root that nests another Root by mistake. */
export const hostComponents: ComponentExtensions = {
  Photo: defineComponent({ props: z.object({ src: z.string() }), motion: true, description: 'A photo', component: ({ props, Root }) => <Root as="img" src={props.src} alt="" /> }),
  Article: defineComponent({ props: z.object({ title: z.string() }), motion: true, description: 'An article',
    component: ({ props, Root }) => <Root as="article"><Root as="h2">{props.title}</Root></Root> }),
};
