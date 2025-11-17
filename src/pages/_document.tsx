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
  /* punkt skalowania w lewym górnym rogu */
  body {
    transform-origin: top left;
  }
            `,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
  function scalePage() {
    const width = window.innerWidth;
    let scale = 1;

    if (width >= 1400) {
      scale = 0.8;
    } else {
      scale = 1;
    }

    document.body.style.transform = 'scale(' + scale + ')';
    document.body.style.width = (100 / scale) + 'vw';
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
