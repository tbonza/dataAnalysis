import { ChatBedrockConverse } from "@langchain/aws";
import { AWS_REGION, BEDROCK_MODEL_ID } from "./constants.js";

// Credentials come from the default AWS provider chain (env, SSO, profile,
// instance role) via @aws-sdk/credential-provider-node — nothing to pass here.
// No `temperature`: current Claude models reject non-default sampling params.
export function createChatModel(): ChatBedrockConverse {
  return new ChatBedrockConverse({ model: BEDROCK_MODEL_ID, region: AWS_REGION });
}
