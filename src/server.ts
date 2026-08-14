import express from "express";
import cors from "cors";
import { classifyIntent } from "./agents/intentRouter";
import { generateSpec } from "./agents/specGenerator";
import { validateSpec } from "./agents/validator";
import { GenerateSpecRequest } from "./schemas";

// Initialize Express server
const app = express();
app.use(cors());
app.use(express.json());

// Register the `/api/chart/generate` route
app.post("/api/chart/generate", async (req, res) => {
  try {
    const request = GenerateSpecRequest.parse(req.body);
    const intent = await classifyIntent(request.prompt);
    const spec = await generateSpec(request.prompt, request.data_schema);

    if (!request.skip_validation) {
      const validation = validateSpec(spec, request.data_schema);
      if (!validation.valid) {
        return res.status(400).json({ error: "Spec validation failed", details: validation.warnings });
      }
    }

    res.json({ spec, intent });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Bad request" });
  }
});

// Start the server
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});