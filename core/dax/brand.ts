interface Brand {
  name: string;
  expanded: string;
  category: string;
  sdlc: string;
}

export const DAX_BRAND: Brand = {
  name: "DAX",
  expanded: "Deterministic AI Execution",
  category: "Policy-driven execution",
  sdlc: "Governed delivery with traceable automation",
};

export function productTitle(): string {
  return DAX_BRAND.name;
}
