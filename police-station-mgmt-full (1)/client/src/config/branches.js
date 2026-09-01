// Single source of truth for this station's branches, mirrored from
// server/src/config/branches.js. Keep both in sync until branches are
// moved into a database-managed list.
//
// isGeneralPool marks the branch that acts as the floating officer pool:
// officers whose department is this branch aren't tied to one branch and
// are the first candidates considered when another branch is short-staffed.

export const BRANCHES = [
  {
    value: "Administration Branch (පාලන අංශය)",
    label: "Administration Branch (පාලන අංශය)",
    isGeneralPool: false,
  },
  {
    value: "Complaint Branch / Minor Complaints (පැමිණිලි අංශය)",
    label: "Complaint Branch / Minor Complaints (පැමිණිලි අංශය)",
    isGeneralPool: false,
  },
  {
    value: "Traffic Branch (ගමනාගමන අංශය)",
    label: "Traffic Branch (ගමනාගමන අංශය)",
    isGeneralPool: false,
  },
  {
    value: "Children & Women Bureau (ළමා හා කාන්තා කාර්යාංශය)",
    label: "Children & Women Bureau (ළමා හා කාන්තා කාර්යාංශය)",
    isGeneralPool: false,
  },
  {
    value: "General Duty Branch (සාමාන්‍ය රාජකාරි අංශය)",
    label: "General Duty Branch (සාමාන්‍ය රාජකාරි අංශය)",
    isGeneralPool: true,
  },
];

export const GENERAL_POOL_BRANCH =
  BRANCHES.find((b) => b.isGeneralPool)?.value || null;

export function isGeneralPoolBranch(department) {
  return department === GENERAL_POOL_BRANCH;
}