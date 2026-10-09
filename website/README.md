# CrossTalk website

The landing page (`index.html`) and the cockpit (`cockpit.html`), a browser client that connects to any CrossTalk hub. Everything here is static: no server code, no secrets. Security headers (CSP, frame denial, nosniff) are set in the repo-root `vercel.json`.

This folder is not part of the npm package.

```sh
npm run dev        # serves the site on http://localhost:3000
```

Deploy on Vercel from the repo root: the root `vercel.json` serves this folder as static files and skips install and build. (Setting the project's Root Directory to `website` is not needed.)
