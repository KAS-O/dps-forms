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
    overflow-x: hidden;
  }

  body {
    transform: none !important;
  }
            `,
          }}
        />
      </body>
    </Html>
  );
}
