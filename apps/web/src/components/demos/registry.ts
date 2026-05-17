// Map a tool slug → the bespoke interactive demo component ported from kc.
// Used by DemoTabs on /tools/[slug] to decide whether to surface the
// "Interactive Demo" tab.

import type { ComponentType } from "react";
import AuthForgeDemo from "./AuthForgeDemo";
import CronPilotDemo from "./CronPilotDemo";
import DataPourDemo from "./DataPourDemo";
import FormCraftDemo from "./FormCraftDemo";
import MailMergeDemo from "./MailMergeDemo";
import NotifyStackDemo from "./NotifyStackDemo";
import OnboardKitDemo from "./OnboardKitDemo";
import PayPipeDemo from "./PayPipeDemo";
import SentinelLogDemo from "./SentinelLogDemo";
import VectorVaultDemo from "./VectorVaultDemo";

export const DEMO_REGISTRY: Record<string, ComponentType> = {
  authforge: AuthForgeDemo,
  cronpilot: CronPilotDemo,
  datapour: DataPourDemo,
  formcraft: FormCraftDemo,
  mailmerge: MailMergeDemo,
  notifystack: NotifyStackDemo,
  onboardkit: OnboardKitDemo,
  paypipe: PayPipeDemo,
  sentinellog: SentinelLogDemo,
  vectorvault: VectorVaultDemo,
};

export function demoFor(slug: string | null | undefined): ComponentType | null {
  if (!slug) return null;
  const key = slug.toLowerCase().replace(/[^a-z0-9]/g, "");
  return DEMO_REGISTRY[key] ?? null;
}
