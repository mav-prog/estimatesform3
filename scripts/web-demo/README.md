# Web-mode smoke test

Drives the browser-only build (`npm run build:web`, served with `npm run preview:web -- --port 3000`)
in headless Chromium and checks the takeoff math against a generated sheet with known dimensions.

```bash
node scripts/web-demo/make-test-plan.cjs /tmp/stucco-test-sheet.pdf
NODE_PATH=$(npm root -g) node scripts/web-demo/demo.cjs /tmp/stucco-test-sheet.pdf /tmp/run synthetic
```

Expected: 400 sq ft gross, three cutouts totalling 45 sq ft, 40 ft linear, 3 counted openings.
`survey` mode loads any PDF and screenshots each page instead.
