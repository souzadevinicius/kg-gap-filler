// src/llmClient.ts

import * as fs from 'fs';
import * as path from 'path';
import { Note } from './graphAnalyser';

export class LLMClient {
  private apiUrl: string;

  constructor(apiUrl: string) {
    this.apiUrl = apiUrl;
  }

  public async generateContent(prompt: string): Promise<string> {
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });

      if (!response.ok) throw new Error('LLM request failed');
      return (await response.json()).text;
    } catch (error) {
      console.error(error);
      return '';
    }
  }

  public async fillGap(gapNote: Note, gapContent: string): Promise<void> {
    const notePath = path.join(gapNote.id.replace('.md', '.md')); // Ensure proper file format
    fs.writeFileSync(notePath, `${gapContent}\n\n${gapNote.content}`);
  }
}