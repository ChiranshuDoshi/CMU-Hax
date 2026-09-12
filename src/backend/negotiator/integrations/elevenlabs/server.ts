import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

import type {
  ConversationCredential,
  ConversationCredentialProvider,
  ConversationPurpose,
} from "./types";

const AGENT_ENV_BY_PURPOSE = {
  voice_smoke: "ELEVENLABS_VOICE_SMOKE_AGENT_ID",
  negotiation: "ELEVENLABS_NEGOTIATOR_AGENT_ID",
  quote_collection: "ELEVENLABS_QUOTE_CALLER_AGENT_ID",
} as const satisfies Record<ConversationPurpose, string>;

const SDK_TIMEOUT_SECONDS = 10;
const SDK_MAX_RETRIES = 1;

export class ElevenLabsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ElevenLabsConfigurationError";
  }
}

type ServerEnvironment = Readonly<Record<string, string | undefined>>;

export interface ElevenLabsConversationGateway {
  getWebrtcToken(input: { readonly agentId: string }): Promise<{ readonly token: string }>;
  getSignedUrl(input: { readonly agentId: string }): Promise<{ readonly signedUrl: string }>;
}

type GatewayFactory = (apiKey: string) => ElevenLabsConversationGateway;

function requiredEnvironmentValue(name: string, environment: ServerEnvironment): string {
  const value = environment[name]?.trim();
  if (!value) throw new ElevenLabsConfigurationError(`${name} is not configured`);
  return value;
}

export function resolveAgentId(purpose: ConversationPurpose, environment: ServerEnvironment = process.env): string {
  return requiredEnvironmentValue(AGENT_ENV_BY_PURPOSE[purpose], environment);
}

export class ElevenLabsCredentialProvider implements ConversationCredentialProvider {
  constructor(
    private readonly environment: ServerEnvironment = process.env,
    private readonly createGateway: GatewayFactory = (apiKey) => {
      const client = new ElevenLabsClient({
        apiKey,
        timeoutInSeconds: SDK_TIMEOUT_SECONDS,
        maxRetries: SDK_MAX_RETRIES,
      });
      return client.conversationalAi.conversations;
    },
  ) {}

  async issue(purpose: ConversationPurpose): Promise<ConversationCredential> {
    const apiKey = requiredEnvironmentValue("ELEVENLABS_API_KEY", this.environment);
    const agentId = resolveAgentId(purpose, this.environment);
    const gateway = this.createGateway(apiKey);

    if (purpose === "voice_smoke") {
      const { token } = await gateway.getWebrtcToken({ agentId });
      return { transport: "webrtc", conversationToken: token };
    }

    const { signedUrl } = await gateway.getSignedUrl({ agentId });
    return { transport: "websocket", signedUrl };
  }
}
