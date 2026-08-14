import fetch from "node-fetch";
import { GenerateSpecRequest } from "./schemas";

// Define a sample request
const request: GenerateSpecRequest = {
  prompt: "Show sales by region as a bar chart",
  data_schema: [
    { field: "region", type: "categorical" },
    { field: "sales", type: "quantitative" },
  ],
};

// Send a POST request to the MCP server
async function testServer() {
  const response = await fetch("http://localhost:3000/api/chart/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const result = await response.json();
  console.log(result);
}

// Run the test
testServer();