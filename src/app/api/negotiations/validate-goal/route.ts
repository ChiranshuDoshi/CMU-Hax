import { z } from "zod";

import { jsonError, jsonSuccess, readJsonBody } from "@/app/api/_lib/http";
import { requireInternalAuthorization } from "@/app/api/_lib/security";
import { buildNegotiatorGoalView, validateNegotiationGoal } from "@/domain/negotiation";
import { NegotiationGoalSchema, NormalizedQuoteSchema } from "@/domain/schemas/person4";

export const runtime = "nodejs";

const BodySchema = z.strictObject({
  goal: NegotiationGoalSchema,
  selectedQuote: NormalizedQuoteSchema,
});

export async function POST(request: Request): Promise<Response> {
  try {
    requireInternalAuthorization(request);
    const body = BodySchema.parse(await readJsonBody(request));
    const goal = validateNegotiationGoal(body.goal, body.selectedQuote);

    return jsonSuccess({
      valid: true,
      goalId: goal.id,
      negotiatorView: buildNegotiatorGoalView(goal),
    });
  } catch (error) {
    return jsonError(error);
  }
}
