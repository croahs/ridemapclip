/** Builds a DOM element for a Leaflet rider tooltip so names are never parsed as HTML. */
export function riderTooltipContent(
  index: number,
  name: string,
  doc: Pick<Document, "createElement"> = document,
): HTMLSpanElement {
  const span = doc.createElement("span");
  span.textContent = `${index + 1}. ${name}`;
  return span;
}
