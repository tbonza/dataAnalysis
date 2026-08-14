import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatAnthropic } from "@langchain/anthropic";
import { StringOutputParser } from "@langchain/core/output_parsers";

// Define the prompt template for intent classification
const prompt = ChatPromptTemplate.fromTemplate(
  "Classify this prompt as 'data' or 'style':\n{prompt}\nIntent:"
);

// Initialize the LLM (Anthropic)
const llm = new ChatAnthropic({ model: "claude-3-5-sonnet-20240620" });
const chain = prompt.pipe(llm).pipe(new StringOutputParser());

// Export the intent classification function
export async function classifyIntent(prompt: string): Promise<"data" | "style"> {
  const intent = await chain.invoke({ prompt });
  return intent.trim().toLowerCase() as "data" | "style";
}