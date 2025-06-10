// import * as fs from 'fs';
// import * as path from 'path';
export interface Note extends d3.SimulationNodeDatum {
  /**
  * Node’s zero-based index into nodes array. This property is set during the initialization process of a simulation.
  */
  index?: number | undefined;
  /**
  * Node’s current x-position
  */
  x?: number | undefined;
  /**
  * Node’s current y-position
  */
  y?: number | undefined;
  /**
  * Node’s current x-velocity
  */
  vx?: number | undefined;
  /**
  * Node’s current y-velocity
  */
  vy?: number | undefined;
  /**
  * Node’s fixed x-position (if position was fixed)
  */
  fx?: number | null | undefined;
  /**
  * Node’s fixed y-position (if position was fixed)
  */
  id: string;
  title: string;
  content?: string;
  links: string[];
  filePath: string,
  isBridge?: boolean;
  linkURL?: string;
  summary?: string;
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

  public extractLinks(content: string): string[] {
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

export function sourceTargetPairs(links: string[][], notes: Note[]): { source: Note; target: Note }[] {
  return links.map(link => {
    const source = notes.find(n => n.id === link[0]);
    const target = notes.find(n => n.id === link[1]);
    if (!source || !target) {
      throw new Error(`Could not find source or target for link ${link}`);
    }
    return { source, target };
  });
}