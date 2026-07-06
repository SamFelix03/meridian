/** Cap agent bid advance to min(face value, mandate max exposure). */
export function capAdvanceAmount(
  advanceAmount: string,
  faceValue: string,
  maxExposure: string
): string {
  const advance = Number(advanceAmount);
  const face = Number(faceValue);
  const max = Number(maxExposure);
  if (!Number.isFinite(advance) || advance <= 0) return faceValue;
  const ceiling = Math.min(
    Number.isFinite(face) && face > 0 ? face : advance,
    Number.isFinite(max) && max > 0 ? max : advance
  );
  const capped = Math.min(advance, ceiling);
  return String(capped);
}
