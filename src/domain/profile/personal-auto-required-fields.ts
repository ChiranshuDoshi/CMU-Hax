import type { RequiredFieldRule } from "./completeness.js";

/**
 * Starter required-field rules for the personal-auto demo. (Spec §9.3, §11.1.)
 *
 * NOTE FOR PERSON 4: this is a minimal starter so the completeness gate works
 * end-to-end now. When your `personal-auto` InsuranceLineConfig lands, derive
 * these rules from `requiredProfileFields` there and delete this file, or import
 * it into the config as the baseline.
 */
export const PERSONAL_AUTO_REQUIRED_FIELDS: RequiredFieldRule[] = [
  { path: "userContext.state", label: "State" },
  { path: "userContext.zipCode", label: "ZIP code" },
  { path: "userContext.desiredEffectiveDate", label: "Desired effective date" },

  // At least one driver, each with rating-relevant history.
  { path: "entity:driver", label: "At least one driver" },
  { path: "entity:driver.ageBand", label: "Driver age band / DOB" },
  { path: "entity:driver.licenseStatus", label: "Driver license status" },
  { path: "entity:driver.yearsLicensed", label: "Years licensed" },

  // At least one vehicle, each with rating-relevant attributes.
  { path: "entity:vehicle", label: "At least one vehicle" },
  { path: "entity:vehicle.year", label: "Vehicle year" },
  { path: "entity:vehicle.make", label: "Vehicle make" },
  { path: "entity:vehicle.model", label: "Vehicle model" },
  { path: "entity:vehicle.primaryUse", label: "Vehicle primary use" },
  { path: "entity:vehicle.annualMileage", label: "Vehicle annual mileage" },

  // Requested coverage.
  { path: "requestedCoverage", label: "Requested coverage selections" },
];
