// graphAnalyser.ts (fixed version)
import * as d3 from 'd3';

// Define Note interface if not already in separate file
export interface Note {
  id: string;
  title: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

type D3Link = d3.SimulationLinkDatum<Note>;

export class GraphViewer {
  private svg: d3.Selection<SVGGElement, unknown, null, undefined>;
  private simulation: d3.Simulation<Note, D3Link> | undefined;
  private container: HTMLElement | null = null;
  private width: number = 0;
  private height: number = 0;

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container with ID "${containerId}" not found.`);
    }
    this.container = container;

    // Make container fill parent
    this.container.style.width = "100%";
    this.container.style.height = "100%";
    this.width = this.container.offsetWidth || 800;
    this.height = this.container.offsetHeight || 600;

    // Remove any previous SVGs
    this.container.innerHTML = '';

    // Create SVG that fills the container
    const svg = d3.select(this.container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', `0 0 ${this.width} ${this.height}`)
      .style('display', 'block');

    // Add arrowhead marker definition to the SVG
    svg.append("defs").append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 32) // Should be >= node radius
      .attr("refY", 0)
      .attr("markerWidth", 8)
      .attr("markerHeight", 8)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#888"); // Use a visible color for testing

    const g = svg.append("g");
    this.svg = g;

    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 4])
        .on("zoom", (event) => {
          g.attr("transform", event.transform);
        })
    );
  }

  public setContainer(container: HTMLElement) {
    this.container = container;
    this.width = container.offsetWidth || 800;
    this.height = container.offsetHeight || 600;
  }

  public drawGraph(notes: Note[], links: string[][]) {
    if (!this.container) {
      throw new Error("Container is not set.");
    }

    // Assign random initial positions within the SVG area
    notes.forEach(n => {
      n.x = this.width * (0.2 + 0.6 * Math.random());
      n.y = this.height * (0.2 + 0.6 * Math.random());
    });

    // Convert links to D3 format with object references
    const d3Links: D3Link[] = links.map(link => ({
      source: notes.find(n => n.id === link[0])!,
      target: notes.find(n => n.id === link[1])!
    }));

    // Clear previous
    if (this.simulation) {
      this.simulation.stop();
    }
    this.svg.selectAll("*").remove();

    // Force simulation
    this.simulation = d3.forceSimulation<Note>(notes)
      .force("link", d3.forceLink<Note, D3Link>(d3Links)
        .id(d => d.id)
        .distance(150)
      )
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(this.width / 2, this.height / 2))
      .force("collide", d3.forceCollide(40))
      .alpha(1) // Start with full energy
      .on("tick", () => this.tick());

    // Links
    const link = this.svg.append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(d3Links)
      .enter()
      .append("line")
      .attr("stroke", "var(--text-muted)")
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#arrowhead)"); // <-- This must match the marker id

    // Nodes
    const node = this.svg.append("g")
      .attr("class", "nodes")
      .selectAll("circle")
      .data(notes)
      .enter()
      .append("circle")
      .attr("r", 24)
      .attr("fill", "var(--interactive-accent)")
      .attr("stroke", "var(--background-primary)")
      .attr("stroke-width", 2)
      .attr("cursor", "grab")
      .call(
        d3.drag<SVGCircleElement, Note>()
          .on("start", (event, d) => {
            if (!event.active && this.simulation) this.simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active && this.simulation) this.simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    // Labels
    const label = this.svg.append("g")
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

  private tick() {
    // Update nodes
    this.svg.selectAll<SVGCircleElement, Note>("g.nodes circle")
      .attr("cx", d => d.x!)
      .attr("cy", d => d.y!);

    // Update labels
    this.svg.selectAll<SVGTextElement, Note>("g.labels text")
      .attr("x", d => d.x!)
      .attr("y", d => d.y!);

    // Update links
    this.svg.selectAll<SVGLineElement, D3Link>("g.links line")
      .attr("x1", d => (d.source as Note).x!)
      .attr("y1", d => (d.source as Note).y!)
      .attr("x2", d => (d.target as Note).x!)
      .attr("y2", d => (d.target as Note).y!);
  }

  // Add cleanup method
  public destroy() {
    if (this.simulation) {
      this.simulation.stop();
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
    this.svg?.remove();
  }

  onResize() {
    if (!this.container) return;
    const svg = this.container.querySelector('svg');
    if (svg) {
      svg.setAttribute('width', `${this.container.offsetWidth}px`);
      svg.setAttribute('height', `${this.container.offsetHeight}px`);
    }
  }
}
