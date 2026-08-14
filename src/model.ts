import { ChatBedrockConverse } from "@langchain/aws";

// Bedrock model IDs are provider-prefixed and differ from first-party Anthropic
// API IDs. Per aws-bedrock-foundation-models.json (and `bedrock
// list-foundation-models`), `anthropic.claude-sonnet-5` is ACTIVE but
// INFERENCE_PROFILE-only, so it must be invoked through the cross-region profile
// ID (`us.` prefix); the bare `anthropic.claude-sonnet-5` is rejected with
// "Invocation of model ID ... with on-demand throughput isn't supported".
export const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "us.anthropic.claude-sonnet-5";
export const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";

// Credentials come from the default AWS provider chain (env, SSO, profile,
// instance role) via @aws-sdk/credential-provider-node — nothing to pass here.
// No `temperature`: current Claude models reject non-default sampling params.
export function createChatModel(): ChatBedrockConverse {
  return new ChatBedrockConverse({ model: MODEL_ID, region: REGION });
}
