// src/pages/_document.tsx
import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="pl">
      <Head>
        <link rel="icon" href="/favicon.ico" />
        <meta name="theme-color" content="#b68f4a" />
      </Head>
      <body>
        <Main />
        <NextScript />
        <style
          dangerouslySetInnerHTML={{
            __html: `
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    overflow-x: hidden;   /* nic nie może wystawać na prawo */
  }

  /* na zwykłych stronach skalujemy body względem górnego środka */
  body:not(.is-login) {
    transform-origin: top center;
  }
            `,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
  function scalePage() {
    const width = window.innerWidth;
    const isLoginPage = document.body.classList.contains('is-login');

    if (isLoginPage) {
      // ekran logowania – bez skalowania
      document.body.style.transform = 'none';
      return;
    }

    let scale = 1;

    // na dużych ekranach – odpowiednik zoom 80%
    if (width >= 1400) {
      scale = 0.8;
    }

    document.body.style.transform = 'scale(' + scale + ')';
  }

  window.addEventListener('load', scalePage);
  window.addEventListener('resize', scalePage);
            `,
          }}
        />
      </body>
    </Html>
  );
}
