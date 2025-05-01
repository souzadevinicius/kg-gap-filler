// graphAnalyser.ts (updated)
// Add this at the top of your existing file
import * as d3 from 'd3';
import { Note } from './graphAnalyser';

type D3Link = d3.SimulationLinkDatum<Note>;

export class GraphViewer {
  private svg: d3.Selection<SVGGElement, unknown, null, undefined>;
  private graphContainer: HTMLElement;
  private simulation: d3.Simulation<Note, D3Link> | undefined;

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container with ID "${containerId}" not found.`);
    }
    this.graphContainer = container;

    const svg = d3.select(this.graphContainer)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%");

    const g = svg.append("g");

    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .on("zoom", (event) => {
          g.attr("transform", event.transform);
        })
    );

    this.svg = g;
  }

  public drawGraph(notes: Note[], links: string[][]) {
    const width = this.graphContainer.clientWidth;
    const height = this.graphContainer.clientHeight;

    // Convert links to D3 format
    const d3Links: D3Link[] = links.map(link => ({
      source: link[0],
      target: link[1]
    }));

    // Clear previous simulation if exists
    if (this.simulation) {
      this.simulation.stop();
      this.svg.selectAll("*").remove();
    }

    // Force simulation setup
    this.simulation = d3.forceSimulation<Note>(notes)
      .force("link", d3.forceLink<Note, D3Link>(d3Links)
        .id(d => d.id)
        .distance(100)
      )
      .force("charge", d3.forceManyBody<Note>().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .on("tick", () => this.tick());

    // Create links
    const link = this.svg.append("g")
      .attr("stroke", "#999")
      .attr("stroke-width", 1)
      .selectAll("line")
      .data(d3Links)
      .enter()
      .append("line")
      .attr("stroke", "#999");

    // Create nodes
    const node = this.svg.append("g")
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5)
      .selectAll("circle")
      .data(notes)
      .enter()
      .append("circle")
      .attr("r", 20)
      .attr("fill", "steelblue")
      .attr("id", d => d.id);

    // Create labels
    const label = this.svg.append("g")
      .attr("font-size", 12)
      .selectAll("text")
      .data(notes)
      .enter()
      .append("text")
      .text(d => d.title)
      .attr("dy", "0.35em");

    // Drag functionality
    const drag = d3.drag<SVGCircleElement, Note>()
      .on("start", (event) => {
        if (!event.active && this.simulation) this.simulation.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
      })
      .on("drag", (event) => {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
      })
      .on("end", (event) => {
        if (!event.active && this.simulation) this.simulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
      });

    node.call(drag);
  }

  private tick() {
    // Update nodes
    this.svg.selectAll<SVGCircleElement, Note>("circle")
      .attr("cx", d => d.x!)
      .attr("cy", d => d.y!);

    // Update labels
    this.svg.selectAll<SVGTextElement, Note>("text")
      .attr("x", d => d.x! + 25)  // Offset from node
      .attr("y", d => d.y!);

    // Update links
    this.svg.selectAll<SVGLineElement, D3Link>("line")
      .attr("x1", d => {
        if (typeof d.source === 'string') return 0;
        return (d.source as Note).x!;
      })
      .attr("y1", d => {
        if (typeof d.source === 'string') return 0;
        return (d.source as Note).y!;
      })
      .attr("x2", d => {
        if (typeof d.target === 'string') return 0;
        return (d.target as Note).x!;
      })
      .attr("y2", d => {
        if (typeof d.target === 'string') return 0;
        return (d.target as Note).y!;
      });
  }
}
