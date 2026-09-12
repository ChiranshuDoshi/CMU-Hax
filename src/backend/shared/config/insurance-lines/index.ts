import { genericConfig } from "./generic";
import { personalAutoConfig } from "./personal-auto";
import type { InsuranceLineConfig } from "./types";

const CONFIGS: Readonly<Record<string, InsuranceLineConfig>> = {
  auto: personalAutoConfig,
  other: genericConfig,
};

export function getInsuranceLineConfig(line: string): InsuranceLineConfig {
  return CONFIGS[line] ?? genericConfig;
}

export { genericConfig, personalAutoConfig };
export type { InsuranceLineConfig };
