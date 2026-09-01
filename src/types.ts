export type Viewport = { label: string; width: number; height: number };

export const VIEWPORTS: Viewport[] = [
  { label: "mobile", width: 390, height: 844 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "desktop", width: 1440, height: 900 },
];

export type Severity = "error" | "warning" | "info";

export type Finding = {
  type:
    | "horizontal-overflow"
    | "outside-viewport"
    | "overlapping-elements"
    | "broken-image"
    | "console-error"
    | "page-error";
  severity: Severity;
  viewport: string;
  message: string;
  details?: Record<string, unknown>;
};

export type ViewportResult = {
  viewport: Viewport;
  screenshot: string; // relative path
  findings: Finding[];
};

export type ScanReport = {
  url: string;
  timestamp: string;
  viewports: Viewport[];
  results: ViewportResult[];
  findings: Finding[]; // flattened
  summary: { total: number; errors: number; warnings: number; infos: number };
};
