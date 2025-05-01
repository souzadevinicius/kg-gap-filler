// import * as fs from 'fs';
// import * as path from 'path';
import { TFile } from 'obsidian';
export interface Note extends d3.SimulationNodeDatum {
  id: string;                 // File name or unique identifier
  title: string;
  content: string;
  links: string[];
  file:  TFile,          // Notes this one links to
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export class GraphAnalyser {
  private notes: Note[] = [];

  public async analyseVault(vaultPath: string): Promise<Note[]> {
    console.log('Analysing vault at:', vaultPath);
    // You need to use the Obsidian API to access files in the vault.
    // For example, you might inject an App or Vault instance and use vault.getMarkdownFiles()
    // This is a placeholder and needs to be adapted to your plugin context.
    // Example:
    // const files = this.app.vault.getMarkdownFiles();

    // Placeholder: return empty array or throw error
    throw new Error("File system access must use the Obsidian API in a plugin context.");
    // return [];
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