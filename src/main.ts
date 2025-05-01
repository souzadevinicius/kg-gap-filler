// src/main.ts

import { GraphAnalyser } from './graphAnalyser';
import { GapDetector } from './gapDetector';
import { LLMClient } from './lmmClient';
import { GraphViewer } from './graphViewer';
import { Note } from './graphAnalyser';
import { Plugin, TFile, Notice } from 'obsidian';

export default class KGGapFiller extends Plugin {
    private analyser!: GraphAnalyser;
    private detector!: GapDetector;
    private llmClient!: LLMClient;
    private viewer!: GraphViewer;

    private embeddingsCache: Record<string, number[]> = {};

    async onload() {
        console.log('KGGapFiller plugin loaded');
        this.analyser = new GraphAnalyser();
        this.detector = new GapDetector();
        this.llmClient = new LLMClient('http://localhost:1234/v1/chat/completions');
        this.addRibbonIcon('dot-network', 'Show D3 Graph', async () => {
            // Container handling
            let container = document.getElementById('graph-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'graph-container';
                container.style.height = '100%';
                container.style.width = '100%';
                container.createEl('div', { attr: { id: 'd3-graph-container' } });
            }
            container.innerHTML = ''; // Clear previous content

            // Leaf handling
            const leaf = this.app.workspace.getRightLeaf(false);
            if (leaf) {
                await leaf.setViewState({ type: "empty", active: true });
                leaf.view.containerEl.empty(); // Clear previous content
                leaf.view.containerEl.appendChild(container);
            } else {
                // Fallback handling
                document.body.appendChild(container);
                console.warn('Using body container as fallback');
            }

            // Initialize viewer AFTER DOM insertion
            this.viewer = new GraphViewer("graph-container");
            this.viewer.setContainer(container);

            // Get the currently active file
            const activeLeaf = this.app.workspace.getActiveFile();
            if (!activeLeaf) {
                new Notice("No active file found.");
                return;
            }

            // Run analysis only for the current file
            await this.run([activeLeaf]);
        });

        this.addCommand({
            id: 'fill-gap-bridges',
            name: 'Fill Gaps Using Bridges',
            callback: () => this.fillBridgesForCurrentFile()
        });

        this.addRibbonIcon('link', 'Fill Gaps Using Bridges', async () => {
            await this.fillBridgesForCurrentFile();
        });

        // Watch for new or modified markdown files and update the graph if the container is visible
        this.registerEvent(
            this.app.vault.on('create', async (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    await this.updateGraphForCurrentFile();
                }
            })
        );
        this.registerEvent(
            this.app.vault.on('modify', async (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    await this.updateGraphForCurrentFile();
                }
            })
        );

        this.addCommand({
            id: 'reindex-embeddings',
            name: 'Reindex Note Embeddings',
            callback: () => this.reindexEmbeddings()
        });
    }

    public async run(files: TFile[]): Promise<void> {
        if (!this.viewer){
            return;
        }
        if (!files.length) return;

        const notes: Note[] = [];
        for (const file of files) {
            const content = await this.app.vault.read(file);
            notes.push({
                id: file.basename,
                title: file.basename,
                file: file,
                content,
                links: this.analyser['extractLinks'](content)
            });
        }

        const links = this.buildLinks(notes);
        this.viewer.drawGraph(notes, links);

        const gaps = this.detector.analyseGraph(notes);
        console.log('Generated content:', gaps);

        // Only analyze and fill gaps for the current file
        for (const gap of gaps) {
            const note = notes.find(note => note.id === gap)!;
            const generatedContent = await this.llmClient.generateContent(
                `Based on the content of ${note.title}, generate a new section that fills knowledge gaps related to: ${gap}`
            );
            await this.llmClient.fillGap(generatedContent, this.app.vault, note.file, note.content);
        }
    }

    private buildLinks(notes: Note[]): string[][] {
        const noteIds = new Set(notes.map(n => n.id));
        const links: string[][] = [];
        for (const note of notes) {
            for (const link of note.links) {
                if (noteIds.has(link)) {
                    links.push([note.id, link]);
                }
            }
        }
        return links;
    }

    // Helper method to update the graph for the currently active file
    private async updateGraphForCurrentFile() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;

        // Only update if the graph-container is present (i.e., user is viewing the graph)
        const container = document.getElementById('graph-container');
        if (container) {
            await this.run([activeFile]);
        }
    }

    private async fillBridgesForCurrentFile() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice("No active file found.");
            return;
        }

        // Read content and extract links for the current file
        const content = await this.app.vault.read(activeFile);
        const note: Note = {
            id: activeFile.basename,
            title: activeFile.basename,
            file: activeFile,
            content,
            links: this.analyser['extractLinks'](content)
        };

        // For a single file, you may want to analyze the whole vault for clusters
        // If you want to analyze all notes, uncomment the following:
        // const files = this.app.vault.getMarkdownFiles();
        // const notes: Note[] = [];
        // for (const file of files) {
        //     const content = await this.app.vault.read(file);
        //     notes.push({
        //         id: file.basename,
        //         title: file.basename,
        //         file: file,
        //         content,
        //         links: this.analyser['extractLinks'](content)
        //     });
        // }
        const files = this.app.vault.getMarkdownFiles();
        const notes: Note[] = [];
        for (const file of files) {
            const content = await this.app.vault.read(file);
            notes.push({
                id: file.basename,
                title: file.basename,
                file: file,
                content,
                links: this.analyser['extractLinks'](content)
            });
        }
        this.embeddingsCache = await this.loadEmbeddingsFromFile();
        const clusters = this.detector.clusterByEmbeddingsCache(notes, this.embeddingsCache, 0.75);

        // For demo, let's just use the current note (single node = single cluster)
        // const notes = [note];

        // Build the graph and find clusters
        this.detector.analyseGraph(notes); // Build the graph
        // const clusters = this.detector.findClusters?.() || []; // Make sure findClusters exists
        // const clusters = await this.detector.clusterByEmbeddings(notes, this.llmClient, 0.5);
        if (clusters.length > 1) {
            for (let i = 0; i < clusters.length; i++) {
                for (let j = i + 1; j < clusters.length; j++) {
                    const clusterA = clusters[i].map(id => notes.find(n => n.id === id)?.title).filter(Boolean).join(', ');
                    const clusterB = clusters[j].map(id => notes.find(n => n.id === id)?.title).filter(Boolean).join(', ');
                    if (clusterA.length > 0 && clusterB.length > 0) {
                        const prompt = `Given the topics: [${clusterA}] and [${clusterB}], suggest a concept, topic, or entity that could serve as a bridge between these two clusters. Return ONLY the bridge topic as the first line, then a summary. If no meaningful bridge exists, reply with "NO BRIDGE".`;

                        const bridge = await this.llmClient.generateContent(prompt);

                        // Parse the LLM response
                        const [firstLine, ...rest] = bridge.trim().split('\n');
                        const bridgeTopic = firstLine.trim();
                        const bridgeSummary = rest.join('\n').trim();

                        if (
                            bridgeTopic &&
                            bridgeTopic.toUpperCase() !== "NO BRIDGE" &&
                            bridgeTopic.length > 3
                        ) {
                            const repA = notes.find(n => n.id === clusters[i][0]);
                            const repB = notes.find(n => n.id === clusters[j][0]);
                            const bridgeContent =
                            `#aigenerated\n\n${bridgeSummary}\n\n` +
                            (repA ? `[[${repA.title}]]\n` : '') +
                            (repB ? `[[${repB.title}]]\n` : '');

                            let safeFileName = bridgeTopic
                            .replace(/^[\s_\-]*bridge[\s_\-]*topic[\s:_\-]*?/i, "") // Remove any leading underscores/spaces/hyphens and "bridge topic"
                            .replace(/[\\/:*?"<>|]/g, "_") // Sanitize special characters
                            .replace(/_+/g, "_")           // Collapse multiple underscores
                            safeFileName =  safeFileName.replace(/^[\s_\-]*bridge[\s_\-]*topic[\s:_\-]*?/i, "") // Remove any leading underscores/spaces/hyphens and "bridge topic"
                            .replace(/[\\/:*?"<>|]/g, "_") // Sanitize special characters
                            .replace(/_+/g, "")           // Collapse multiple underscores
                            .trim() + ".md";
                            await this.app.vault.create(safeFileName, bridgeContent);

                        }
                    }else{
                        new Notice(`Empty cluster found, skipping. {clusterA: ${clusterA}, clusterB: ${clusterB}`);
                    }
                    console.log(`$clusters found: ${clusterA}, ${clusterB}`);
                    new Notice("Bridge notes created (if any meaningful bridges were found).");
                }
            }
        } else {
            new Notice("No clusters found or only one cluster present.");
        }
    }

    public async reindexEmbeddings() {
        const files = this.app.vault.getMarkdownFiles();
        for (const file of files) {
            const content = await this.app.vault.read(file);
            const embedding = await this.llmClient.getEmbedding(content);
            this.embeddingsCache[file.basename] = embedding;
        }
        await this.saveEmbeddingsToFile(this.embeddingsCache);
        new Notice("Embeddings reindexed for all notes.");
    }

    private async saveEmbeddingsToFile(embeddings: Record<string, number[]>, fileName = 'embeddings-cache.json') {
        const filePath = `${fileName}`;
        const content = JSON.stringify(embeddings);
        // Check if file exists
        let file = this.app.vault.getAbstractFileByPath(filePath);
        if (file) {
            await this.app.vault.modify(file as TFile, content);
        } else {
            await this.app.vault.create(filePath, content);
        }
        new Notice(`Embeddings saved to ${filePath}`);
    }

    private async loadEmbeddingsFromFile(fileName = 'embeddings-cache.json'): Promise<Record<string, number[]>> {
        const filePath = `${fileName}`;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!file) return {};
        const content = await this.app.vault.read(file as TFile);
        try {
            return JSON.parse(content);
        } catch {
            return {};
        }
    }
}