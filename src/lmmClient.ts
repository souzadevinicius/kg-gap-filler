// src/llmClient.ts

import { TFile, Vault } from 'obsidian';
import { getWebContext } from './webQuery';
import { cleanText, curateAndChunk } from './textUtils'
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
    return data.data[0].embedding;
  }

  public async generateContent(prompt: string): Promise<string> {
    try {
      console.log("LLM prompt:", prompt);
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: "qwen3-0.6b",
          // model: "qwen3-0.6b", // MUST match loaded model
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
          model: "qwen3-0.6b",
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

  public async generateContentWithContextAndSimilarity(prompt: string, clusters: string, noteAContent: string, noteBContent: string): Promise<string> {
    try {

      let webContext = await getWebContext(clusters);
      const curatedWebContext = await Promise.all(
        webContext
        .filter(w => w.link && w.text)
        .map(async (item) => {
          const cleaned = cleanText(item.text);
          const text = (await curateAndChunk(cleaned)).join(" ");
          return { ...item, text };
        })
      );

      console.log("curatedWebContext", curatedWebContext);

      // const newPrompt = `given the ${JSON.stringify(curatedWebContext)} return the single and only one most relevant topic related to the ${noteAContent} and ${noteBContent} return only one record using the same webcontent format`
      const content =  `You are an AI assistant. Answer the user's question using ONLY the information provided. Do NOT use prior knowledge or make assumptions.

Given the following list of web content, select and return ONLY THE SINGLE MOST RELEVANT RECORD related to both ${noteAContent} and ${noteBContent}.

Your output MUST be in the following format:
{"title": "...", "text": "...", "link": "..."}

DO NOT RETURN MORE THAN ONE RECORD. DO NOT RETURN ANY ADDITIONAL TEXT OR EXPLANATION.

CONTENT: ${JSON.stringify(curatedWebContext)}`
      console.log("content", content);
      const messages = [
        {
          role: "system",
          content: content
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
          model: "qwen3-0.6b", // Or your loaded model
          messages: messages,
          temperature: 0,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
      }
      const modelResponse = await response.json();
      let output = modelResponse.choices[0].message.content;

      // Try to extract only the first JSON object if multiple are returned
      const match = output.match(/\{[\s\S]*?\}/);
      if (match) {
        output = match[0];
      }
      return `[${output}]`;
    } catch (error) {
      console.error("LLM Error:", error);
      return "Error generating content";
    }
  }

  public async generateContentWithSystemContext(prompt: string): Promise<string> {
    try {
      const webContext = await getWebContext(prompt);

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
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: "qwen3-0.6b",
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