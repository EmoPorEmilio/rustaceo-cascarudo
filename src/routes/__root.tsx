/// <reference types="vite-plus/client" />
import { createRootRoute, HeadContent, Scripts } from '@tanstack/solid-router';
import { HydrationScript } from 'solid-js/web';
import type { JSX } from 'solid-js';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charset: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Rustaceo Cascarudo' },
      {
        name: 'description',
        content: 'Rustaceo Cascarudo',
      },
      { property: 'og:title', content: 'Rustaceo Cascarudo' },
      { property: 'og:type', content: 'website' },
      { property: 'og:image', content: '/logotipo.svg' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
    links: [{ rel: 'icon', type: 'image/svg+xml', href: '/logotipo.svg' }],
  }),
  shellComponent: RootDocument,
});

function RootDocument(props: { children: JSX.Element }) {
  return (
    <html lang="en">
      <head>
        <HydrationScript />
      </head>
      <body>
        <HeadContent />
        {props.children}
        <Scripts />
      </body>
    </html>
  );
}
