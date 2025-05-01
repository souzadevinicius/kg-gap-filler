// src/graphAnalyser.ts

import * as fs from 'fs';
import * as path from 'path';

export interface Note extends d3.SimulationNodeDatum {
  id: string;                 // File name or unique identifier
  title: string;
  content: string;
  links: string[];            // Notes this one links to
  x?: number;
  y?: number;
}

export class GraphAnalyser {
  private notes: Note[] = [];

  public async analyseVault(vaultPath: string): Promise<Note[]> {
    const files = fs.readdirSync(path.join(vaultPath, 'notes'));

    for (const file of files) {
      const content = fs.readFileSync(path.join(vaultPath, 'notes', file), 'utf-8');
      const links = this.extractLinks(content);
      this.notes.push({
        id: file,
        title: this.extractTitle(file),
        content,
        links
      });
    }

    return this.notes;
  }

  private extractLinks(content: string): string[] {
    // Extract internal [[links]] in Markdown format
    const regex = /\[\[([^[\]|]+)(\|[^[\]]*)?\]\]/g;
    const matches = [];
    let match;

    while ((match = regex.exec(content)) !== null) {
      matches.push(match[1]);
    }
    return matches;
  }

  private extractTitle(filename: string): string {
    // Extract title from filename (e.g., "intro.md" → "Intro")
    return filename.replace(/\.md$/, '').charAt(0).toUpperCase() + filename.slice(1, -3);
  }
}