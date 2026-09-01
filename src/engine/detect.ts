import type { Page } from "playwright";
import type { Finding } from "../types.js";

// Runs inside browser context via page.evaluate — must be self-contained
export function getDetectionScript(): string {
  return `(() => {
    const findings = [];

    function cssPath(el) {
      if (!el || el === document.documentElement) return 'html';
      const parts = [];
      let cur = el;
      for (let i = 0; i < 5 && cur && cur !== document.documentElement; i++) {
        let s = cur.tagName.toLowerCase();
        if (cur.id) s += '#' + cur.id;
        else if (cur.className && typeof cur.className === 'string') {
          const c = cur.className.trim().split(/\\s+/).slice(0,2).join('.');
          if (c) s += '.' + c;
        }
        parts.unshift(s);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const docW = document.documentElement.scrollWidth;

    // 1. HORIZONTAL OVERFLOW
    if (docW > vw + 1) {
      // find widest offenders
      const offenders = [];
      const all = document.querySelectorAll('*');
      for (const el of all) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
        const right = r.left + r.width;
        if (right > vw + 1 && r.width > 10) {
          offenders.push({ selector: cssPath(el), tag: el.tagName.toLowerCase(), right: Math.round(right), width: Math.round(r.width), text: (el.textContent||'').trim().slice(0,80), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } });
          if (offenders.length >= 12) break;
        }
      }
      findings.push({
        type: 'horizontal-overflow',
        severity: 'error',
        message: \`Document scrollWidth (\${docW}px) exceeds viewport width (\${vw}px) — horizontal scrollbar likely.\`,
        details: { viewportWidth: vw, scrollWidth: docW, overflow: docW - vw, offenders }
      });
    }

    // 2. ELEMENTS OUTSIDE VIEWPORT (horizontally clipped / off-screen to right or left)
    {
      const outs = [];
      const all = document.querySelectorAll('*');
      for (const el of all) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        // Only consider visible layout elements with size
        const r = el.getBoundingClientRect();
        if (r.width < 5 || r.height < 5) continue;
        // Skip if element is supposed to be offscreen (e.g. aria-hidden, hidden attr)
        if (el.hasAttribute('hidden')) continue;
        // Right edge beyond viewport, or left edge negative beyond threshold
        if (r.right > vw + 4 || r.left < -4) {
          // ignore tiny slivers and full-width wrappers that trigger overflow already counted
          // but report elements significantly clipped
          const clippedRight = Math.max(0, r.right - vw);
          const clippedLeft = Math.max(0, -r.left);
          const clipped = clippedRight + clippedLeft;
          if (clipped > 8) {
            outs.push({ selector: cssPath(el), tag: el.tagName.toLowerCase(), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, clipped: Math.round(clipped) });
            if (outs.length >= 20) break;
          }
        }
      }
      if (outs.length) {
        findings.push({
          type: 'outside-viewport',
          severity: outs.length > 5 ? 'error' : 'warning',
          message: \`\${outs.length} element(s) extend outside the horizontal viewport.\`,
          details: { elements: outs }
        });
      }
    }

    // 3. OVERLAPPING VISIBLE ELEMENTS
    {
      const candidates = [];
      const all = document.querySelectorAll('*');
      for (const el of all) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
        if (parseFloat(cs.opacity) === 0) continue;
        // Skip tiny elements, script/style, etc.
        if (['SCRIPT','STYLE','META','LINK','HEAD','HTML','NOSCRIPT'].includes(el.tagName)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 20 || r.height < 20) continue;
        // Only consider elements in (or near) viewport vertically
        if (r.bottom < -100 || r.top > vh + 200) continue;
        // Has visible background/border/text — heuristic: has text or bg
        const hasText = (el.textContent||'').trim().length > 0;
        const hasBg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
        const hasBorder = parseFloat(cs.borderWidth) > 0;
        if (!hasText && !hasBg && !hasBorder && el.children.length === 0) continue;
        // Skip very large containers (page wrappers) to reduce noise
        if (r.width > vw * 0.92 && r.height > vh * 0.85) continue;
        candidates.push({ el, rect: r, selector: cssPath(el) });
        if (candidates.length > 180) break;
      }

      const overlaps = [];
      // O(n^2) but capped at ~180
      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const a = candidates[i], b = candidates[j];
          // Skip ancestor/descendant pairs — they naturally overlap
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const ar = a.rect, br = b.rect;
          const xOverlap = Math.max(0, Math.min(ar.right, br.right) - Math.max(ar.left, br.left));
          const yOverlap = Math.max(0, Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top));
          if (xOverlap > 8 && yOverlap > 8) {
            const areaA = ar.width * ar.height;
            const areaB = br.width * br.height;
            const overlapArea = xOverlap * yOverlap;
            const ratio = overlapArea / Math.min(areaA, areaB);
            // Only flag significant overlaps (>20% of smaller element) or large absolute overlap
            if (ratio > 0.20 || overlapArea > 2500) {
              const ox = Math.max(ar.left, br.left);
              const oy = Math.max(ar.top, br.top);
              overlaps.push({
                a: a.selector, b: b.selector,
                rectA: { x: Math.round(ar.x), y: Math.round(ar.y), w: Math.round(ar.width), h: Math.round(ar.height) },
                rectB: { x: Math.round(br.x), y: Math.round(br.y), w: Math.round(br.width), h: Math.round(br.height) },
                overlap: { x: Math.round(ox), y: Math.round(oy), w: Math.round(xOverlap), h: Math.round(yOverlap), area: Math.round(overlapArea), ratio: Math.round(ratio*100)/100 }
              });
              if (overlaps.length >= 15) break;
            }
          }
        }
        if (overlaps.length >= 15) break;
      }
      if (overlaps.length) {
        findings.push({
          type: 'overlapping-elements',
          severity: overlaps.length > 6 ? 'error' : 'warning',
          message: \`\${overlaps.length} pair(s) of visible elements overlap significantly.\`,
          details: { pairs: overlaps }
        });
      }
    }

    // 4. BROKEN IMAGES
    {
      const broken = [];
      const imgs = document.querySelectorAll('img');
      for (const img of imgs) {
        const isBroken = !img.complete || img.naturalWidth === 0;
        // Also flag 1x1 or 0 natural size with src present
        if (isBroken && img.getAttribute('src')) {
          const cs = getComputedStyle(img);
          if (cs.display === 'none') continue;
          const r = img.getBoundingClientRect();
          broken.push({ selector: cssPath(img), src: img.getAttribute('src')||'', alt: img.getAttribute('alt')||'', w: img.naturalWidth, h: img.naturalHeight, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } });
        }
      }
      if (broken.length) {
        findings.push({
          type: 'broken-image',
          severity: 'error',
          message: \`\${broken.length} broken image(s) detected (failed to load).\`,
          details: { images: broken }
        });
      }
    }

    return findings;
  })()`;
}

export async function collectPageFindings(
  page: Page,
  viewportLabel: string,
  consoleErrors: Finding[],
  pageErrors: Finding[]
): Promise<Finding[]> {
  // run detection script
  const raw: any[] = await page.evaluate(getDetectionScript() as any);

  const findings: Finding[] = [];

  for (const r of raw) {
    findings.push({
      type: r.type,
      severity: r.severity,
      viewport: viewportLabel,
      message: r.message,
      details: r.details,
    });
  }

  // Append console/page errors filtered to this viewport
  for (const f of [...consoleErrors, ...pageErrors]) {
    findings.push({ ...f, viewport: viewportLabel });
  }

  return findings;
}
