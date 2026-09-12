export const CONVERSATION_PURPOSES = ["voice_smoke", "negotiation", "quote_collection"] as const;

export type ConversationPurpose = (typeof CONVERSATION_PURPOSES)[number];

export type ConversationCredential =
  | { readonly transport: "webrtc"; readonly conversationToken: string }
  | { readonly transport: "websocket"; readonly signedUrl: string };

export interface ConversationCredentialProvider {
  issue(purpose: ConversationPurpose): Promise<ConversationCredential>;
}
