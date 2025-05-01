// src/gapDetector.ts
import { Note } from './graphAnalyser';

export class GapDetector {
  private graph: Map<string, Set<string>> = new Map();

  public analyseGraph(notes: Note[]): string[] {
    // Build graph adjacency list
    notes.forEach(note => {
      this.graph.set(note.id, new Set(note.links));
    });

    return this.findUnconnectedClusters();
  }

  private findUnconnectedClusters(): string[] {
    const visited = new Set<string>();
    const clusters: string[][] = [];
    const unconnectedNodes: string[] = [];

    // Find isolated nodes
    for (const [id, links] of this.graph.entries()) {
      if (links.size === 0) {
        unconnectedNodes.push(id);
      }
    }

    return unconnectedNodes;
  }
}