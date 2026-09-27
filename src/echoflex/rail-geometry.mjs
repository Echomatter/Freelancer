const clamp = (n, max = 1) => Math.max(0, Math.min(max, n));

// Equal space per turn makes short turns reachable beside very long responses.
// The final segment represents the remainder of the last turn and composer.
export function railPosition(offset, anchors, maximum) {
  if (maximum <= 0 || !anchors.length) return 0;
  if (offset >= maximum - 1) return 1;
  const value = clamp(offset, maximum);
  let index = 0;
  while (index + 1 < anchors.length && anchors[index + 1] <= value) index++;
  const start = anchors[index], end = anchors[index + 1] ?? maximum;
  return clamp((index + (end > start ? clamp((value - start) / (end - start)) : 0)) / anchors.length);
}

export function railOffset(position, anchors, maximum) {
  if (!anchors.length || maximum <= 0) return 0;
  const value = clamp(position) * anchors.length;
  const index = Math.min(anchors.length - 1, Math.floor(value));
  const start = anchors[index], end = anchors[index + 1] ?? maximum;
  return clamp(start + (end - start) * (value - index), maximum);
}
