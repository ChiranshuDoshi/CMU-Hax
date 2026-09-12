export interface OutboundCallRequest {
  readonly toNumber: string;
}

export interface OutboundCallResult {
  readonly conversationId: string;
  readonly callSid: string;
}

export interface OutboundCallProvider {
  place(input: OutboundCallRequest): Promise<OutboundCallResult>;
}
