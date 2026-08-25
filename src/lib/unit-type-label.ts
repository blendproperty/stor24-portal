export type UnitTypeDimensions = {
  name: string;
  widthMetres?: unknown;
  lengthMetres?: unknown;
  areaSqMetres?: unknown;
};

function measurement(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && value !== null && value !== ""
    ? number.toLocaleString("en-ZA", { maximumFractionDigits: 2 })
    : null;
}

export function unitTypeSize(type: UnitTypeDimensions) {
  const width = measurement(type.widthMetres);
  const length = measurement(type.lengthMetres);
  const storedArea = measurement(type.areaSqMetres);
  const calculatedArea = width && length
    ? measurement(Number(type.widthMetres) * Number(type.lengthMetres))
    : null;
  const area = storedArea || calculatedArea;

  if (width && length && area) return `${width} m × ${length} m · ${area} m²`;
  if (width && length) return `${width} m × ${length} m`;
  if (area) return `${area} m²`;
  return "Size not recorded";
}

export function unitTypeLabel(type: UnitTypeDimensions) {
  return `${type.name} · ${unitTypeSize(type)}`;
}
