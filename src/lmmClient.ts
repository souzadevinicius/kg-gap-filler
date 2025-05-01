// src/llmClient.ts

import { TFile, Vault } from 'obsidian';

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
                model: "mistral-nemo-instruct-2407", // MUST match loaded model
                messages: [{ role: "user", content: prompt }],
                temperature: 0.2
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

  async fillGap(generatedContent: string, vault: Vault, noteFile: TFile, oldContent:string): Promise<void> {
      await vault.modify(noteFile, `${oldContent}\n${generatedContent}` );
  }
}