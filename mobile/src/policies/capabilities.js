const normalizeRole = (role) => {
  if (!role) return null;
  const raw = role.toString().trim().toLowerCase();
  if (raw === 'viewer' || raw === 'reviewer') return 'reviewer';
  if (raw === 'editor') return 'editor';
  if (raw === 'manager') return 'manager';
  if (raw === 'owner') return 'owner';
  return raw;
};

const isEditorOrBetter = (role) => {
  const r = normalizeRole(role);
  return r === 'owner' || r === 'manager' || r === 'editor';
};

const isManagerOrBetter = (role) => {
  const r = normalizeRole(role);
  return r === 'owner' || r === 'manager';
};

export const getVaultCapabilities = ({ role, canCreateCollections }) => {
  const r = normalizeRole(role);
  return {
    role: r,
    canEdit: isEditorOrBetter(r),
    canMove: isManagerOrBetter(r),
    canClone: isManagerOrBetter(r),
    canDelete: r === 'owner',
    canShare: r === 'owner',
    canCreateCollections: !!canCreateCollections,
  };
};

export const getCollectionCapabilities = ({ role, canCreateAssets }) => {
  const r = normalizeRole(role);
  return {
    role: r,
    canEdit: isEditorOrBetter(r),
    canMove: isManagerOrBetter(r),
    canClone: isManagerOrBetter(r),
    canDelete: r === 'owner',
    canShare: r === 'owner',
    canCreateAssets: !!canCreateAssets,
  };
};

export const getAssetCapabilities = ({ role }) => {
  const r = normalizeRole(role);
  return {
    role: r,
    canEdit: isEditorOrBetter(r),
    canMove: isManagerOrBetter(r),
    canClone: isManagerOrBetter(r),
    canDelete: r === 'owner',
    // Asset sharing currently allows managers as well.
    canShare: r === 'owner' || r === 'manager',
  };
};
