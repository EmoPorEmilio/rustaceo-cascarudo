import { createFileRoute } from '@tanstack/solid-router';
import pageCss from '../styles/app.css?url';

export const Route = createFileRoute('/')({
  head: () => ({
    links: [{ rel: 'stylesheet', href: pageCss }],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <main class="landing-page" aria-label="Rustaceo Cascarudo">
      <div class="landing-stack">
        <img
          class="landing-logo"
          src="/logotipo.svg"
          width="827"
          height="642"
          alt="Rustaceo Cascarudo"
        />
        <a class="landing-cta" href="/bagit">
          BAGIT
        </a>
      </div>
    </main>
  );
}
