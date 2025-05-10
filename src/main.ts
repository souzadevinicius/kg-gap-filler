// src/main.ts

import { GraphAnalyser, sourceTargetPairs } from './graphAnalyser';
import { GapDetector } from './gapDetector';
import { LLMClient } from './lmmClient';
import { GraphViewer } from './graphViewer';
import { Note } from './graphAnalyser';
import { Plugin, TFile, Notice, MarkdownView, App, PluginSettingTab, Setting, FileSystemAdapter } from 'obsidian';
import { GapFillerSettings } from './settings';
import { EmbeddingUtils } from './embeddingUtils';
import * as crypto from 'crypto'; // Add this at the top of the file
import * as path from 'path';
import { FileUtils } from './fileUtils';

export default class KGGapFiller extends Plugin {
    settings!: GapFillerSettings;
    private isRunning = false; // Class property to track running state

    private analyser!: GraphAnalyser;
    private detector!: GapDetector;
    private llmClient!: LLMClient;
    private viewer!: GraphViewer;
    private embeddingUtils!: EmbeddingUtils;
    private latestFile?: Note;
    private latestSim: number = 1;
    private notes: Note[] = [];
    private vaultPath: string = (this.app.vault.adapter as any).basePath;
    private cachePath: string = './.cache/'

    public clusters: string[][] = [];
    public shallowNotes: Note[] = [];
    public shallowLinks: string[][] = [];
    private fileUtils: FileUtils = new FileUtils();
    private currentRunToken: number = 0;

    // Helper: robustly get the last active Markdown file
    private getCurrentMarkdownFile(app: App): TFile | null {
        const leaf = app.workspace.getMostRecentLeaf();
        if (leaf && leaf.view instanceof MarkdownView) {
            return leaf.view.file;
        }
        return app.workspace.getActiveFile(); // Reset if no valid file found
    }

    async onload() {
        console.log('KGGapFiller plugin loaded');
        this.fileUtils.createFolder([path.join(this.vaultPath, './embeddings'), path.join(this.vaultPath, this.cachePath)]
        );
        this.analyser = new GraphAnalyser();
        this.detector = new GapDetector();

        await this.loadSettings();
        this.settings.similarityThreshold = this.settings.similarityThreshold || .75
        this.embeddingUtils = new EmbeddingUtils(this.app, this.settings);
        this.llmClient = new LLMClient('http://localhost:1234/v1/chat/completions');

        this.addRibbonIcon('dot-network', 'Show D3 Graph', async () => {
            // Remove any previous container from the DOM (cleanup)
            const old = document.getElementById('graph-container');
            if (old && old.parentElement) old.parentElement.removeChild(old);

            this.ensureSingleRightPaneAndRun();

        });

        this.addCommand({
            id: 'fill-gap-bridges',
            name: 'Fill Gaps Using Bridges',
            callback: async () => await this.run(this.getCurrentMarkdownFile(this.app)?.path ?? null, 1)
        });

        // Watch for new or modified markdown files and update the graph if the container is visible
        this.registerEvent(
            this.app.vault.on('create', async (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.ensureSingleRightPaneAndRun();

                }
            })
        );

        this.registerEvent(
            this.app.workspace.on('file-open', async (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    await this.ensureSingleRightPaneAndRun();
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('modify', async (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.ensureSingleRightPaneAndRun();

                }
            })
        );

        this.addCommand({
            id: 'reindex-embeddings',
            name: 'Reindex Note Embeddings',
            callback: () => this.embeddingUtils.reindexEmbeddings()
        });
    }


    private async openNote(filePath: string) {
        // Check if we have access to the Obsidian app
        try {
            if (typeof this.app === 'undefined' || !this.app.workspace) {
                console.error('Obsidian app not available');
                return;
            }
            let mainLeaf = this.app?.workspace?.getMostRecentLeaf?.();
            if (!mainLeaf) return;

            // Get the file by path
            const targetFile = this.app.vault.getAbstractFileByPath(filePath);


            if (mainLeaf) {
                // Close current file if open (cleaner transition)
                if (mainLeaf.view instanceof MarkdownView && mainLeaf.view.file) {
                    await mainLeaf.setViewState({ type: 'empty' });
                }

                // Open new file
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (file instanceof TFile) {
                    await mainLeaf.openFile(file, { active: true });
                } else {
                    new Notice(`Target file is not a valid TFile: ${file?.path ?? 'unknown'}`);
                }
                this.app.workspace.setActiveLeaf(mainLeaf);
            }
        } catch (error) {
            console.error("Error opening note:", error);
        }
    }


    private async ensureSingleRightPaneAndRun(): Promise<void> {
        const activeFile = this.getCurrentMarkdownFile(this.app);
        this.isRunning = (this.latestFile?.id === activeFile?.basename) && activeFile !== null;
        if (this.isRunning) return;

        try {
            const container = this.createContainer();
            if (!container) return;
            // 1. First, ensure we have exactly one right leaf
            let leaf = this.app.workspace.getLeavesOfType('empty').find(l => l.getRoot() === this.app.workspace.rightSplit);

            // If no suitable leaf exists, create one properly
            if (!leaf) {
                // Close any existing empty right leaves to prevent splits
                this.app.workspace.getLeavesOfType('empty')
                    .filter(l => l.getRoot() === this.app.workspace.rightSplit)
                    .forEach(l => l.detach());

                // Create exactly one new leaf in the right split
                const maybeLeaf = this.app.workspace.getRightLeaf(false);
                leaf = maybeLeaf === null ? undefined : maybeLeaf;
                if (leaf) {
                    await leaf.setViewState({ type: "empty", active: true });
                } else {
                    throw new Error("Failed to create or find a right leaf.");
                }
            }

            // 2. Clean up any existing containers
            const old = document.getElementById('graph-container');
            if (old?.parentElement) old.parentElement.removeChild(old);


            leaf.view.containerEl.empty();
            leaf.view.containerEl.appendChild(container);
            this.viewer.setClickCallback(this.openNote.bind(this));
            this.viewer.setContainer(container);

            // --- Add filter input ---
            const filterInput = container.querySelector<HTMLInputElement>('#graph-node-filter');
            if (filterInput) {
                filterInput.addEventListener('input', (e) => {
                    const value = (e.target as HTMLInputElement).value;
                    this.viewer.setNodeFilter(value);
                });
            }
            // ------------------------

            // 4. Run the visualization
            if (!activeFile) return;

            await this.run(this.getCurrentMarkdownFile(this.app)?.path ?? null, 1)
        } catch (error) {
            console.log(error)
            // this?.viewer?.destroy();
            // setTimeout(async () => {
            //     this.isRunning = false;
            //     await this.run(this.getCurrentMarkdownFile(this.app), 1, true)
            // }, 1000);
        } finally {
            this.isRunning = false;
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, this.settings, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private createContainer(): HTMLElement | null {
        if (this.isRunning) {
            this.isRunning = false;
            return null;
        }
        const container = document.createElement('div');
        container.id = 'graph-container';
        container.innerHTML = `
        <div>
            <!-- Filter input -->
            <div style="margin: 8px 0; text-align: right;">
                <input type="text"
                       id="graph-node-filter"
                       placeholder="Filter nodes by title..."
                       style="margin-right: 10px; padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px;">
            </div>



            <!-- Context toggle -->
            <div style="margin: 8px 0; text-align: left;">
            <label>
            Use Context
            <input type="checkbox" id="use-context-checkbox" ${this.settings.useContext ? 'checked' : ''}>
            </label>
            </div>

            <!-- Embeddings toggle -->
            <div style="margin: 8px 0; text-align: left;">
                <label>
                    Use Embeddings
                    <input type="checkbox" id="use-embeddings-checkbox" ${this.settings.useEmbeddings ? 'checked' : ''}>
                </label>
            </div>
            <!-- Similarity Threshold -->
            <div style="margin: 8px 0; text-align: left;" id='simcontainer'>
                <label>
                    Similarity Threshold:
                    <input
                        type="number"
                        id="similarity-threshold"
                        min="0"
                        max="1"
                        step="0.01"
                        value=${this.settings.similarityThreshold}
                        defaultValue="${this.settings.similarityThreshold || 0.75}"
                        style="margin-left: 10px; width: 60px;"
                    >
                </label>
            </div>



            <!-- Vertical controls -->
            <div id="graph-controls" style="margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <label style="min-width: 120px;">Link Distance:</label>
                    <input type="range" id="linkDistance" min="50" max="400" value="${this.settings.linkDistance || 400}" style="flex: 1;">
                </div>
            </div>

            <!-- Textarea and submit button at the bottom -->
            <div id="graph-textarea-container" style="margin-top: 12px; display: flex; gap: 8px; align-items: flex-end;">
                <textarea id="graph-textarea" rows="2" style="flex:1; resize: vertical; border-radius: 4px; border: 1px solid #ccc; padding: 6px;" placeholder="Type your message..."></textarea>
                <button id="graph-submit-btn" style="padding: 6px 16px; border-radius: 4px; border: none; background: var(--interactive-accent); color: white; font-weight: bold;">Submit</button>
            </div>
            <!-- Graph container -->
            <div id="d3-graph-container" style="height: calc(100% - 120px);"></div>
        </div>
    `;

        // Handle checkbox change
        const useEmbeddingsCheckbox = container.querySelector<HTMLInputElement>('#use-embeddings-checkbox');
        useEmbeddingsCheckbox?.addEventListener('change', (e) => {
            const isChecked = (e.target as HTMLInputElement).checked;
            this.settings.useEmbeddings = isChecked;
            this.latestFile = undefined; // Reset the latest file to force refresh
            // const similarityThresholdElement = document.getElementById('simcontainer');
            // if (similarityThresholdElement) {
            //     if (isChecked) {
            //         similarityThresholdElement.style.display = '';
            //     } else {
            //         similarityThresholdElement.style.display = 'none';
            //     }
            // }
            this.settings.useEmbeddings = isChecked;
            if (similarityThresholdInput) {
                similarityThresholdInput.disabled = !isChecked;
            }
            this.run(this.getCurrentMarkdownFile(this.app)?.path ?? null, 1);
            this.saveSettings(); // Save the updated setting
        });

        // Handle similarity threshold change
        const similarityThresholdInput = container.querySelector<HTMLInputElement>('#similarity-threshold');
        similarityThresholdInput?.addEventListener('input', (e) => {
            const value = parseFloat((e.target as HTMLInputElement).value);
            const fValue = parseFloat(similarityThresholdInput.value);
            this.settings.similarityThreshold = fValue >= .75 && fValue <= 1 ? fValue : .75;
            this.saveSettings(); // Save the updated setting
            this.run(this.getCurrentMarkdownFile(this.app)?.path ?? null, 1);
        });

        const textarea = container.querySelector<HTMLTextAreaElement>('#graph-textarea');
        const submitBtn = container.querySelector<HTMLButtonElement>('#graph-submit-btn');

        const submitHandler = async () => {
            const value = textarea?.value.trim();
            if (textarea) textarea.value = '';
            await this.ask(value ?? "");
        };

        submitBtn?.addEventListener('click', submitHandler);

        textarea?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitHandler();
            }
        });

        this.viewer = new GraphViewer(container, this.settings);

        container.querySelector('#linkDistance')!.addEventListener('input', (e) => {
            this.viewer.updateForces({ linkDistance: +(e.target as HTMLInputElement).value });
        });

        return container;
    }

    private async ask(question: string) {
        if (!question || question.trim() === "") {
            return "";
        }
        this.showLoading("Generating response...");

        const actualNote = await this.getCurrentMarkdownFile(this.app);
        let prompt = ''
        if (!actualNote || !this.settings.useContext) {
            prompt = `Given the topics: ${question} suggest most relevant topics, or entity that could serve as an answer.
                                For connecting purposes in the response show how the topics are related to each other using a source, target structure. Source and target must have its titles as ids.
                                Return ONLY the three most relevant topics and the wikipedia article url in a json array object with e.g {title:'title', link: 'link', source:'source', target:'target'}.
                                If no meaningful topics exists, reply with [] try it in english or portuguese.`;
        } else {
            const topics = sourceTargetPairs(this.shallowLinks, this.shallowNotes).map(pair => [pair.source.title, pair.target.title]).flat();
            const topicsNoDup = [...new Set(topics)].join(', ');
            prompt = `Given the topics: ${question} suggest most relevant topics, or entity that could serve as an answer.
                                                    For connecting purposes in the response show how the topics are related to each other using a source, target structure. Source and target must have its titles as ids.
                                                    Try to use these topics as source as much as possible: ${topicsNoDup}.
                                                    Return ONLY the three most relevant topics and the wikipedia article url in a json array object with e.g {title:'title', link: 'link', source:'source', target:'target'}.
                                                    If no meaningful topics exists, reply with [] try it in english or portuguese.`;
        }
        const response = await this.llmClient.generateContent(prompt);
        let bridgeList = await this.viewer.suggestionsResponse(response);
        try {
            // Helper function to check if two notes are connected
            const areNotesConnected = (a: Note, b: Note) =>
                a.id === b.id ||
                a.links.includes(b.id) ||
                b.links.includes(a.id) ||
                (b.links[0] && (a.id === b.links[0] || a.links.includes(b.links[0]))) ||
                (b.links[1] && (a.id === b.links[1] || a.links.includes(b.links[1])));

            // Get all notes connected to the bridgeList
            const possibleNewNotes = this.notes.filter(n =>
                bridgeList.some(b => areNotesConnected(n, b))
            );

            // // Expand to notes connected to the connected notes
            // possibleNewNotes = this.notes.filter(n =>
            //     possibleNewNotes.some(b => areNotesConnected(n, b))
            // );

            // Merge and deduplicate notes
            const merged = Array.from(new Map(
                [...possibleNewNotes, ...bridgeList]
                    .sort((a, b) => {
                        const aIsLinked = possibleNewNotes.some(n => n.links.includes(a.id));
                        const bIsLinked = possibleNewNotes.some(n => n.links.includes(b.id));

                        if (aIsLinked !== bIsLinked) {
                            return aIsLinked ? -1 : 1;
                        }

                        // Secondary sort by link length
                        const lengthDiff = a.links.length - b.links.length;
                        if (lengthDiff !== 0) {
                            return lengthDiff;
                        }

                        // Tertiary sort by title
                        return a.title.localeCompare(b.title);
                    })
                    .map(note => [note.id, note])
            ).values());

            // Add nodes and links to viewer
            merged.forEach(bridgeNote => {
                this.viewer.addNodesAndLinks(
                    [bridgeNote],
                    [
                        [bridgeNote.title, bridgeNote.links[0]],
                        [bridgeNote.id, bridgeNote.links[1]]
                    ],
                );
            });
        } catch (error) {
            console.error("Error adding nodes and links:", error);
        } finally {
            this.hideLoading()
        }
        new Notice("Bridge notes created (if any meaningful bridges were found).");
    }

    private async getClusters(depth: number, filePath: string): Promise<{ clusters: string[][], shallowNotes: Note[], shallowLinks: string[][] }> {
        if (this.settings.useEmbeddings)
            return this.embeddingUtils.getClusterByEmbedding(this.notes, filePath, 1);

        // Use concrete links with depth limitation
        const activeNote = this.notes.find(n => n.filePath && n.filePath === filePath);
        if (!activeNote) {
            new Notice("Active note not found in notes array.");
            return { clusters: [], shallowNotes: [], shallowLinks: [] };
        }

        // Depth-limited traversal
        let currentLevel = new Set<string>([activeNote.id]);
        let allIncluded = new Set<string>([activeNote.id]);

        for (let d = 0; d < depth; d++) {
            const nextLevel = new Set<string>();
            for (const id of currentLevel) {
                const node = this.notes.find(n => n.id === id);
                if (!node) continue;

                // Outgoing links
                node.links.forEach(l => {
                    if (!allIncluded.has(l)) nextLevel.add(l);
                });

                // Incoming links (if needed)
                this.notes.forEach(n => {
                    if (n.links.includes(node.id) && !allIncluded.has(n.id)) {
                        nextLevel.add(n.id);
                    }
                });
            }

            nextLevel.forEach(id => allIncluded.add(id));
            currentLevel = nextLevel;
        }

        // Only analyze notes within depth limit
        const shallowNotes = this.notes.filter(n => allIncluded.has(n.id));

        return {
            clusters: this.detector.findClustersFromSubgraph(shallowNotes),
            shallowNotes: shallowNotes,
            shallowLinks: this.buildLinks(shallowNotes)
        };
    }

    private generateClusterID(clusterA: string, clusterB: string) {
        const concatenatedClusters = `${clusterA}-${clusterB}`;
        return crypto.createHash('md5').update(concatenatedClusters).digest('hex');
    }

    private async getSuggestionFromClusterID(clusterID: string) {
        try {
            const fpath = path.join(this.cachePath, `${clusterID}.json`)
            const content = await this.app.vault.adapter.read(fpath);
            const parsed = JSON.parse(content);
            return parsed;
        } catch (error) {
            return null;
        }
    }

    public async run(filePath: string | null, depth: number = 1): Promise<void> {
        const runToken = ++this.currentRunToken;
        if (!filePath) return;


        try {
            this.showLoading("Finding clusters and bridges...");
            // Build notes array as before
            const files = this.app.vault.getMarkdownFiles();
            const notes: Note[] = [];
            for (const file of files) {
                const content = await this.app.vault.read(file);
                notes.push({
                    id: file.basename,
                    title: file.basename,
                    filePath: file.path,
                    links: this.analyser['extractLinks'](content)
                });
            }
            this.notes = notes;
            const activeNote = this.notes.find(n => n && n.filePath === filePath);
            if (this.latestFile && this.latestFile.id === activeNote?.id && this.latestSim === this.settings.similarityThreshold) return;

            if (!activeNote) {
                new Notice("Active note not found in notes array.");
                return;
            }

            let { clusters, shallowNotes, shallowLinks } = await this.getClusters(depth, filePath);

            this.clusters = clusters;
            this.shallowNotes = shallowNotes;
            this.shallowLinks = shallowLinks;

            console.log(`clusters found: ${clusters.length}`);
            console.log(`shallowNotes found: ${shallowNotes.length}`);
            console.log(`shallowLinks found: ${shallowLinks.length}`);

            const topicsSearched: string[] = [];
            this.latestFile = activeNote

            try {
                this.viewer?.drawGraph(shallowNotes, shallowLinks);
            } catch (error) {
            }
            const seenClusters: string[] = [];
            if (clusters.length < 1) return;
            let bridgeCreated = false; // Add this before the for loops

            for (let i = 0; i < clusters.length; i++) {
                for (let j = i + 1; j < clusters.length; j++) {
                    if (seenClusters.includes(clusters[i].toString()) && seenClusters.includes(clusters[j].toString())) {
                        continue;
                    }
                    const clusterA = clusters[i].map(id => this.notes.find(n => n.id === id)?.title).filter(Boolean);
                    const clusterB = clusters[j].map(id => this.notes.find(n => n.id === id)?.title).filter(Boolean);
                    seenClusters.push(clusterA.join(','), clusterB.join(','));


                    // Pick representative notes from each cluster (first note in each cluster)
                    const repB = this.notes.find(n => n.id === clusters[j][0]);
                    const repA = this.notes.find(n => n.id === clusters[i][0]);

                    if (clusterA.length < 1 || clusterB.length < 1 || !repA || !repB) {
                        new Notice(`Empty cluster found, skipping. {clusterA: ${clusterA}, clusterB: ${clusterB}}`);
                        continue;
                    }
                    if (topicsSearched.includes(clusterA.join(',')) && topicsSearched.includes(clusterB.join(','))) {
                        continue;
                    }
                    let bridgeList = [];

                    const clusterID = this.generateClusterID(clusterA.join(','), clusterB.join(','));
                    bridgeList = await this.getSuggestionFromClusterID(clusterID);

                    if (bridgeList === null) {
                        bridgeList = await this.askLLMUsingCluster(
                            clusterA.filter((item): item is string => item !== undefined),
                            clusterB.filter((item): item is string => item !== undefined),
                            repA,
                            repB,
                            clusterID
                        );

                    }
                    topicsSearched.push(clusterA.join(','), clusterB.join(','));
                    try {
                        bridgeList.forEach((bridgeNote: Note) => {
                            if (runToken !== this.currentRunToken) {
                                this.hideLoading();
                                return;
                            }
                            this.viewer.addNodesAndLinks(
                                [bridgeNote],
                                [[bridgeNote.id, repA.id], [bridgeNote.id, repB.id]],
                            );
                        });
                        bridgeCreated = true; // Set flag if a bridge is created
                    } catch (error) {
                        setTimeout(async () => {
                            await this.run(activeNote.filePath, 1);
                        }, 500)
                    }
                    console.log(`$clusters found: ${clusterA}, ${clusterB}`);
                }
            }

            // After the loops, show the notice only if a bridge was created and clusters are valid
            if (clusters.length > 1 && bridgeCreated) {
                new Notice("Bridge notes created (if any meaningful bridges were found).");
                this.hideLoading();
                return;
            }
            new Notice("No clusters found or only one cluster present.");
        } finally {
            this.latestSim = this.settings.similarityThreshold;
            this.hideLoading();
        }
    }
    private async askLLMUsingCluster(
        clusterA: string[],
        clusterB: string[],
        repA: Note,
        repB: Note,
        clusterID: any
    ) {
        // Improved prompt: strict, clear, and prevents hallucination
        const prompt = `
      Given the JSON array provided in the web context, output a JSON array of objects in the exact format:
      [{"title": "...", "link": "..."}, ...]
      Use only the information from the web context. Do not invent or add data. Return only the JSON array, with no extra text or formatting.
      for the title value, summarise in max 3 words what is in text content and replace the title property using its summary`;

        // Call the LLM with context
        const mergedClusters = clusterA.concat(clusterB);
        const combinatorialClusters = this.combinations(mergedClusters, 2);
        let bridgeList: any[] = [];
        for (const c of combinatorialClusters) {
            const responseRaw = await this.llmClient.generateContentWithContext(
                prompt,
                [c[0], c[1]].join('+')
            );

            // Clean and extract JSON from LLM response
            let response = responseRaw
                .replace(/```json/g, "")
                .replace(/\\n/g, ' ').replace(/```json/g, "").split('```')[0];
            // Validate and parse JSON
            try {
                const b = await this.viewer.parseBridgeResponse(response, repA, repB);
                const bridgeListMinified = JSON.stringify(b); // Minified JSON
                const cacheFPath = path.join(this.cachePath, `${clusterID}.json`)
                await this.app.vault.adapter.write(cacheFPath, bridgeListMinified);
                bridgeList = bridgeList.concat(b);
            } catch (error) {
                console.error(error);
            }
        }
        return bridgeList
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



    private showLoading(message: string = "Loading...") {
        const container = document.getElementById('graph-container');
        if (!container) return;
        let loading = document.getElementById('graph-loading');
        if (!loading) {
            loading = document.createElement('div');
            loading.id = 'graph-loading';
            loading.setAttribute('style', `
                position: absolute;
                top: 40%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: var(--background-secondary, #fff);
                color: var(--text-normal, #333);
                padding: 16px 32px;
                border-radius: 8px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                z-index: 1000;
                font-size: 1.2em;
                text-align: center;
            `);
            container.appendChild(loading);
        }
        loading.textContent = message;
        loading.style.display = 'visible';
    }

    private hideLoading() {
        const loading = document.getElementById('graph-loading');
        if (loading) loading.style.display = 'none';
    }
    private combinations<T>(arr: T[], k: number): T[][] {
        if (k === 0) return [[]];
        if (arr.length < k) return [];
        const result: T[][] = [];
        for (let i = 0; i <= arr.length - k; i++) {
            const head = arr[i];
            const tailCombos = this.combinations(arr.slice(i + 1), k - 1);
            for (const tail of tailCombos) {
                result.push([head, ...tail]);
            }
        }
        return result;
    }
}

