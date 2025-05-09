// src/llmClient.ts

import { TFile, Vault } from 'obsidian';
import { getWebContext } from './webQuery';

export class LLMClient {
  private apiUrl: string;

  constructor(apiUrl: string) {
    this.apiUrl = apiUrl;
  }

  public async getEmbedding(text: string): Promise<number[]> {
    const response = await fetch('http://localhost:1234/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "text-embedding-nomic-embed-text-v1.5-embedding",
        input: [text]
      })
    });
    const data = await response.json();
    // LM Studio returns { data: [{ embedding: [...] }] }
    return data.data[0].embedding;
  }

  public async generateContent(prompt: string): Promise<string> {
    try {
      console.log("LLM prompt:", prompt);
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Add if needed: 'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: "phi-4", // MUST match loaded model
          // model: "mistral-nemo-instruct-2407", // MUST match loaded model
          messages: [{ role: "user", content: prompt }],
          temperature: 0
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
      }
      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error("LLM Error:", error);
      return "Error generating content";
    }
  }

  public async generateContentWithContext(prompt: string, clusters: string): Promise<string> {
    try {
      const webContext = await getWebContext(clusters);

      const messages = [
        {
          role: "system",
          content: webContext
            ? `Web context for the assistant:\n${JSON.stringify(webContext)}\nYou are an AI assistant. Answer the user's question using ONLY the information provided below. Do NOT use prior knowledge or make assumptions.`
            : "You are a helpful AI assistant.",
        },
        {
          role: "user",
          content: prompt,
        },
      ];

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: "phi-4", // Or your loaded model
          messages: messages,
          temperature: 0,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
      }
      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error("LLM Error:", error);
      return "Error generating content";
    }
  }



  public async generateContentWithSystemContext(prompt: string): Promise<string> {
    try {
      // 1. Get web context (implement this as shown in previous examples)
      const webContext = await getWebContext(prompt);

      // 2. Prepare messages: system for context, user for the actual prompt
      const messages = [
        {
          role: "system",
          content: webContext
            ? `Web context for the assistant:\n${webContext}\nYou are an AI assistant. Answer the user's question using only the information provided below. If the answer is not present in the context, respond with 'I don't know.' Do not use any prior knowledge or make assumptions.`
            : "You are a helpful AI assistant.",
        },
        {
          role: "user",
          content: prompt,
        },
      ];
      console.log(messages);
      // 3. Send to LLM API
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // 'Authorization': `Bearer ${API_KEY}` // Uncomment if needed
        },
        body: JSON.stringify({
          model: "phi-4", // Or your loaded model
          messages: messages,
          temperature: 0,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
      }
      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error("LLM Error:", error);
      return "Error generating content";
    }
  }

  async fillGap(generatedContent: string, vault: Vault, noteFile: TFile, oldContent: string): Promise<void> {
    await vault.modify(noteFile, `${oldContent}\n${generatedContent}`);
  }
}