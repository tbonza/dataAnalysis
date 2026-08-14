import { ChatPromptTemplate } from "@langchain/core/prompts";
import * as z from "zod/v4";
import { createChatModel } from "../model.js";

const IntentResult = z.object({
  intent: z
    .enum(["data", "style"])
    .describe("'data' to generate a new chart spec, 'style' to restyle an existing chart"),
});

// Define the prompt template for intent classification
const prompt = ChatPromptTemplate.fromTemplate(
  [
    "Classify the chart request below.",
    "'data' = the user wants a new chart, or wants the underlying data/encodings changed.",
    "'style' = the user only wants the appearance of an existing chart changed.",
    "",
    "Request: {prompt}",
  ].join("\n")
);

// Structured output rather than parsing prose: a free-text reply like
// "this is 'data', not 'style'" defeats any substring check.
const chain = prompt.pipe(createChatModel().withStructuredOutput(IntentResult));

// Export the intent classification function
export async function classifyIntent(prompt: string): Promise<"data" | "style"> {
  const { intent } = await chain.invoke({ prompt });
  return intent;
}
