// The three reading depths and the route each one takes through the workspace.
// Surf is a skim. Swim adds close reading and appraisal. Dive Deep also places the paper among existing work.
export const depths = {
  surf: { label: "Surf", path: ["orient", "place", "judge"] },
  swim: { label: "Swim", path: ["orient", "place", "reconstruct", "appraise", "test", "judge"] },
  "dive-deep": { label: "Dive Deep", path: ["orient", "place", "reconstruct", "appraise", "test", "connect", "judge"] },
};

export function depthLabel(depth) {
  return depths[depth]?.label || "";
}

export function pathFor(depth) {
  return depths[depth].path;
}

// Where a reader picks up when they move to a deeper route: the first stage the earlier route did not include.
export function firstNewStage(fromDepth, toDepth) {
  const earlier = pathFor(fromDepth);
  const later = pathFor(toDepth);
  return later.find((id) => !earlier.includes(id)) || later[later.length - 1];
}
