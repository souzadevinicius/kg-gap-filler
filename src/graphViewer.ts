// graphAnalyser.ts (fixed version)
import * as d3 from 'd3';
import { Note, sourceTargetPairs } from './graphAnalyser';
import { GapFillerSettings } from './settings';
import { App } from 'obsidian/obsidian';


let wikiModal: {
  element: HTMLElement;
  overlay: HTMLElement;
  iframe: HTMLIFrameElement;
  loading: HTMLElement;
} | null = null;

let hideWikiModalTimeout: number | null = null;

type D3Link = d3.SimulationLinkDatum<Note>;

export class GraphViewer {
  private svg?: d3.Selection<SVGGElement, unknown, null, undefined>;
  private simulation: d3.Simulation<Note, D3Link> | undefined;
  private container: HTMLElement | null = null;
  private width: number = 800;
  private height: number = 600;
  private currentNodes: Note[] = [];
  private currentLinks: D3Link[] = [];
  private nodeFilter: string = '';
  private settings: GapFillerSettings;
  private clickCallback: CallableFunction = () => {};

  constructor(container: HTMLElement | null = null, settings?: GapFillerSettings) {
    this.container = container;
    this.settings = settings || new GapFillerSettings(); // Use passed settings or create a new one ONLY if none are passed
    this.initializeContainer(container);
  }

  private initializeContainer(container: HTMLElement | null) {
    if (!container) return;

    // Make container fill parent
    container.style.width = "100%";
    container.style.height = "100%";
    this.width = container.offsetWidth || 800;
    this.height = container.offsetHeight || 600;




    // Initialize empty SVG
    this.resetSvg();
  }

  public resetSvg() {
    if (!this.container) return;

    // Clear previous content
    // this.container.innerHTML = '';
    const oldSvg = this.container.querySelector('svg');
    if (oldSvg) oldSvg.remove();


    // Create new SVG
    const svg = d3.select(this.container)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `0 0 ${this.width} ${this.height}`)
    .style('display', 'block');

    // Add arrowhead marker definition
    svg.append("defs").append("marker")
    .attr("id", "arrowhead")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 32)
    .attr("refY", 0)
    .attr("markerWidth", 8)
    .attr("markerHeight", 8)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "#888");

    const g = svg.append("g");
    this.svg = g;

    // Set up zoom behavior
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      })
    );

    svg.on("click", () => {
      hideWikiModal();
    });
  }

  public drawGraph(notes: Note[], links: string[][]) {

    try {
      // Stop and remove any previous simulation
      if (this.simulation) {
        this.simulation.stop();
        this.simulation = undefined;
      }

      // Clear existing elements but keep the base SVG structure
      if (this.svg) {
        this.svg.selectAll("*").remove();
      }

      // Initialize nodes with positions if they don't have them
      notes.forEach(n => {
        if (typeof n.x !== 'number' || typeof n.y !== 'number') {
          n.x = this.width * (0.2 + 0.6 * Math.random());
          n.y = this.height * (0.2 + 0.6 * Math.random());
        }
        n.fx = null;
        n.fy = null;
      });

      // Update current state
      this.currentNodes = [...notes];
      this.currentLinks = sourceTargetPairs(links, notes);
      // Create new simulation
      this.simulation = d3.forceSimulation<Note>(notes)
      .force("link", d3.forceLink<Note, D3Link>(this.currentLinks)
      .id(d => d.id)
      .distance(150))
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(this.width / 2, this.height / 2))
      .force("collide", d3.forceCollide(40))
      .alpha(1)
      .on("tick", () => this.tick());

      // Draw links
      if (this.svg) {
        this.svg.append("g")
        .attr("class", "links")
        .selectAll("line")
        .data(this.currentLinks)
        .enter()
        .append("line")
        .attr("stroke", "var(--text-muted)")
        .attr("stroke-width", 1.5)
        .attr("marker-end", "url(#arrowhead)");
      }

      // Draw nodes
      if (this.svg) {
        this.svg.append("g")
        .attr("class", "nodes")
        .selectAll("circle")
        .data(notes)
        .enter()
        .append("circle")
        .attr("r", 24)
        .attr("fill", d => d.isBridge ? "#FFD700" : "var(--interactive-accent)")
        .attr("stroke", "var(--background-primary)")
        .attr("stroke-width", 2)
        .attr("cursor", "grab")
        .on("click", async(event, d) => {
          if (d.isBridge && d.wikiUrl) {
            // Open modal for bridge nodes
            showWikiModal(d.title, d.wikiUrl);
            event.stopPropagation();
          } else if (d.id) {
            // Open note for regular nodes
            await this.clickCallback(d.file);
            event.stopPropagation();
          }
        })
        .call(
          d3.drag<SVGCircleElement, Note>()
          .on("start", this.dragStarted.bind(this))
          .on("drag", this.dragged.bind(this))
          .on("end", this.dragEnded.bind(this))
        );
      }


      // Draw labels
      if (this.svg) {
        this.svg.append("g")
        .attr("class", "labels")
        .selectAll("text")
        .data(notes)
        .enter()
        .append("text")
        .text(d => d.title)
        .attr("font-size", "14px")
        .attr("fill", "var(--text-normal)")
        .attr("dx", 28)
        .attr("dy", "0.35em");
      }
      this.updateForces({
        linkDistance: this.settings.linkDistance,
        linkStrength: this.settings.linkStrength,
        chargeStrength: this.settings.chargeStrength,
        centerStrength: this.settings.centerStrength
      });
      this.updateVisualization(this.currentNodes, this.currentLinks);
    } catch (error) {
      // console.error("Error in GraphViewer.drawGraph:", error);
      // new Notice("Error drawing graph. See console for details.");
    }
  }

  public addNodesAndLinks(newNodes: Note[], newLinks: string[][]) {
    if (!this.simulation) return;

    try {
      // Filter out existing nodes
      const existingIds = new Set(this.currentNodes.map(n => n.id));
      const uniqueNewNodes = newNodes.filter(n => !existingIds.has(n.id));
      if (uniqueNewNodes.length === 0 && newLinks.length === 0) return;

      // Add new nodes (filter undefined ids)
      const updatedNodes = [
        ...this.currentNodes,
        ...uniqueNewNodes.filter(n => n.id !== undefined)
      ];
      this.currentNodes = updatedNodes;

      // Add new links (only if both nodes exist)
      const updatedLinks = [
        ...this.currentLinks,
        ...newLinks
        .map(link => {
          const source = updatedNodes.find(n => n.id === link[0]);
          const target = updatedNodes.find(n => n.id === link[1]);
          return source && target ? { source, target } : null;
        })
        .filter(link => link !== null) as D3Link[]
      ];
      this.currentLinks = updatedLinks;

      // Update simulation
      this.simulation.nodes(updatedNodes);
      (this.simulation.force("link") as d3.ForceLink<Note, D3Link>)
      .links(updatedLinks);

      this.updateVisualization(updatedNodes, updatedLinks);
      this.simulation.alpha(1).restart();
    } catch (error) {
      console.error("Error in GraphViewer.addNodesAndLinks:", error);
      this.destroy();
    }
  }

  public setNodeFilter(filter: string) {
    this.nodeFilter = filter.toLowerCase();
    // Re-apply visualization with current nodes/links
    this.updateVisualization(this.currentNodes, this.currentLinks);
  }

  private getConnectedElements(node: Note) {
    const connectedNodeIds = new Set<string>();
    const connectedLinks: D3Link[] = [];

    // Find all links connected to this node
    this.currentLinks.forEach(link => {
      const sourceId = (link.source as Note).id;
      const targetId = (link.target as Note).id;

      if (sourceId === node.id || targetId === node.id) {
        connectedLinks.push(link);
        if (sourceId !== node.id) connectedNodeIds.add(sourceId);
        if (targetId !== node.id) connectedNodeIds.add(targetId);
      }
    });

    return {
      nodeIds: connectedNodeIds,
      links: connectedLinks
    };
  }
  // Modify the hover effect in updateVisualization method
  private updateVisualization(nodes: Note[], links: D3Link[]) {
    // Update links
    if (!this.svg) return;

    const linkSelection1 = this.svg.select("g.links")
    .selectAll<SVGLineElement, D3Link>("line")
    .data(links, (d: any) => `${d.source.id}-${d.target.id}`);

    linkSelection1.enter()
    .append("line")
    .merge(linkSelection1)
    .attr("stroke", "var(--text-muted)")
    .attr("stroke-width", 1.5)
    .attr("marker-end", "url(#arrowhead)");

    linkSelection1.exit().remove();

    // Determine which nodes match the filter
    const filter = this.nodeFilter;
    const matches = (d: Note) => !filter || d.title.toLowerCase().includes(filter);

    // Update nodes
    const nodeSelection = this.svg.select("g.nodes")
    .selectAll<SVGCircleElement, Note>("circle")
    .data(nodes, (d: any) => d.id);

    const enteredNodes = nodeSelection.enter()
    .append("circle")
    .attr("r", 24)
    .attr("fill", d => d.isBridge ? "#FFD700" : "var(--interactive-accent)")
    .attr("stroke", "var(--background-primary)")
    .attr("stroke-width", 2)
    .attr("cursor", "grab")
    .on("click", async(event, d) => {
      if (d.isBridge && d.wikiUrl) {
        showWikiModal(d.title, d.wikiUrl);
        event.stopPropagation();
      } else if (d.id) {
        await this.clickCallback(d.file);
        event.stopPropagation();
      }
    })
    .call(
      d3.drag<SVGCircleElement, Note>()
      .on("start", this.dragStarted.bind(this))
      .on("drag", this.dragged.bind(this))
      .on("end", this.dragEnded.bind(this))
    );

    // Set initial opacity based on filter
    nodeSelection.merge(enteredNodes)
    .attr("opacity", d => matches(d) ? 1 : 0.2);

    nodeSelection.exit().remove();

    // Update labels
    const labelSelection = this.svg.select("g.labels")
    .selectAll<SVGTextElement, Note>("text")
    .data(nodes, (d: any) => d.id);

    labelSelection.enter()
    .append("text")
    .merge(labelSelection)
    .text(d => d.title)
    .attr("font-size", "14px")
    .attr("fill", "var(--text-normal)")
    .attr("dx", 28)
    .attr("dy", "0.35em")
    .attr("opacity", d => matches(d) ? 1 : 0.2);

    labelSelection.exit().remove();

    // Update links: fade if either node doesn't match
    const linkSelection2 = this.svg.select("g.links")
    .selectAll<SVGLineElement, D3Link>("line")
    .data(links, (d: any) => `${d.source.id}-${d.target.id}`);

    linkSelection2.enter()
    .append("line")
    .merge(linkSelection2)
    .attr("stroke", "var(--text-muted)")
    .attr("stroke-width", 1.5)
    .attr("marker-end", "url(#arrowhead)")
    .attr("opacity", d =>
      matches(d.source as Note) || matches(d.target as Note) ? 1 : 0.2
    );

    linkSelection2.exit().remove();

    // Add hover effect to nodes after (re)creating them
    // Add hover effect to nodes after (re)creating them
    if (this.svg) {
      this.svg.select("g.nodes")
      .selectAll<SVGCircleElement, Note>("circle")
      .on("mouseover", (event, hoveredNode) => {
        // Get connected nodes and links
        const { nodeIds, links: connectedLinks } = this.getConnectedElements(hoveredNode);

        // Fade out non-connected elements
        if (!this.svg) return;

        // Nodes - always highlight hovered and connected nodes regardless of filter
        this.svg.selectAll<SVGCircleElement, Note>("g.nodes circle")
        .attr("opacity", d =>
          d.id === hoveredNode.id || nodeIds.has(d.id) ? 1 : 0.1
        );

        // Labels - always highlight hovered and connected labels regardless of filter
        this.svg.selectAll<SVGTextElement, Note>("g.labels text")
        .attr("opacity", d =>
          d.id === hoveredNode.id || nodeIds.has(d.id) ? 1 : 0.1
        );

        // Links - always highlight connected links regardless of filter
        this.svg.selectAll<SVGLineElement, D3Link>("g.links line")
        .attr("opacity", d => {
          const sourceId = (d.source as Note).id;
          const targetId = (d.target as Note).id;
          return (
            sourceId === hoveredNode.id ||
            targetId === hoveredNode.id ||
            connectedLinks.some(l =>
              (l.source as Note).id === sourceId &&
              (l.target as Note).id === targetId
            )
          ) ? 1 : 0.1;
        });
      })
      .on("mouseout", () => {
        // Restore opacity based on filter (if any)
        if (!this.svg) return;
        const filter = this.nodeFilter;
        const matches = (d: Note) => !filter || d.title.toLowerCase().includes(filter);

        this.svg.selectAll<SVGCircleElement, Note>("g.nodes circle")
        .attr("opacity", d => matches(d) ? 1 : 0.2);
        this.svg.selectAll<SVGTextElement, Note>("g.labels text")
        .attr("opacity", d => matches(d) ? 1 : 0.2);
        this.svg.selectAll<SVGLineElement, D3Link>("g.links line")
        .attr("opacity", d =>
          matches(d.source as Note) || matches(d.target as Note) ? 1 : 0.2
        );
      });
    }
  }


  public updateForces({ linkDistance, linkStrength, chargeStrength, centerStrength }: {
    linkDistance?: number,
    linkStrength?: number,
    chargeStrength?: number,
    centerStrength?: number
  }) {
    if (!this.simulation) return;

    this.settings.linkDistance = linkDistance || 400;
    this.settings.linkStrength = linkStrength || 1;
    this.settings.chargeStrength = chargeStrength || -400;
    this.settings.centerStrength = centerStrength || 1;
    console.log("Updating forces with settings:", this.settings);
    (this.simulation.force("link") as d3.ForceLink<Note, D3Link>).distance(this.settings.linkDistance);
    (this.simulation.force("link") as d3.ForceLink<Note, D3Link>).strength(this.settings.linkStrength);
    (this.simulation.force("charge") as d3.ForceManyBody<Note>).strength(this.settings.chargeStrength);
    this.simulation.alpha(this.settings.centerStrength).restart();
  }

  private dragStarted(event: any, d: Note) {
    if (!event.active && this.simulation) this.simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  private dragged(event: any, d: Note) {
    d.fx = event.x;
    d.fy = event.y;
  }

  private dragEnded(event: any, d: Note) {
    if (!event.active && this.simulation) this.simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }

  private tick() {
    try {
      if (!this.svg) return;

      // Update nodes
      this.svg.selectAll<SVGCircleElement, Note>("g.nodes circle")
      .attr("cx", d => d.x || 0)
      .attr("cy", d => d.y || 0);

      // Update labels
      this.svg.selectAll<SVGTextElement, Note>("g.labels text")
      .attr("x", d => d.x || 0)
      .attr("y", d => d.y || 0);

      // Update links
      this.svg.selectAll<SVGLineElement, D3Link>("g.links line")
      .attr("x1", d => (d.source as Note).x || 0)
      .attr("y1", d => (d.source as Note).y || 0)
      .attr("x2", d => (d.target as Note).x || 0)
      .attr("y2", d => (d.target as Note).y || 0);
    } catch (error) {
      console.error("Error in GraphViewer.tick:", error);
      this.destroy();
    }

  }
  public destroy() {
    if (this.simulation) {
      this.simulation.stop();
      this.simulation = undefined;
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
    this.currentNodes = [];
    this.currentLinks = [];
  }

  public onResize() {
    if (!this.container) return;
    this.width = this.container.offsetWidth || 800;
    this.height = this.container.offsetHeight || 600;

    const svg = this.container.querySelector('svg');
    if (svg) {
      svg.setAttribute('width', `${this.width}px`);
      svg.setAttribute('height', `${this.height}px`);
      svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    }

    if (this.simulation) {
      (this.simulation.force("center") as d3.ForceCenter<Note>)
      .x(this.width / 2)
      .y(this.height / 2);
      this.simulation.alpha(1).restart();
    }
  }

  public setClickCallback(cb: CallableFunction) {
    this.clickCallback = cb
  }


  public setContainer(container: HTMLElement) {
    this.container = container;
    this.width = container.offsetWidth || 800;
    this.height = container.offsetHeight || 600;
  }

  public async parseBridgeResponse(response: string, noteA: Note, noteB: Note): Promise<Note[]> {
    const bridgeList = sanitiseResponse(response);
    for(const bridgeObj of bridgeList){
      if (!bridgeObj || !bridgeObj.title ||  !bridgeObj.link) {
        continue;
      }
      bridgeObj.link = `https://${bridgeObj.link.split("//")[1]}`;
      const bridgeNote: Note = {
        id: bridgeObj?.title,
        title: bridgeObj?.title.replace(/\*\*Bridge Topic:\*\*/g, ' ').replace(/Bridge Topic:/g, ' ').replace(/Bridge topic:/g, " ").replace(/\*/g,''),
        file: noteA.file, // Use repA's file as a placeholder
        content: "",
        links: [noteA.title, noteB.title].filter(Boolean),
        isBridge: true,
        wikiUrl: bridgeObj.link,
        summary: ""
      };
      bridgeList.push(bridgeNote);
    }
    return bridgeList
  }

  public async suggestionsResponse(response: string): Promise<Note[]> {
    const sanitisedResp = sanitiseResponse(response);
    const bridgeList = [];
    for(const bridgeObj of sanitisedResp){
      if (!bridgeObj || !bridgeObj.title ||  !bridgeObj.link) {
        continue;
      }
      bridgeObj.link = `https://${bridgeObj.link.split("//")[1]}`;
      const bridgeNote: Note = {
        id: bridgeObj?.title,
        title: bridgeObj?.title.replace(/\*\*Bridge Topic:\*\*/g, ' ').replace(/Bridge Topic:/g, ' ').replace(/Bridge topic:/g, " ").replace(/\*/g,''),
        file: bridgeObj.file, // Use repA's file as a placeholder
        content: "",
        links: [bridgeObj.source, bridgeObj.target].filter(Boolean),
        isBridge: true,
        wikiUrl: bridgeObj.link,
        summary: ""
      };
      bridgeList.push(bridgeNote);
    }
    return bridgeList
  }
}


function sanitiseResponse(response: string): any[] {
  const bridge = response.replace(/\\n/g, ' ').replace(/```json/g, "").split('```')[0]
  let bridgeList = [];
  try {
    bridgeList = JSON.parse(bridge);
  }catch (error) {
    console.error("Error parsing bridge response:", error);
  }
  finally{
    return bridgeList
  }
}


function showWikiModal(title: string, url: string) {
  // Reuse existing modal if available
  if (wikiModal) {
    updateWikiModal(title, url);
    return;
  }

  // Create overlay
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.right = '0';
  overlay.style.bottom = '0';
  overlay.style.backgroundColor = 'rgba(0,0,0,0.5)';
  overlay.style.zIndex = '9998';
  overlay.style.opacity = '0';
  overlay.style.transition = 'opacity 0.2s ease';
  overlay.onclick = hideWikiModal;

  // Create modal container
  const modal = document.createElement('div');
  modal.id = 'wiki-modal';
  modal.style.position = 'fixed';
  modal.style.top = '50%';
  modal.style.left = '50%';
  modal.style.transform = 'translate(-50%, -50%) scale(0.95)';
  modal.style.width = 'min(90vw, 800px)';
  modal.style.height = 'min(80vh, 600px)';
  modal.style.backgroundColor = 'var(--background-primary)';
  modal.style.borderRadius = '8px';
  modal.style.boxShadow = '0 4px 20px rgba(0,0,0,0.3)';
  modal.style.zIndex = '9999';
  modal.style.display = 'flex';
  modal.style.flexDirection = 'column';
  modal.style.overflow = 'hidden';
  modal.style.border = '1px solid var(--background-modifier-border)';
  modal.style.opacity = '0';
  modal.style.transition = 'all 0.2s ease';

  // Create header
  const header = document.createElement('div');
  header.style.padding = '12px 16px';
  header.style.backgroundColor = 'var(--background-secondary)';
  header.style.borderBottom = '1px solid var(--background-modifier-border)';
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';

  const titleEl = document.createElement('h3');
  titleEl.textContent = title;
  titleEl.style.margin = '0';
  titleEl.style.fontSize = '1.1em';
  titleEl.style.color = 'var(--text-normal)';
  titleEl.style.whiteSpace = 'nowrap';
  titleEl.style.overflow = 'hidden';
  titleEl.style.textOverflow = 'ellipsis';
  titleEl.style.maxWidth = 'calc(100% - 40px)';

  const closeButton = document.createElement('button');
  closeButton.innerHTML = '&times;';
  closeButton.style.background = 'none';
  closeButton.style.border = 'none';
  closeButton.style.fontSize = '1.5em';
  closeButton.style.cursor = 'pointer';
  closeButton.style.color = 'var(--text-muted)';
  closeButton.onclick = hideWikiModal;

  header.appendChild(titleEl);
  header.appendChild(closeButton);

  // Create iframe container
  const iframeContainer = document.createElement('div');
  iframeContainer.style.flex = '1';
  iframeContainer.style.position = 'relative';
  iframeContainer.style.overflow = 'hidden';

  // Create loading indicator
  const loading = document.createElement('div');
  loading.textContent = 'Loading...';
  loading.style.position = 'absolute';
  loading.style.top = '50%';
  loading.style.left = '50%';
  loading.style.transform = 'translate(-50%, -50%)';
  loading.style.color = 'var(--text-muted)';

  // Create iframe
  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  iframe.style.visibility = 'hidden';
  iframe.onload = () => {
    loading.style.display = 'none';
    iframe.style.visibility = 'visible';
  };

  // Assemble components
  iframeContainer.appendChild(loading);
  iframeContainer.appendChild(iframe);
  modal.appendChild(header);
  modal.appendChild(iframeContainer);
  document.body.appendChild(overlay);
  document.body.appendChild(modal);

  // Store reference
  wikiModal = {
    element: modal,
    overlay,
    iframe,
    loading
  };

  // Trigger animation
  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
    modal.style.opacity = '1';
    modal.style.transform = 'translate(-50%, -50%) scale(1)';
  });

  // Add keyboard support
  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') hideWikiModal();
  };
  document.addEventListener('keydown', keyHandler);
  (modal as any)._keyHandler = keyHandler;

  modal.onmouseenter = () => {
    if (hideWikiModalTimeout) {
      clearTimeout(hideWikiModalTimeout);
      hideWikiModalTimeout = null;
    }
  };
  // modal.onmouseleave = () => {
  //   hideWikiModalTimeout = window.setTimeout(() => {
  //     hideWikiModal();
  //     hideWikiModalTimeout = null;
  //   }, 200);
  // };
}



function updateWikiModal(title: string, url: string) {
  if (!wikiModal) return;

  // Update title
  const titleEl = wikiModal.element.querySelector('h3');
  if (titleEl) titleEl.textContent = title;

  // Show loading state
  wikiModal.loading.style.display = 'block';
  wikiModal.iframe.style.visibility = 'hidden';

  // Update iframe source
  wikiModal.iframe.onload = () => {
    if (wikiModal) {
      wikiModal.loading.style.display = 'none';
      wikiModal.iframe.style.visibility = 'visible';
    }
  };
  wikiModal.iframe.src = url;

  // Ensure modal is visible
  wikiModal.element.style.display = 'flex';
  wikiModal.overlay.style.display = 'block';
}

function hideWikiModal() {
  if (!wikiModal) return;

  // Animate out
  wikiModal.overlay.style.opacity = '0';
  wikiModal.element.style.opacity = '0';
  wikiModal.element.style.transform = 'translate(-50%, -50%) scale(0.95)';

  // Remove after animation completes
  setTimeout(() => {
    if (wikiModal) {
      document.removeEventListener('keydown', (wikiModal.element as any)._keyHandler);
      wikiModal.element.remove();
      wikiModal.overlay.remove();
      wikiModal = null;
    }
  }, 200);



}

