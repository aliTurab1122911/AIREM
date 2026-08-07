# Airem frontend

React + TypeScript dashboard, built with Vite.

## Start locally

```bash
npm install
cp .env.example .env
npm run dev
```

Set `VITE_API_BASE_URL` to the backend origin. The dashboard reads live data from `GET /api/dashboard`; loading, empty, and error states are included.

`npm install` also copies Inter and Space Grotesk WOFF2 assets from the pinned
Fontsource packages into `public/fonts/`. Generated font binaries are ignored by
Git so code review systems that only support text patches can process this app;
the browser still receives locally hosted files and makes no runtime font request.

## Production

```bash
npm run build
npm run preview
```
