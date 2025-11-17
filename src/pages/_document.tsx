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
  body {
    /* skalowanie względem górnego środka, wygląda lepiej niż lewy róg */
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

    let scale = 1;

    if (!isLoginPage && width >= 1400) {
      // wewnętrzne strony – odpowiednik 80% zoomu
      scale = 0.8;
    } else {
      // strona logowania i mniejsze szerokości – bez skalowania
      scale = 1;
    }

    document.body.style.transform = 'scale(' + scale + ')';
    document.body.style.width = isLoginPage
      ? '100vw'
      : (100 / scale) + 'vw';
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
