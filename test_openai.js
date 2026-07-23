const { ChatOpenAI } = require("@langchain/openai");
require('dotenv').config();

async function run() {
  const apiKey = process.env.OPENAI_API_KEY;
  console.log("OpenAI API Key length:", apiKey ? apiKey.length : 0);
  try {
    const model = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      apiKey: apiKey,
      temperature: 0.2,
    });
    console.log("Model instantiated. Invoking...");
    const response = await model.invoke("Hello, how are you?");
    console.log("Response text:", response.content || response.text);
  } catch (err) {
    console.error("Error Stack Trace:\n", err);
  }
}
run();
