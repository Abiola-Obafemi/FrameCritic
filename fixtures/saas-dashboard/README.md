# Fixture A — SaaS Dashboard

Intentional regressions (expect these findings):

- horizontal-overflow: wide-notice 620px on mobile (error)
- outside-viewport: offscreen panel at 1450px (warning/error)
- overlapping-elements: NEW/HOT badges overlap (warning)
- broken-image: /missing-image.png (error)
- console-error: simulated
- page-error: 404 for image and /api/missing

Used to verify:
- config ignores (e.g. ignore offscreen selector)
- scenarios (open modal)
- structural compare (baseline vs fixed)
- CI policies
