export class NegotiationValidationError extends Error {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[]) {
    super(issues.length > 0 ? `${message}: ${issues.join("; ")}` : message);
    this.name = "NegotiationValidationError";
    this.issues = [...issues];
  }
}
