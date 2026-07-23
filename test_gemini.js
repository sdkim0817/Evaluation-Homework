// const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
// require('dotenv').config();

// async function run() {
//   const apiKey = process.env.GEMINI_API_KEY;
//   console.log("API Key length:", apiKey ? apiKey.length : 0);
//   try {
//     const model = new ChatGoogleGenerativeAI({
//       model: "gemini-1.5-flash",
//       apiKey: apiKey,
//       temperature: 0.2,
//     });
//     console.log("Model instantiated. Invoking...");
//     const response = await model.invoke("Hello, how are you?");
//     console.log("Response text:", response.content || response.text);
//   } catch (err) {
//     console.error("Error Stack Trace:\n", err);
//   }
// }
// run();


const { GoogleGenAI } = require("@google/genai");
require('dotenv').config();
delete process.env.GOOGLE_API_KEY;

async function run() {
  const apiKey = process.env.GEMINI_API_KEY;
  console.log("API Key length:", apiKey ? apiKey.length : 0);

  try {
    // 공식 SDK 인스턴스 생성 (AQ... 키 정상 지원)
    const ai = new GoogleGenAI({ apiKey: apiKey });

    console.log("Model instantiated. Invoking...");

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: 'Hello, how are you?',
      config: {
        temperature: 0.2,
      }
    });

    console.log("Response text:", response.text);
  } catch (err) {
    console.error("Error Stack Trace:\n", err);
  }
}

run();