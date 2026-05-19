// Docs page — DocsClient is "use client" so Next handles the boundary.
// No dynamic-import indirection here; the previous "white flash" was just
// the IntersectionObserver running on first paint, which is fine.

import DocsClient from "./DocsClient";

export const metadata = {
  title: "Documentation — Hackmarket",
  description:
    "Getting started, API reference, submission guidelines, approver process, integration, and FAQ.",
};

export default function DocsPage() {
  return <DocsClient />;
}
