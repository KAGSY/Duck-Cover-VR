# Duck & Cover — installable / offline build

This folder is the self-contained version of the game (three.js is bundled in,
so it only needs the internet the first time it loads).

## Play it on your Quest

1. Put this whole folder on any website that uses **https**. Easy free options:
   - **Netlify Drop** (app.netlify.com/drop): drag this folder onto the page and it gives you a link.
   - **GitHub Pages**: create a repository, upload these files, then turn on Pages in the repository settings.
   - **Cloudflare Pages**: create a project and upload the folder.
2. On the headset, open the **Meta Quest Browser** and go to the link.
3. Press **Enter VR**.

WebXR only works from an https address (or localhost), so opening the file
directly from the headset's storage will not enter VR.

## Make it a standalone app on the headset (later)

Meta's Bubblewrap tool wraps this web app into an APK that sits in your app
library and launches straight into VR:

```
npm i -g @meta-quest/bubblewrap-cli
bubblewrap init --manifest=https://YOUR-SITE/manifest.webmanifest --metaquest
bubblewrap build
adb install app-release-signed.apk
```

You'll need the headset in Developer Mode, and you'll need to publish the
`assetlinks.json` file that Bubblewrap generates at
`https://YOUR-SITE/.well-known/assetlinks.json`. Choose the "immersive" app mode so it
opens directly in VR. The installed app appears under "Unknown Sources".
Launching straight into VR may need a Quest 2 or newer; on a Quest 1, test it first.

## Files

- `index.html` — the whole game
- `sw.js` — service worker that keeps it working offline
- `manifest.webmanifest`, `icon-192.png`, `icon-512.png` — app name and icons
